/**
 * El limite de tasa de los cuatro endpoints sin sesion o con correo, contra
 * la API real y PostgreSQL real — P16-A1, D-16.17, D-16.24, D-16.50.
 *
 *   - por endpoint, el enesimo intento pasa y el enesimo+1 es 429
 *     `LIMITE_DE_SOLICITUDES` con `Retry-After` y el minuto en el mensaje
 *   - por IP y por destinatario POR SEPARADO: dos correos desde la misma IP se
 *     cuentan aparte; el mismo correo desde varias IP se corta igual
 *   - los rechazos tambien cuentan: diez tokens invalidos y el undecimo es 429
 *   - con el par del socket en `PROXY_DE_CONFIANZA`, `X-Forwarded-For` SI
 *     cambia la clave, y `login_attempt.ip` guarda el ultimo salto (D-16.49)
 *
 * LA APP SE LEVANTA CON `proxiesDeConfianza: ['127.0.0.1']`, que es el par de
 * todas las peticiones de supertest: asi cada caso elige su IP con
 * `X-Forwarded-For` y no pisa a los demas. El caso contrario —el par NO es de
 * confianza y la cabecera se ignora— esta en `ip-tras-el-proxy.spec.ts`, con
 * su propia app: UNA sola app HTTP por archivo.
 *
 * `rate_limit_hit` se vacia al empezar y al terminar: las claves de aqui son
 * IPs de documentacion y correos con sufijo, pero un residuo de una hora es
 * exactamente lo que INC-014 ensena a no dejar.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const ACEPTADO = 202;
const PETICION_INVALIDA = 400;
const NO_AUTORIZADO = 401;
const NO_ENCONTRADO = 404;
const DEMASIADAS_PETICIONES = 429;

const CONTRASENA = 'tres cebollas moradas';
const CONTRASENA_NUEVA = 'pimientos del piquillo asados';

/** Los umbrales de D-16.50, copiados aqui para que un cambio en la politica se note. */
const OLVIDO_POR_IP = 10;
const RESTABLECIMIENTO_POR_IP = 10;
const INVITACION_POR_IP = 30;
const POR_DESTINATARIO = 3;
const SEGUNDOS_POR_HORA = 3_600;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

describe('el limite de tasa de los endpoints sin sesion o con correo', () => {
  let app: INestApplication;
  let duena: Client;
  let sufijo: string;
  let admin: string;
  let cookie: string;
  /** Cada caso pide IPs nuevas: `203.0.113.0/24` es el rango de documentacion. */
  let siguienteIp = 1;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function ipNueva(): string {
    siguienteIp += 1;
    return `203.0.113.${String(siguienteIp)}`;
  }

  function correoNuevo(prefijo: string): string {
    return `${prefijo}.${randomUUID().slice(0, 8)}@snacklab.ec`;
  }

  function olvido(ip: string, email: string): request.Test {
    return request(servidor()).post('/auth/password/olvido').set('X-Forwarded-For', ip).send({ email });
  }

  function restablecer(ip: string): request.Test {
    return request(servidor())
      .post('/auth/password/restablecimiento')
      .set('X-Forwarded-For', ip)
      .send({ token: 'no-es-un-token-que-exista', contrasena: CONTRASENA_NUEVA });
  }

  function invitar(ip: string, email: string): request.Test {
    return request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).set('X-Forwarded-For', ip).send({ email });
  }

  function reenviar(ip: string, id: string): request.Test {
    return request(servidor())
      .post(`/usuarios/${id}/reenvio-de-invitacion`)
      .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
      .set('X-Forwarded-For', ip);
  }

  async function unaFila(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ id: string }>(sql, [...valores]);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`la siembra no devolvio id: ${sql}`);
    }
    return id;
  }

  /** Un 429 del limite de tasa, con las tres cosas que lo distinguen. */
  function esperarLimite(respuesta: request.Response): void {
    expect(respuesta.status).toBe(DEMASIADAS_PETICIONES);
    expect(respuesta.body).toMatchObject({
      code: 'LIMITE_DE_SOLICITUDES',
      message: expect.stringMatching(/minutos?\.$/u),
    });
    const reintento = Number(respuesta.headers['retry-after']);
    expect(Number.isInteger(reintento)).toBe(true);
    expect(reintento).toBeGreaterThan(0);
    expect(reintento).toBeLessThanOrEqual(SEGUNDOS_POR_HORA);
  }

  async function estadosDe(peticiones: readonly (() => request.Test)[]): Promise<number[]> {
    const estados: number[] = [];
    for (const pedir of peticiones) {
      estados.push((await pedir()).status);
    }
    return estados;
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
      proxiesDeConfianza: ['127.0.0.1'],
    });
    await app.init();
    // SE PONE A ESCUCHAR AQUI, Y NO ES DECORATIVO: ESTA SUITE DISPARA 30
    // PETICIONES EN EL MISMO TICK.
    //
    // `init()` monta la aplicacion pero NO abre el puerto. Supertest lo abre
    // perezosamente al construir cada peticion: mira `server.address()` y, si
    // esta vacia, llama a `listen(0)`. Con los 30 objetos creados de golpe, los
    // 30 ven la direccion vacia -`listen` es asincrono y ninguno ha terminado-
    // y los 30 intentan abrir el puerto. El resultado es un `read ECONNRESET`
    // en una peticion al azar, que ademas se lee como un fallo del limite de
    // tasa cuando es del transporte.
    //
    // Solo aparece bajo carga -paso en el PR y fallo en el push del MISMO
    // arbol-, que es lo que lo hace peligroso: una prueba que falla una de cada
    // pocas veces entrena a no mirar CI, y eso es justo lo que INC-033 costo.
    await app.listen(0);

    await duena.query('DELETE FROM rate_limit_hit');
    await duena.query('DELETE FROM login_attempt');

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const company = await unaFila(
      `INSERT INTO company (name, status, plan_code) VALUES ($1, 'ACTIVE', 'BASICO') RETURNING id`,
      [`limite ${sufijo}`],
    );
    admin = `admin.${sufijo}@snacklab.ec`;
    const usuario = await unaFila(
      `INSERT INTO app_user (company_id, email, password_hash, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [company, admin, hash],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'ADMIN', false)`,
      [company, usuario],
    );

    const login = await request(servidor()).post('/auth/login').send({ email: admin, contrasena: CONTRASENA });
    expect(login.status).toBe(OK);
    cookie = cookieConCsrf(login);
  });

  afterAll(async () => {
    await duena.query('DELETE FROM rate_limit_hit');
    await app.close();
    await duena.end();
  });

  describe('POST /auth/password/olvido', () => {
    it('el decimo por IP pasa y el undecimo es 429 con Retry-After, aunque cada uno lleve otro correo', async () => {
      const ip = ipNueva();

      const estados = await estadosDe(
        Array.from({ length: OLVIDO_POR_IP }, () => () => olvido(ip, correoNuevo('olvido'))),
      );
      expect(estados).toEqual(Array.from({ length: OLVIDO_POR_IP }, () => ACEPTADO));

      esperarLimite(await olvido(ip, correoNuevo('olvido')));
    });

    it('por destinatario son tres por hora, desde la IP que sea: el mismo correo con cuatro X-Forwarded-For', async () => {
      const correo = correoNuevo('buzon');

      const estados = await estadosDe(Array.from({ length: POR_DESTINATARIO }, () => () => olvido(ipNueva(), correo)));
      expect(estados).toEqual(Array.from({ length: POR_DESTINATARIO }, () => ACEPTADO));

      esperarLimite(await olvido(ipNueva(), correo));
    });

    it('los dos ejes cuentan por separado: dos correos desde la misma IP tienen tres cada uno', async () => {
      const ip = ipNueva();
      const ana = correoNuevo('ana');
      const beto = correoNuevo('beto');

      for (let i = 0; i < POR_DESTINATARIO; i += 1) {
        expect((await olvido(ip, ana)).status).toBe(ACEPTADO);
        expect((await olvido(ip, beto)).status).toBe(ACEPTADO);
      }

      // Seis golpes por IP: lejos de los diez. Lo que se agoto es cada buzon.
      esperarLimite(await olvido(ip, ana));
      esperarLimite(await olvido(ip, beto));
      expect((await olvido(ip, correoNuevo('carla'))).status).toBe(ACEPTADO);
    });

    it('con el par en PROXY_DE_CONFIANZA, otra X-Forwarded-For es otra clave: la IP bloqueada no arrastra a la vecina', async () => {
      const bloqueada = ipNueva();
      await estadosDe(Array.from({ length: OLVIDO_POR_IP }, () => () => olvido(bloqueada, correoNuevo('x'))));
      esperarLimite(await olvido(bloqueada, correoNuevo('x')));

      expect((await olvido(ipNueva(), correoNuevo('vecina'))).status).toBe(ACEPTADO);
    });

    it('el golpe bloqueado tambien cuenta: insistir alarga la espera', async () => {
      const ip = ipNueva();
      await estadosDe(Array.from({ length: OLVIDO_POR_IP }, () => () => olvido(ip, correoNuevo('y'))));

      const primero = Number((await olvido(ip, correoNuevo('y'))).headers['retry-after']);
      const segundo = Number((await olvido(ip, correoNuevo('y'))).headers['retry-after']);

      expect(segundo).toBeGreaterThanOrEqual(primero);
      expect(
        Number(
          (await duena.query<{ n: string }>(`SELECT count(*)::text AS n FROM rate_limit_hit WHERE clave = $1`, [
            `ip:${ip}`,
          ])).rows[0]?.n,
        ),
      ).toBe(OLVIDO_POR_IP + 2);
    });
  });

  describe('en PARALELO: el limite se sostiene contra peticiones simultaneas (la 🔴 que faltaba, INC-007)', () => {
    /** Mas del umbral, todas a la vez: un limite de leer-luego-escribir deja pasar todas. */
    const EN_VUELO_POR_DESTINATARIO = 12;
    const EN_VUELO_POR_IP = 30;

    async function estadosEnParalelo(peticiones: readonly (() => request.Test)[]): Promise<number[]> {
      const respuestas = await Promise.all(peticiones.map((pedir) => pedir()));
      return respuestas.map((r) => r.status);
    }

    async function golpesDe(clave: string): Promise<number> {
      const { rows } = await duena.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM rate_limit_hit WHERE kind = 'password.olvido' AND clave = $1`,
        [clave],
      );
      return Number(rows[0]?.n ?? '0');
    }

    it('doce /olvido simultaneos al MISMO correo desde doce IP: exactamente tres 202, el resto 429, y doce golpes', async () => {
      const correo = correoNuevo('inundado');

      const estados = await estadosEnParalelo(
        Array.from({ length: EN_VUELO_POR_DESTINATARIO }, () => () => olvido(ipNueva(), correo)),
      );

      expect(estados.filter((e) => e === ACEPTADO)).toHaveLength(POR_DESTINATARIO);
      expect(estados.filter((e) => e === DEMASIADAS_PETICIONES)).toHaveLength(
        EN_VUELO_POR_DESTINATARIO - POR_DESTINATARIO,
      );
      const { rows } = await duena.query<{ clave: string }>(
        `SELECT clave FROM rate_limit_hit WHERE clave LIKE 'correo:%' AND kind = 'password.olvido'
          GROUP BY clave HAVING count(*) = $1`,
        [EN_VUELO_POR_DESTINATARIO],
      );
      expect(rows).toHaveLength(1);
    });

    it('treinta /olvido simultaneos desde la MISMA IP con treinta correos: exactamente diez 202 y treinta golpes', async () => {
      const ip = ipNueva();

      const estados = await estadosEnParalelo(
        Array.from({ length: EN_VUELO_POR_IP }, () => () => olvido(ip, correoNuevo('rafaga'))),
      );

      expect(estados.filter((e) => e === ACEPTADO)).toHaveLength(OLVIDO_POR_IP);
      expect(estados.filter((e) => e === DEMASIADAS_PETICIONES)).toHaveLength(EN_VUELO_POR_IP - OLVIDO_POR_IP);
      expect(await golpesDe(`ip:${ip}`)).toBe(EN_VUELO_POR_IP);
    });
  });

  describe('POST /auth/password/restablecimiento', () => {
    it('diez tokens invalidos por IP son diez 400; el undecimo es 429 antes de mirar el token', async () => {
      const ip = ipNueva();

      const estados = await estadosDe(Array.from({ length: RESTABLECIMIENTO_POR_IP }, () => () => restablecer(ip)));
      expect(estados).toEqual(Array.from({ length: RESTABLECIMIENTO_POR_IP }, () => PETICION_INVALIDA));

      esperarLimite(await restablecer(ip));
    });
  });

  describe('POST /usuarios', () => {
    it('el mismo destinatario tres veces es 202 las tres; la cuarta es 429', async () => {
      const ip = ipNueva();
      const nuevo = correoNuevo('invitado');

      const estados = await estadosDe(Array.from({ length: POR_DESTINATARIO }, () => () => invitar(ip, nuevo)));
      expect(estados).toEqual(Array.from({ length: POR_DESTINATARIO }, () => ACEPTADO));

      esperarLimite(await invitar(ip, nuevo));
    });

    it('treinta invitaciones por IP pasan; la trigesimo primera es 429', async () => {
      const ip = ipNueva();

      const estados = await estadosDe(
        Array.from({ length: INVITACION_POR_IP }, () => () => invitar(ip, correoNuevo('lote'))),
      );
      expect(estados).toEqual(Array.from({ length: INVITACION_POR_IP }, () => ACEPTADO));

      esperarLimite(await invitar(ip, correoNuevo('lote')));
    }, 120_000);
  });

  describe('POST /usuarios/:id/reenvio-de-invitacion', () => {
    it('el destinatario es el correo del invitado: tres reenvios pasan, el cuarto es 429', async () => {
      const nuevo = correoNuevo('reenvio');
      expect((await invitar(ipNueva(), nuevo)).status).toBe(ACEPTADO);
      const id = await unaFila(`SELECT id FROM app_user WHERE email = $1`, [nuevo]);

      const estados = await estadosDe(Array.from({ length: POR_DESTINATARIO }, () => () => reenviar(ipNueva(), id)));
      expect(estados).toEqual(Array.from({ length: POR_DESTINATARIO }, () => ACEPTADO));

      esperarLimite(await reenviar(ipNueva(), id));
    });

    it('un id que no existe cuenta por IP igual: treinta 404 y el siguiente es 429', async () => {
      const ip = ipNueva();

      const estados = await estadosDe(Array.from({ length: INVITACION_POR_IP }, () => () => reenviar(ip, randomUUID())));
      expect(estados).toEqual(Array.from({ length: INVITACION_POR_IP }, () => NO_ENCONTRADO));

      esperarLimite(await reenviar(ip, randomUUID()));
    });
  });

  describe('la IP que queda en login_attempt', () => {
    it('con el par confiable es el ultimo salto de X-Forwarded-For, no el socket', async () => {
      const ip = ipNueva();
      const respuesta = await request(servidor())
        .post('/auth/login')
        .set('X-Forwarded-For', `10.9.9.9, ${ip}`)
        .send({ email: admin, contrasena: 'no es esta' });
      expect(respuesta.status).toBe(NO_AUTORIZADO);

      const { rows } = await duena.query<{ ip: string }>(
        `SELECT host(ip) AS ip FROM login_attempt WHERE email = $1 ORDER BY at DESC LIMIT 1`,
        [admin],
      );
      expect(rows[0]?.ip).toBe(ip);
    });
  });

  it('las claves no llevan correos: `ip:` con la IP y `correo:` con un hash', async () => {
    const { rows } = await duena.query<{ clave: string }>(`SELECT clave FROM rate_limit_hit`);

    expect(rows.length).toBeGreaterThan(0);
    for (const { clave } of rows) {
      expect(clave).toMatch(/^(ip:\d{1,3}(\.\d{1,3}){3}|correo:[0-9a-f]{64})$/u);
      expect(clave).not.toContain('@');
    }
  });
});
