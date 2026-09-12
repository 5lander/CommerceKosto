/**
 * El despachador de correo contra PostgreSQL real — P16-A1, Fase 3
 * (D-16.15, D-16.23, D-16.28, D-16.34, D-16.46; ADR-025).
 *
 *   - dos companies encolan y UNA pasada del despachador —montado con su
 *     propio modulo y su propio rol— envia los dos
 *   - tras `ENVIADO`, `datos` ya no contiene `token=`: queda `{plantilla, destinatario}`
 *   - un envio que falla suma un intento y aplaza el siguiente; al quinto,
 *     `FALLIDO` con `datos` saneado
 *   - `costeo_despachador` no lee `app_user` ni `inventory_movement`, y sobre
 *     la cola solo puede `UPDATE`: ni `INSERT` ni `DELETE`
 *   - la purga borra los golpes de `rate_limit_hit` de mas de 24 h y respeta
 *     los recientes
 *   - la reserva se renueva fila a fila con la firma de la pasada, y una fila
 *     que otra instancia volvio a tomar se cede en vez de enviarse dos veces
 *   - la aplicacion cliente NO tiene ni `DespachadorConnection` ni
 *     `CorreoModule` en su contenedor (patron de `backoffice.spec.ts`)
 *
 * EL DESPACHADOR SE MONTA CON `createApplicationContext`, SIN HTTP: esta
 * suite ya levanta la aplicacion cliente por HTTP para encolar, y dos
 * aplicaciones HTTP de Nest en el mismo worker revientan Node sin mensaje.
 * `GET /correo/salud` se prueba en `backoffice-interfaz.spec.ts`, que es donde
 * vive la superficie HTTP del back office.
 *
 * LA BASE ES COMPARTIDA Y ACUMULA CORREOS `PENDIENTE` DE OTRAS SUITES: antes
 * de medir nada se vacia la cola con pasadas de lote grande, para que
 * `failNext` golpee el correo de esta suite y no un residuo (INC-014).
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { DespacharCorreo } from '../../src/modules/correo/application/despachar-correo';
import { COLA_DE_CORREO, type ColaDeCorreo } from '../../src/modules/correo/application/ports/cola-de-correo.port';
import { INTENTOS_MAXIMOS } from '../../src/modules/correo/domain/reintentos';
import { CorreoModule } from '../../src/modules/correo/infrastructure/correo.module';
import { DespachadorConnection } from '../../src/modules/correo/infrastructure/despachador-connection';
import { cargarConfiguracionDelDespachador } from '../../src/modules/correo/infrastructure/entorno-del-despachador';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { MAILER_PORT } from '../../src/shared/application/ports/mailer.port';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { FakeMailer } from '../../src/shared/infrastructure/fakes/fake-mailer';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const ACEPTADO = 202;

/** Codigo SQLSTATE de "privilegio insuficiente". */
const PRIVILEGIO_DENEGADO = '42501';

const CONTRASENA = 'tres cebollas moradas';
const LOTE_GRANDE = 500;
const PASADAS_MAXIMAS_PARA_VACIAR = 20;
const SEGUNDO_MS = 1_000;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
const URL_DESPACHADOR = process.env['DESPACHADOR_DATABASE_URL'];
if (URL_MIGRATOR === undefined || URL_DESPACHADOR === undefined) {
  throw new Error('Faltan MIGRATION_DATABASE_URL o DESPACHADOR_DATABASE_URL. Ver .env.example.');
}

interface FilaDeOutbox {
  readonly estado: string;
  readonly intentos: number;
  readonly error: string | null;
  readonly sent_at: Date | null;
  readonly siguiente_intento_en: Date | null;
  /** `datos::text`, para buscar dentro sin asumir forma. */
  readonly datos: string;
}

interface Sembrado {
  readonly companyId: string;
  readonly admin: string;
}

describe('el despachador de correo', () => {
  let app: INestApplication;
  let despachador: INestApplicationContext;
  let despacho: DespacharCorreo;
  let mailer: FakeMailer;
  let duena: Client;
  let sufijo: string;
  let una: Sembrado;
  let otra: Sembrado;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function unaFila(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ id: string }>(sql, [...valores]);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`la siembra no devolvio id: ${sql}`);
    }
    return id;
  }

  async function sembrar(prefijo: string): Promise<Sembrado> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const companyId = await unaFila(
      `INSERT INTO company (name, status, plan_code) VALUES ($1, 'ACTIVE', 'BASICO') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const admin = `${prefijo}-admin.${sufijo}@snacklab.ec`;
    const usuario = await unaFila(
      `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [companyId, admin, hash],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'ADMIN', false)`,
      [companyId, usuario],
    );
    return { companyId, admin };
  }

  async function entrar(email: string): Promise<string> {
    const respuesta = await request(servidor()).post('/auth/login').send({ email, contrasena: CONTRASENA });
    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  /** Invita desde la company dada: encola una INVITACION. @returns el correo del invitado. */
  async function invitar(desde: Sembrado): Promise<string> {
    const cookie = await entrar(desde.admin);
    const invitado = `inv.${randomUUID().slice(0, 8)}@snacklab.ec`;
    const respuesta = await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: invitado });
    expect(respuesta.status).toBe(ACEPTADO);
    return invitado;
  }

  async function filaDe(destinatario: string): Promise<FilaDeOutbox> {
    const { rows } = await duena.query<FilaDeOutbox>(
      `SELECT estado, intentos, error, sent_at, siguiente_intento_en, datos::text AS datos
         FROM email_outbox WHERE destinatario = $1 ORDER BY created_at DESC LIMIT 1`,
      [destinatario],
    );
    const fila = rows[0];
    if (fila === undefined) {
      throw new Error(`no hay correo para ${destinatario}`);
    }
    return fila;
  }

  /** Pasadas hasta que no quede nada que tomar: el residuo de otras suites (INC-014). */
  async function vaciarLaCola(): Promise<void> {
    for (let pasada = 0; pasada < PASADAS_MAXIMAS_PARA_VACIAR; pasada += 1) {
      const resumen = await despacho.ejecutar();
      if (resumen.tomados === 0) return;
    }
    throw new Error('la cola no se vacio en veinte pasadas: hay mas residuo del que la suite tolera');
  }

  /** Adelanta el reloj de un correo: su siguiente intento pasa a estar vencido. */
  async function vencerEspera(destinatario: string): Promise<void> {
    await duena.query(`UPDATE email_outbox SET siguiente_intento_en = now() - interval '1 second' WHERE destinatario = $1`, [
      destinatario,
    ]);
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    // El despachador de verdad, con su modulo y su rol; solo cambia el adaptador
    // (falso, para leer lo enviado y armar fallos) y el lote (grande, para
    // vaciar el residuo de otras suites en pocas pasadas).
    despachador = await NestFactory.createApplicationContext(
      CorreoModule.forRoot({
        ...cargarConfiguracionDelDespachador(process.env),
        isProduction: false,
        mailAdapter: 'fake',
        lote: LOTE_GRANDE,
      }),
      { logger: false },
    );
    despacho = despachador.get(DespacharCorreo);
    mailer = despachador.get<FakeMailer>(MAILER_PORT);

    una = await sembrar('despachador-a');
    otra = await sembrar('despachador-b');

    // El residuo del limite de tasa de otras suites (D-16.50): `POST /usuarios`
    // cuenta por IP y aqui todo sale de 127.0.0.1.
    await duena.query('DELETE FROM rate_limit_hit');
    await vaciarLaCola();
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await despachador.close();
    await duena.end();
  });

  it('dos companies encolan y UNA pasada envia los dos, con el rol del despachador (D-16.15)', async () => {
    const invitadoA = await invitar(una);
    const invitadoB = await invitar(otra);
    const enviadosAntes = mailer.sent.length;

    const resumen = await despacho.ejecutar();

    expect(resumen.tomados).toBeGreaterThanOrEqual(2);
    expect(resumen.enviados).toBe(resumen.tomados);
    const destinatarios = mailer.sent.slice(enviadosAntes).map((correo) => correo.to);
    expect(destinatarios).toContain(invitadoA);
    expect(destinatarios).toContain(invitadoB);

    const correoA = mailer.sent.find((correo) => correo.to === invitadoA);
    expect(correoA?.subject).toBe('Te han invitado a costeo-saas');
    expect(correoA?.body).toContain('/activacion?token=');

    for (const invitado of [invitadoA, invitadoB]) {
      const fila = await filaDe(invitado);
      expect(fila.estado).toBe('ENVIADO');
      expect(fila.intentos).toBe(1);
      expect(fila.sent_at).not.toBeNull();
      expect(fila.error).toBeNull();
    }
  });

  it('tras ENVIADO, `datos` ya no contiene token= y si {plantilla, destinatario} (D-16.34)', async () => {
    const invitado = await invitar(una);
    expect((await filaDe(invitado)).datos).toContain('token=');

    await despacho.ejecutar();

    const fila = await filaDe(invitado);
    expect(fila.estado).toBe('ENVIADO');
    expect(fila.datos).not.toContain('token=');
    expect(fila.datos).not.toContain('enlace');
    expect(JSON.parse(fila.datos)).toEqual({ plantilla: 'INVITACION', destinatario: invitado });
  });

  it('un fallo suma un intento, guarda el error y aplaza el siguiente; la siguiente pasada NO lo vuelve a tomar', async () => {
    const invitado = await invitar(una);
    mailer.simulation.failNext(1);

    const conFallo = await despacho.ejecutar();
    expect(conFallo.fallidos).toBe(1);

    const fila = await filaDe(invitado);
    expect(fila.estado).toBe('PENDIENTE');
    expect(fila.intentos).toBe(1);
    expect(fila.error).toContain('simulado');
    expect(fila.siguiente_intento_en?.getTime() ?? 0).toBeGreaterThan(Date.now() + 50 * SEGUNDO_MS);
    // El enlace SIGUE mientras el correo esta en vuelo: hara falta para reintentar.
    expect(fila.datos).toContain('token=');

    const enseguida = await despacho.ejecutar();
    expect(enseguida.tomados).toBe(0);
    expect((await filaDe(invitado)).intentos).toBe(1);
  });

  it('al quinto fallo, FALLIDO con `datos` saneado y sin siguiente intento (D-16.46)', async () => {
    const invitado = await invitar(una);

    for (let intento = 1; intento <= INTENTOS_MAXIMOS; intento += 1) {
      if (intento > 1) await vencerEspera(invitado);
      mailer.simulation.failNext(1);
      await despacho.ejecutar();
      expect((await filaDe(invitado)).intentos).toBe(intento);
    }

    const fila = await filaDe(invitado);
    expect(fila.estado).toBe('FALLIDO');
    expect(fila.siguiente_intento_en).toBeNull();
    expect(fila.sent_at).toBeNull();
    expect(fila.error).toContain('simulado');
    expect(fila.datos).not.toContain('token=');
    expect(JSON.parse(fila.datos)).toEqual({ plantilla: 'INVITACION', destinatario: invitado });

    // Y ya no vuelve: una pasada mas, con la espera vencida, no lo toma.
    await vencerEspera(invitado);
    mailer.simulation.failNext(0);
    await despacho.ejecutar();
    expect((await filaDe(invitado)).intentos).toBe(INTENTOS_MAXIMOS);
  });

  it('una fila reintentada que al fin sale queda ENVIADO con el error borrado', async () => {
    const invitado = await invitar(una);
    mailer.simulation.failNext(1);
    await despacho.ejecutar();
    await vencerEspera(invitado);

    await despacho.ejecutar();

    const fila = await filaDe(invitado);
    expect(fila.estado).toBe('ENVIADO');
    expect(fila.intentos).toBe(2);
    expect(fila.error).toBeNull();
    expect(fila.siguiente_intento_en).toBeNull();
  });

  it('la purga borra los golpes de rate_limit_hit de mas de 24 h y respeta los recientes (D-16.28)', async () => {
    const claveVieja = `ip:203.0.113.${sufijo}`;
    const claveReciente = `ip:198.51.100.${sufijo}`;
    await duena.query(
      `INSERT INTO rate_limit_hit (kind, clave, "at") VALUES
         ('password.olvido', $1, now() - interval '25 hours'),
         ('password.olvido', $1, now() - interval '30 hours'),
         ('password.olvido', $2, now() - interval '23 hours'),
         ('usuario.invitar', $2, now())`,
      [claveVieja, claveReciente],
    );

    const resumen = await despacho.ejecutar();

    expect(resumen.purgados).toBeGreaterThanOrEqual(2);
    const { rows } = await duena.query<{ clave: string; n: string }>(
      `SELECT clave, count(*)::text AS n FROM rate_limit_hit WHERE clave IN ($1, $2) GROUP BY clave`,
      [claveVieja, claveReciente],
    );
    expect(rows.find((fila) => fila.clave === claveVieja)).toBeUndefined();
    expect(rows.find((fila) => fila.clave === claveReciente)?.n).toBe('2');
  });

  it('la reserva se renueva fila a fila con la firma de la pasada; una fila que OTRA instancia volvio a tomar se cede', async () => {
    const mio = await invitar(una);
    const intacto = await invitar(otra);
    const cola = despachador.get<ColaDeCorreo>(COLA_DE_CORREO);
    const alTomar = new Date();

    const tomados = await cola.tomarPendientes(alTomar, LOTE_GRANDE);
    const correoMio = tomados.find((correo) => correo.destinatario === mio);
    const correoIntacto = tomados.find((correo) => correo.destinatario === intacto);
    expect(correoMio).toBeDefined();
    expect(correoIntacto).toBeDefined();
    if (correoMio === undefined || correoIntacto === undefined) return;

    // La reserva del lote quedo escrita, y es la firma que viaja con la fila.
    expect((await filaDe(mio)).siguiente_intento_en?.getTime()).toBe(correoMio.reservadoHasta.getTime());

    // Otra instancia la vuelve a tomar (la reserva caduco y la reescribio): la firma ya no cuadra.
    await duena.query(`UPDATE email_outbox SET siguiente_intento_en = now() + interval '7 minutes' WHERE destinatario = $1`, [
      mio,
    ]);
    const masTarde = new Date(alTomar.getTime() + 5 * SEGUNDO_MS);
    expect(await cola.renovarReserva(correoMio, masTarde)).toBe(false);
    expect(await cola.renovarReserva(correoIntacto, masTarde)).toBe(true);
    expect((await filaDe(intacto)).siguiente_intento_en?.getTime() ?? 0).toBeGreaterThan(correoIntacto.reservadoHasta.getTime());

    // Un correo cerrado tampoco se renueva: `estado = 'PENDIENTE'` va en el WHERE.
    await vencerEspera(mio);
    await vencerEspera(intacto);
    await despacho.ejecutar();
    expect((await filaDe(mio)).estado).toBe('ENVIADO');
    expect(await cola.renovarReserva(correoIntacto, masTarde)).toBe(false);
  });

  it('la aplicacion cliente NO tiene ni la conexion del despachador ni su modulo en el contenedor', () => {
    expect(() => app.get(DespachadorConnection)).toThrow();
    expect(() => app.get(DespachadorConnection, { strict: false })).toThrow();
    expect(() => app.select(CorreoModule)).toThrow();
  });

  it('el proceso del despachador SI la tiene: la prueba anterior mide algo', () => {
    expect(despachador.get(DespachadorConnection)).toBeInstanceOf(DespachadorConnection);
  });

  describe('el rol costeo_despachador, contra la base', () => {
    let cliente: Client;

    beforeAll(async () => {
      cliente = new Client({ connectionString: URL_DESPACHADOR });
      await cliente.connect();
    });

    afterAll(async () => {
      await cliente.end();
    });

    it('no lee app_user ni inventory_movement: permission denied', async () => {
      for (const consulta of [
        'SELECT email FROM app_user',
        'SELECT total_cost FROM inventory_movement',
        'SELECT name FROM company',
        'SELECT token_hash FROM password_reset_token',
      ]) {
        await expect(cliente.query(consulta)).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
      }
    });

    it('sobre la cola puede UPDATE y nada mas: ni INSERT ni DELETE', async () => {
      // Control positivo (INC-007): el UPDATE es legal aunque no toque filas.
      const actualizacion = await cliente.query(`UPDATE email_outbox SET error = NULL WHERE destinatario = $1`, [
        `nadie.${sufijo}@snacklab.ec`,
      ]);
      expect(actualizacion.rowCount).toBe(0);

      await expect(
        cliente.query(
          `INSERT INTO email_outbox (destinatario, plantilla, datos, estado)
           VALUES ('x@y.co', 'INVITACION', '{}'::jsonb, 'PENDIENTE')`,
        ),
      ).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
      await expect(cliente.query('DELETE FROM email_outbox')).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
    });

    it('sobre rate_limit_hit borra y lee `at`, pero no la clave', async () => {
      const { rows } = await cliente.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM rate_limit_hit WHERE "at" < now() - interval '100 years'`,
      );
      expect(rows[0]?.n).toBe('0');

      await expect(cliente.query('SELECT clave FROM rate_limit_hit')).rejects.toMatchObject({
        code: PRIVILEGIO_DENEGADO,
      });
    });
  });
});
