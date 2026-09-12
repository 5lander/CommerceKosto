/**
 * El correo transaccional y el restablecimiento de contrasena, contra la API
 * real y PostgreSQL real — P16-A1, Fase 3 (ADR-025).
 *
 *   - invitar ENCOLA: una fila `PENDIENTE` en `email_outbox`, con el enlace y
 *     el token dentro, en la MISMA transaccion que crea al invitado. Si el
 *     usuario no se crea, no hay correo
 *   - reenviar invalida el enlace anterior y encola otro
 *   - `/olvido` sin sesion responde 202 exista o no el correo, con el MISMO
 *     cuerpo; solo si existe hay token y correo, atribuidos a su company
 *   - `/restablecimiento` sin sesion gasta el token, cambia la contrasena y
 *     REVOCA todas las sesiones; dos veces, caducado o inventado dan 400
 *   - `costeo_app` no puede leer `password_reset_token` ni `email_outbox.datos`,
 *     ni marcar ni borrar correos; `costeo_despachador` lee la cola y NADA mas
 *   - `/olvido` no delata por el tiempo mas de lo que cuesta un INSERT
 *   - el aviso de bloqueo del login tambien se ENCOLA, sin enlace y sin datos
 *
 * Lo que ve el rol del back office —la salud de la cola sin `datos`, y que el
 * token en claro no esta en `audit_log`— se prueba en `backoffice-correo.spec.ts`:
 * `BACKOFFICE_DATABASE_URL` solo puede nombrarse en las suites del back office
 * (`audit:forbidden`, ADR-017).
 *
 * UNA sola app HTTP por archivo, con el limitador subido para que un 429 no
 * se confunda con lo que se mide (ver `autenticacion-y-autorizacion.spec.ts`).
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const ACEPTADO = 202;
const SIN_CONTENIDO = 204;
const PETICION_INVALIDA = 400;
const NO_AUTORIZADO = 401;
const PROHIBIDO = 403;
const NO_ENCONTRADO = 404;
const DEMASIADAS_PETICIONES = 429;
const ERROR_INTERNO = 500;

/** Codigo SQLSTATE de "privilegio insuficiente". */
const PRIVILEGIO_DENEGADO = '42501';

const CONTRASENA = 'tres cebollas moradas';
const CONTRASENA_NUEVA = 'pimientos del piquillo asados';
const HORA_MS = 3_600_000;
/** Entre el reloj de la prueba y el del proceso hay milisegundos; no se mide eso. */
const TOLERANCIA_MS = 10_000;
/** Fallos de la cuenta que abren el primer bloqueo (SEGURIDAD.md §2.1). */
const UMBRAL_DE_BLOQUEO = 5;

/**
 * El canal de tiempo residual de `/olvido` (ADR-025): con usuario, la definer
 * hace dos INSERT mas; sin usuario, solo el SELECT. Se mide con medianas de
 * varias muestras intercaladas, y el margen es lo que separa un INSERT (decimas
 * de milisegundo) de un hash de Argon2id con los parametros del proyecto
 * (decenas): lo que esta prueba caza es que alguien meta trabajo caro en un
 * solo ramal, no la latencia de la red.
 */
const MUESTRAS_DE_TIEMPO = 15;
const MARGEN_DE_TIEMPO_MS = 50;
const NANOS_POR_MILI = 1_000_000;

const URL_APP = process.env['DATABASE_URL'];
const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
const URL_DESPACHADOR = process.env['DESPACHADOR_DATABASE_URL'];
if (URL_APP === undefined || URL_MIGRATOR === undefined || URL_DESPACHADOR === undefined) {
  throw new Error('Faltan DATABASE_URL, MIGRATION_DATABASE_URL o DESPACHADOR_DATABASE_URL. Ver .env.example.');
}

interface FilaDeOutbox {
  readonly company_id: string | null;
  readonly user_id: string | null;
  readonly plantilla: string;
  readonly estado: string;
  readonly intentos: number;
  readonly sent_at: Date | null;
  /** `datos->>'enlace'`: nulo en el aviso de bloqueo, que no lleva datos. */
  readonly enlace: string | null;
}

function mediana(valores: readonly number[]): number {
  const ordenados = [...valores].sort((a, b) => a - b);
  return ordenados[Math.floor(ordenados.length / 2)] ?? 0;
}

interface Sembrado {
  readonly companyId: string;
  readonly admin: string;
  readonly gerente: string;
  readonly ana: string;
}

describe('correo transaccional y restablecimiento', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let uno: Sembrado;
  let otra: Sembrado;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function correoDe(usuario: string): string {
    return `${usuario}.${sufijo}@snacklab.ec`;
  }

  async function unaFila(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ id: string }>(sql, [...valores]);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`la siembra no devolvio id: ${sql}`);
    }
    return id;
  }

  async function sembrarTenant(prefijo: string): Promise<Sembrado> {
    const hash = await new Argon2Hasher().hash(CONTRASENA);

    const company = await unaFila(
      `INSERT INTO company (name, status, plan_code) VALUES ($1, 'ACTIVE', 'BASICO') RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );
    const local = await unaFila(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [company, `${prefijo} centro`],
    );

    const crear = async (nombre: string): Promise<string> =>
      unaFila(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
        [company, correoDe(`${prefijo}-${nombre}`), hash],
      );

    const admin = await crear('admin');
    const gerente = await crear('gerente');
    const ana = await crear('ana');

    // Ana es ADMIN para que tenga una ruta con sesion que consultar
    // (`GET /ubicaciones`) y se pueda ver caer su sesion al restablecer.
    for (const usuario of [admin, ana]) {
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'ADMIN', false)`,
        [company, usuario],
      );
    }
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       VALUES ($1, $2, 'GERENTE_LOCAL', $3, true)`,
      [company, gerente, local],
    );

    return {
      companyId: company,
      admin: correoDe(`${prefijo}-admin`),
      gerente: correoDe(`${prefijo}-gerente`),
      ana: correoDe(`${prefijo}-ana`),
    };
  }

  async function entrar(email: string, contrasena = CONTRASENA): Promise<string> {
    const respuesta = await request(servidor()).post('/auth/login').send({ email, contrasena });
    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  async function correosA(destinatario: string): Promise<readonly FilaDeOutbox[]> {
    const { rows } = await duena.query<FilaDeOutbox>(
      `SELECT company_id, user_id, plantilla, estado, intentos, sent_at, datos->>'enlace' AS enlace
         FROM email_outbox WHERE destinatario = $1 ORDER BY created_at DESC, id DESC`,
      [destinatario],
    );
    return rows;
  }

  async function ultimoCorreoA(destinatario: string): Promise<FilaDeOutbox> {
    const [fila] = await correosA(destinatario);
    if (fila === undefined) {
      throw new Error(`no hay ningun correo encolado a ${destinatario}`);
    }
    return fila;
  }

  function tokenDe(enlace: string | null): string {
    const token = enlace === null ? null : new URL(enlace).searchParams.get('token');
    if (token === null) {
      throw new Error(`el enlace no lleva token: ${String(enlace)}`);
    }
    return token;
  }

  async function contar(cliente: Client, sql: string, valores: readonly unknown[] = []): Promise<number> {
    const { rows } = await cliente.query<{ n: string }>(sql, [...valores]);
    return Number(rows[0]?.n ?? '0');
  }

  /**
   * Milisegundos que tarda `/olvido` con ese correo, medidos con el reloj
   * monotono. Se vacia el limite ANTES de arrancar el reloj: la medida repite
   * el mismo correo quince veces y el limite real es tres por hora (D-16.50).
   */
  async function tiempoDeOlvido(email: string): Promise<number> {
    await duena.query('DELETE FROM rate_limit_hit');
    const inicio = process.hrtime.bigint();
    const respuesta = await request(servidor()).post('/auth/password/olvido').send({ email });
    expect(respuesta.status).toBe(ACEPTADO);
    return Number(process.hrtime.bigint() - inicio) / NANOS_POR_MILI;
  }

  async function idDelUsuario(email: string): Promise<string> {
    return unaFila(`SELECT id FROM app_user WHERE email = $1`, [email]);
  }

  async function pedirRestablecimiento(email: string): Promise<string> {
    const respuesta = await request(servidor()).post('/auth/password/olvido').send({ email });
    expect(respuesta.status).toBe(ACEPTADO);
    return tokenDe((await ultimoCorreoA(email)).enlace);
  }

  function restablecer(token: string, contrasena: string) {
    return request(servidor()).post('/auth/password/restablecimiento').send({ token, contrasena });
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

    // Los logins fallidos a proposito de esta suite se acumulan por IP: cada
    // corrida parte de cero, como parte de cero su tenant.
    await duena.query('DELETE FROM login_attempt');

    // Y `rate_limit_hit` POR LO MISMO (D-16.50): los cuatro endpoints cuentan
    // golpes por IP y por destinatario, y aqui todo sale de 127.0.0.1. Los
    // golpes de una corrida anterior, o de otra suite, bloquearian esta por
    // una razon que no es la que mide. Sus propios limites se prueban en
    // `limite-de-tasa.spec.ts` e `ip-tras-el-proxy.spec.ts`.
    await duena.query('DELETE FROM rate_limit_hit');

    uno = await sembrarTenant('uno');
    otra = await sembrarTenant('otra');
  });

  // Cada caso parte de cero en el limite de tasa: varios piden el
  // restablecimiento del mismo correo, y tres por hora es el limite real.
  beforeEach(async () => {
    await duena.query('DELETE FROM rate_limit_hit');
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('la invitacion encola en la misma transaccion', () => {
    it('una fila PENDIENTE, con company, invitado y el enlace con su token', async () => {
      const cookie = await entrar(uno.admin);
      const nuevo = `nuevo.${randomUUID().slice(0, 8)}@snacklab.ec`;

      const invitacion = await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
      expect(invitacion.status).toBe(ACEPTADO);

      const correo = await ultimoCorreoA(nuevo);
      expect(correo).toMatchObject({
        company_id: uno.companyId,
        user_id: await idDelUsuario(nuevo),
        plantilla: 'INVITACION',
        estado: 'PENDIENTE',
        intentos: 0,
        sent_at: null,
      });
      expect(correo.enlace).toContain('token=');
      expect(correo.enlace?.startsWith(`${loadConfiguration(process.env).appUrl}/activacion?token=`)).toBe(true);
    });

    it('si el invitado no se crea, no hay correo: son la misma transaccion', async () => {
      const cookie = await entrar(uno.admin);
      const antes = (await correosA(otra.ana)).length;

      // El correo ya esta en uso en OTRA company: 202 igual, y ningun correo.
      const respuesta = await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: otra.ana });
      expect(respuesta.status).toBe(ACEPTADO);
      expect(await correosA(otra.ana)).toHaveLength(antes);
    });

    it('y al reves: si el outbox no acepta el correo, el invitado tampoco existe', async () => {
      const cookie = await entrar(uno.admin);
      const nuevo = `sinoutbox.${randomUUID().slice(0, 8)}@snacklab.ec`;

      // La duena le prohibe al outbox aceptar invitaciones mientras dura la
      // prueba. `NOT VALID` para no validar las filas que ya hay: solo importa
      // la siguiente. Es el fallo de infraestructura que el `$transaction`
      // tiene que deshacer entero.
      await duena.query(
        `ALTER TABLE email_outbox ADD CONSTRAINT tmp_outbox_cerrado CHECK (plantilla <> 'INVITACION') NOT VALID`,
      );
      try {
        const respuesta = await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
        expect(respuesta.status).toBe(ERROR_INTERNO);
        expect(respuesta.body).toMatchObject({ code: 'INTERNAL_ERROR' });
      } finally {
        await duena.query('ALTER TABLE email_outbox DROP CONSTRAINT tmp_outbox_cerrado');
      }

      expect(await contar(duena, 'SELECT count(*)::text AS n FROM app_user WHERE email = $1', [nuevo])).toBe(0);
      expect(await correosA(nuevo)).toHaveLength(0);

      // Y la siguiente entra entera: no quedo nada a medias.
      const despues = await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
      expect(despues.status).toBe(ACEPTADO);
      expect(await correosA(nuevo)).toHaveLength(1);
    });
  });

  describe('reenviar la invitacion', () => {
    it('invalida el enlace anterior y encola otro: el viejo ya no activa, el nuevo si', async () => {
      const cookie = await entrar(uno.admin);
      const nuevo = `reenvio.${randomUUID().slice(0, 8)}@snacklab.ec`;

      await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
      const viejo = tokenDe((await ultimoCorreoA(nuevo)).enlace);

      const reenvio = await request(servidor())
        .post(`/usuarios/${await idDelUsuario(nuevo)}/reenvio-de-invitacion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      expect(reenvio.status).toBe(ACEPTADO);

      const correos = await correosA(nuevo);
      expect(correos).toHaveLength(2);
      const reciente = tokenDe(correos[0]?.enlace ?? '');
      expect(reciente).not.toBe(viejo);

      const conElViejo = await request(servidor())
        .post('/usuarios/activacion')
        .send({ token: viejo, contrasena: 'higos secos en almibar' });
      expect(conElViejo.status).toBe(NO_AUTORIZADO);
      expect(conElViejo.body).toMatchObject({ code: 'SESION_INVALIDA' });

      const conElNuevo = await request(servidor())
        .post('/usuarios/activacion')
        .send({ token: reciente, contrasena: 'higos secos en almibar' });
      expect(conElNuevo.status).toBe(SIN_CONTENIDO);
    });

    it('un usuario que ya activo no tiene invitacion que reenviar: 404', async () => {
      const cookie = await entrar(uno.admin);
      const respuesta = await request(servidor())
        .post(`/usuarios/${await idDelUsuario(uno.ana)}/reenvio-de-invitacion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect(respuesta.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
    });

    it('un invitado de OTRA company no existe: 404, no 202 en silencio', async () => {
      const cookieOtra = await entrar(otra.admin);
      const ajeno = `ajeno.${randomUUID().slice(0, 8)}@snacklab.ec`;
      await request(servidor()).post('/usuarios').set('Cookie', cookieOtra).set('X-CSRF-Token', csrfDe(cookieOtra)).send({ email: ajeno });

      const cookie = await entrar(uno.admin);
      const respuesta = await request(servidor())
        .post(`/usuarios/${await idDelUsuario(ajeno)}/reenvio-de-invitacion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect(respuesta.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
      expect(await correosA(ajeno)).toHaveLength(1);
    });

    it('exige el mismo permiso que invitar: GERENTE_LOCAL recibe 403', async () => {
      const cookie = await entrar(uno.gerente);
      const respuesta = await request(servidor())
        .post(`/usuarios/${await idDelUsuario(uno.ana)}/reenvio-de-invitacion`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('un id que no es UUID es 400, no 500', async () => {
      const cookie = await entrar(uno.admin);
      const respuesta = await request(servidor())
        .post('/usuarios/no-es-un-uuid/reenvio-de-invitacion')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  describe('POST /auth/password/olvido, sin sesion', () => {
    it('con un correo activo: 202, token en la base y correo encolado bajo SU company', async () => {
      const antes = new Date();
      const respuesta = await request(servidor()).post('/auth/password/olvido').send({ email: uno.ana });

      expect(respuesta.status).toBe(ACEPTADO);
      expect(respuesta.body).toEqual({});

      const ana = await idDelUsuario(uno.ana);
      const { rows: tokens } = await duena.query<{ used_at: Date | null; expires_at: Date }>(
        `SELECT used_at, expires_at FROM password_reset_token
          WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [ana],
      );
      expect(tokens[0]?.used_at).toBeNull();
      const vida = (tokens[0]?.expires_at.getTime() ?? 0) - antes.getTime();
      const esperada = loadConfiguration(process.env).horasDeRestablecimiento * HORA_MS;
      expect(Math.abs(vida - esperada)).toBeLessThanOrEqual(TOLERANCIA_MS);

      const correo = await ultimoCorreoA(uno.ana);
      expect(correo).toMatchObject({
        company_id: uno.companyId,
        user_id: ana,
        plantilla: 'RESTABLECIMIENTO',
        estado: 'PENDIENTE',
      });
      expect(correo.enlace).toContain('/restablecer?token=');
    });

    it('con un correo que no existe: el MISMO 202 y el mismo cuerpo, y ninguna fila', async () => {
      const desconocido = `nadie.${randomUUID().slice(0, 8)}@snacklab.ec`;
      const respuesta = await request(servidor()).post('/auth/password/olvido').send({ email: desconocido });

      expect(respuesta.status).toBe(ACEPTADO);
      expect(respuesta.body).toEqual({});
      expect(await correosA(desconocido)).toHaveLength(0);
    });

    it('con un invitado que aun no activo: 202 y nada, porque no tiene contrasena que restablecer', async () => {
      const cookie = await entrar(uno.admin);
      const invitado = `pendiente.${randomUUID().slice(0, 8)}@snacklab.ec`;
      await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: invitado });

      const respuesta = await request(servidor()).post('/auth/password/olvido').send({ email: invitado });
      expect(respuesta.status).toBe(ACEPTADO);

      const { rows } = await duena.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM password_reset_token t
           JOIN app_user u ON u.id = t.user_id WHERE u.email = $1`,
        [invitado],
      );
      expect(rows[0]?.n).toBe('0');
      expect((await correosA(invitado)).map((c) => c.plantilla)).toEqual(['INVITACION']);
    });

    it('un cuerpo con una clave de mas se RECHAZA', async () => {
      const respuesta = await request(servidor())
        .post('/auth/password/olvido')
        .send({ email: uno.ana, companyId: otra.companyId });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('no delata por el tiempo mas de lo que cuesta un INSERT: las medianas quedan a menos de un hash', async () => {
      const desconocido = `nadie.${randomUUID().slice(0, 8)}@snacklab.ec`;

      // Una peticion de calentamiento por ramal, fuera de la muestra: la
      // primera paga la compilacion de la consulta, y eso no es lo que se mide.
      await tiempoDeOlvido(otra.admin);
      await tiempoDeOlvido(desconocido);

      const conUsuario: number[] = [];
      const sinUsuario: number[] = [];
      for (let i = 0; i < MUESTRAS_DE_TIEMPO; i += 1) {
        conUsuario.push(await tiempoDeOlvido(otra.admin));
        sinUsuario.push(await tiempoDeOlvido(desconocido));
      }

      expect(Math.abs(mediana(conUsuario) - mediana(sinUsuario))).toBeLessThan(MARGEN_DE_TIEMPO_MS);
    });
  });

  describe('POST /auth/password/restablecimiento, sin sesion', () => {
    it('gasta el token, cambia la contrasena y revoca las sesiones abiertas', async () => {
      const sesionAnterior = await entrar(otra.ana);
      expect((await request(servidor()).get('/ubicaciones').set('Cookie', sesionAnterior).set('X-CSRF-Token', csrfDe(sesionAnterior))).status).toBe(OK);

      const token = await pedirRestablecimiento(otra.ana);
      const respuesta = await restablecer(token, CONTRASENA_NUEVA);
      expect(respuesta.status).toBe(SIN_CONTENIDO);

      // La sesion que estaba abierta se cae, la contrasena vieja ya no entra y
      // la nueva si.
      expect((await request(servidor()).get('/ubicaciones').set('Cookie', sesionAnterior).set('X-CSRF-Token', csrfDe(sesionAnterior))).status).toBe(
        NO_AUTORIZADO,
      );
      const conLaVieja = await request(servidor())
        .post('/auth/login')
        .send({ email: otra.ana, contrasena: CONTRASENA });
      expect(conLaVieja.status).toBe(NO_AUTORIZADO);
      expect(conLaVieja.body).toMatchObject({ code: 'CREDENCIALES_INVALIDAS' });
      await entrar(otra.ana, CONTRASENA_NUEVA);
    });

    it('el mismo token dos veces: la segunda es 400', async () => {
      const token = await pedirRestablecimiento(uno.ana);
      expect((await restablecer(token, CONTRASENA_NUEVA)).status).toBe(SIN_CONTENIDO);

      const segunda = await restablecer(token, 'chirimoyas del valle');
      expect(segunda.status).toBe(PETICION_INVALIDA);
      expect(segunda.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      // Y la contrasena sigue siendo la primera.
      await entrar(uno.ana, CONTRASENA_NUEVA);
    });

    it('caducado: 400, con el mismo codigo que el usado', async () => {
      const token = await pedirRestablecimiento(uno.ana);
      // Se mueve la fila ENTERA al pasado, no solo la caducidad: el CHECK
      // `expires_at > created_at` no deja fabricar un token que caduco antes
      // de nacer, y eso tambien es lo que se quiere.
      await duena.query(
        `UPDATE password_reset_token
            SET created_at = created_at - interval '2 hours',
                expires_at = expires_at - interval '2 hours'
          WHERE user_id = $1 AND used_at IS NULL`,
        [await idDelUsuario(uno.ana)],
      );

      const respuesta = await restablecer(token, 'chirimoyas del valle');
      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('inventado y vacio: 400 los dos', async () => {
      const inventado = await restablecer('no-es-un-token-de-nadie', CONTRASENA_NUEVA);
      expect(inventado.status).toBe(PETICION_INVALIDA);
      expect(inventado.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });

      const vacio = await restablecer('', CONTRASENA_NUEVA);
      expect(vacio.status).toBe(PETICION_INVALIDA);
      expect(vacio.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('una contrasena de la lista de filtradas se rechaza, y el token ya se gasto', async () => {
      const token = await pedirRestablecimiento(uno.ana);

      const debil = await restablecer(token, 'restaurante2026');
      expect(debil.status).toBe(PETICION_INVALIDA);
      expect(debil.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });

      // El orden es deliberado: el token se gasta ANTES de mirar la contrasena.
      const otraVez = await restablecer(token, 'chirimoyas del valle');
      expect(otraVez.status).toBe(PETICION_INVALIDA);
      await entrar(uno.ana, CONTRASENA_NUEVA);
    });
  });

  describe('el aviso de bloqueo del login tambien se encola', () => {
    it('al quinto fallo hay una fila BLOQUEO bajo la company y el usuario de la cuenta, sin enlace y sin datos', async () => {
      for (let i = 0; i < UMBRAL_DE_BLOQUEO; i += 1) {
        const fallo = await request(servidor())
          .post('/auth/login')
          .send({ email: otra.gerente, contrasena: 'no es esta' });
        expect(fallo.status).toBe(NO_AUTORIZADO);
      }

      const correos = await correosA(otra.gerente);
      expect(correos).toHaveLength(1);
      expect(correos[0]).toMatchObject({
        company_id: otra.companyId,
        user_id: await idDelUsuario(otra.gerente),
        plantilla: 'BLOQUEO',
        estado: 'PENDIENTE',
        enlace: null,
      });
      const { rows } = await duena.query<{ datos: unknown }>(
        `SELECT datos FROM email_outbox WHERE destinatario = $1 AND plantilla = 'BLOQUEO'`,
        [otra.gerente],
      );
      expect(rows[0]?.datos).toEqual({});

      // El aviso salio CON el bloqueo: el sexto intento ya es 429.
      const sexto = await request(servidor()).post('/auth/login').send({ email: otra.gerente, contrasena: 'no es esta' });
      expect(sexto.status).toBe(DEMASIADAS_PETICIONES);
      expect(sexto.body).toMatchObject({ code: 'ACCESO_BLOQUEADO' });
    });
  });

  describe('privilegios de los roles sobre las tablas nuevas', () => {
    it('costeo_app NO puede leer password_reset_token ni crear uno: sin politica y sin privilegio', async () => {
      const cliente = new Client({ connectionString: URL_APP });
      await cliente.connect();
      try {
        for (const consulta of [
          'SELECT token_hash FROM password_reset_token',
          `INSERT INTO password_reset_token (user_id, token_hash, expires_at)
           VALUES (gen_random_uuid(), 'a-mano', now() + interval '1 hour')`,
        ]) {
          await expect(cliente.query(consulta)).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
        }
      } finally {
        await cliente.end();
      }
    });

    it('costeo_app tiene SELECT sobre la cola menos `datos`, y ni marca ni borra', async () => {
      const cliente = new Client({ connectionString: URL_APP });
      await cliente.connect();
      try {
        // Control positivo (INC-007): las demas columnas se pueden nombrar sin
        // error. Sin tenant fijado RLS devuelve cero filas, pero el privilegio
        // se comprueba ANTES que la politica: si faltara, esto seria un 42501
        // como el de `datos`, no un resultado vacio.
        expect(
          await contar(cliente, 'SELECT count(*)::text AS n FROM email_outbox WHERE destinatario = $1', [uno.ana]),
        ).toBe(0);

        for (const consulta of [
          'SELECT datos FROM email_outbox',
          `UPDATE email_outbox SET estado = 'ENVIADO', sent_at = now()`,
          'DELETE FROM email_outbox',
        ]) {
          await expect(cliente.query(consulta)).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
        }
      } finally {
        await cliente.end();
      }
    });

    it('costeo_despachador lee la cola y NADA mas: ni usuarios, ni tokens, ni las claves del limite', async () => {
      const despachador = new Client({ connectionString: URL_DESPACHADOR });
      await despachador.connect();
      try {
        const { rows } = await despachador.query<{ estado: string }>(
          'SELECT estado FROM email_outbox WHERE destinatario = $1',
          [uno.ana],
        );
        expect(rows.length).toBeGreaterThan(0);

        for (const consulta of [
          'SELECT email FROM app_user',
          'SELECT token_hash FROM password_reset_token',
          'SELECT clave FROM rate_limit_hit',
          'SELECT name FROM company',
        ]) {
          await expect(despachador.query(consulta)).rejects.toMatchObject({ code: PRIVILEGIO_DENEGADO });
        }
      } finally {
        await despachador.end();
      }
    });
  });
});
