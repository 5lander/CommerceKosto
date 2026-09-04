/**
 * Barreras 3 y autorizacion, contra la aplicacion HTTP REAL y PostgreSQL real.
 *
 * ES EL CRITERIO DE ACEPTACION DE P1 en lo que no cubre
 * `aislamiento-entre-companies.spec.ts`:
 *
 *   - deny by default: sin cookie, 401 en toda ruta que no sea `@Publico()`
 *   - el tenant sale de la SESION: mandar `companyId` en el cuerpo es un 400
 *   - escalada VERTICAL: `GERENTE_LOCAL` no crea ubicaciones
 *   - escalada HORIZONTAL: `GERENTE_LOCAL` de A no ve la ubicacion B
 *   - el login no distingue "no existe" de "contrasena incorrecta"
 *   - cerrar sesion invalida DE VERDAD, en el servidor
 *   - cambiar la contrasena revoca TODAS las sesiones
 *   - el limite de ubicaciones del plan se cumple
 *   - invitacion y activacion de punta a punta, sin una credencial real
 *
 * Los tenants y sus usuarios se siembran con el rol DUENO (`costeo_migrator`),
 * igual que hace el back office en P11: la aplicacion no tiene INSERT sobre
 * `company`, y eso tambien se comprueba.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { MAILER_PORT } from '../../src/shared/application/ports/mailer.port';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { FakeMailer } from '../../src/shared/infrastructure/fakes/fake-mailer';

const OK = 200;
const CREADO = 201;
const ACEPTADO = 202;
const SIN_CONTENIDO = 204;
const PETICION_INVALIDA = 400;
const NO_AUTORIZADO = 401;
const PROHIBIDO = 403;
const CONFLICTO = 409;

const CONTRASENA = 'tres cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

interface Sembrado {
  readonly companyId: string;
  readonly locationA: string;
  readonly locationB: string;
  readonly owner: string;
  readonly admin: string;
  readonly gerente: string;
}

describe('autenticacion y autorizacion', () => {
  let app: INestApplication;
  let duena: Client;
  let uno: Sembrado;
  let otra: Sembrado;
  let sufijo: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function correoDe(usuario: string): string {
    return `${usuario}.${sufijo}@snacklab.ec`;
  }

  async function sembrarTenant(prefijo: string): Promise<Sembrado> {
    const hasher = new Argon2Hasher();
    const hash = await hasher.hash(CONTRASENA);

    const company = await unaFila(
      `INSERT INTO company (name, status, max_locations) VALUES ($1, 'ACTIVE', 10) RETURNING id`,
      [`${prefijo} ${sufijo}`],
    );

    const locationA = await unaFila(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [company, `${prefijo} centro`],
    );
    const locationB = await unaFila(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'BODEGA', 'ACTIVE') RETURNING id`,
      [company, `${prefijo} bodega`],
    );

    const crearUsuario = async (nombre: string): Promise<string> =>
      unaFila(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
        [company, correoDe(`${prefijo}-${nombre}`), hash],
      );

    const owner = await crearUsuario('owner');
    const admin = await crearUsuario('admin');
    const gerente = await crearUsuario('gerente');

    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'OWNER', false)`,
      [company, owner],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location) VALUES ($1, $2, 'ADMIN', false)`,
      [company, admin],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
       VALUES ($1, $2, 'GERENTE_LOCAL', $3, true)`,
      [company, gerente, locationA],
    );

    return { companyId: company, locationA, locationB, owner, admin, gerente };
  }

  async function unaFila(sql: string, valores: readonly unknown[]): Promise<string> {
    const { rows } = await duena.query<{ id: string }>(sql, [...valores]);
    const id = rows[0]?.id;
    if (id === undefined) {
      throw new Error(`La siembra no devolvio identificador: ${sql}`);
    }
    return id;
  }

  /** @returns la cookie de sesion, lista para reenviar. */
  async function entrar(email: string, contrasena = CONTRASENA): Promise<string> {
    const respuesta = await request(servidor())
      .post('/auth/login')
      .send({ email, contrasena });

    expect(respuesta.status).toBe(OK);

    const cookie = respuesta.headers['set-cookie']?.[0];
    if (cookie === undefined) {
      throw new Error('el login no devolvio cookie');
    }
    return cookie.split(';')[0] ?? '';
  }

  beforeAll(async () => {
    sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    // EL LIMITADOR SE SUBE A PROPOSITO PARA ESTA SUITE, y merece explicacion.
    //
    // Esta suite hace del orden de cien peticiones, y el limite por defecto son
    // 300 por minuto y por IP. Todas salen de 127.0.0.1, asi que dos corridas
    // seguidas —o una corrida despues de otra suite— empiezan a devolver 429 y
    // las pruebas fallan por una razon que no tiene NADA que ver con lo que
    // comprueban. Pasó de verdad al capturar la evidencia del guardian: los
    // fallos esperados salieron como "expected 429 to be 400".
    //
    // Un limite que estorba a las pruebas no se desactiva: se le da su propia
    // prueba, que es `limitador.spec.ts`, y aqui se sube para que esta suite
    // mida lo suyo.
    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    // SE LIMPIA `login_attempt` A PROPOSITO, y no es maquillaje.
    //
    // La politica anti fuerza bruta cuenta tambien POR IP, y todas las pruebas
    // salen de 127.0.0.1. Los fallos deliberados de una corrida —el login con
    // contrasena incorrecta, el activar con token usado— se acumulan y a la
    // enesima corrida bloquean la IP entera, con lo que la suite empieza a
    // fallar por una razon que no tiene que ver con lo que mide. Cada corrida
    // parte de cero, como parte de cero su tenant.
    await duena.query('DELETE FROM login_attempt');

    uno = await sembrarTenant('uno');
    otra = await sembrarTenant('otra');
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  describe('deny by default', () => {
    it('sin cookie, listar ubicaciones es 401', async () => {
      const respuesta = await request(servidor()).get('/ubicaciones');

      expect(respuesta.status).toBe(NO_AUTORIZADO);
      expect(respuesta.body).toMatchObject({ code: 'SESION_INVALIDA' });
    });

    it('con una cookie inventada, tambien', async () => {
      const respuesta = await request(servidor())
        .get('/ubicaciones')
        .set('Cookie', 'sesion=no-es-un-token-de-verdad');

      expect(respuesta.status).toBe(NO_AUTORIZADO);
    });

    it('las sondas de salud SI son publicas: un orquestador no tiene credenciales', async () => {
      expect((await request(servidor()).get('/health')).status).toBe(OK);
    });
  });

  describe('login', () => {
    it('la cookie es HttpOnly, SameSite=Strict y de ruta raiz', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });

      const cookie = respuesta.headers['set-cookie']?.[0] ?? '';
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
      expect(cookie).toContain('Path=/');
    });

    it('el token NO viaja en el cuerpo: eso anularia el HttpOnly', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });

      expect(Object.keys(respuesta.body as object)).toEqual(['expiraEn']);
    });

    it('correo desconocido y contrasena incorrecta dan LA MISMA respuesta', async () => {
      const desconocido = await request(servidor())
        .post('/auth/login')
        .send({ email: `nadie.${sufijo}@snacklab.ec`, contrasena: CONTRASENA });

      const incorrecta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: 'otra cosa distinta' });

      expect(desconocido.status).toBe(NO_AUTORIZADO);
      expect(incorrecta.status).toBe(NO_AUTORIZADO);
      expect(desconocido.body).toEqual(incorrecta.body);
    });

    it('un cuerpo con una clave de mas se RECHAZA, no se limpia en silencio', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA, companyId: otra.companyId });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });
  });

  describe('el tenant sale de la sesion', () => {
    it('el ADMIN de una company ve sus DOS ubicaciones y ninguna ajena', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor()).get('/ubicaciones').set('Cookie', cookie);

      const ids = (respuesta.body as { id: string }[]).map((u) => u.id);
      expect(ids).toHaveLength(2);
      expect(ids).toContain(uno.locationA);
      expect(ids).not.toContain(otra.locationA);
    });

    it('ni pasando el identificador de la otra company', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .get('/ubicaciones')
        .query({ companyId: otra.companyId })
        .set('Cookie', cookie);

      const ids = (respuesta.body as { id: string }[]).map((u) => u.id);
      expect(ids).not.toContain(otra.locationA);
    });
  });

  describe('escalada vertical', () => {
    it('GERENTE_LOCAL no puede crear ubicaciones', async () => {
      const cookie = await entrar(correoDe('uno-gerente'));

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie)
        .send({ nombre: 'Sucursal pirata', tipo: 'LOCAL' });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('ADMIN si puede', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie)
        .send({ nombre: `Sucursal ${randomUUID().slice(0, 6)}`, tipo: 'LOCAL' });

      expect(respuesta.status).toBe(CREADO);
    });
  });

  describe('escalada horizontal', () => {
    it('GERENTE_LOCAL solo ve SU ubicacion, no las de su company', async () => {
      const cookie = await entrar(correoDe('uno-gerente'));

      const respuesta = await request(servidor()).get('/ubicaciones').set('Cookie', cookie);

      const ids = (respuesta.body as { id: string }[]).map((u) => u.id);
      expect(ids).toEqual([uno.locationA]);
      expect(ids).not.toContain(uno.locationB);
    });
  });

  describe('cierre de sesion', () => {
    it('invalida en el SERVIDOR, no solo en el navegador', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      expect((await request(servidor()).get('/ubicaciones').set('Cookie', cookie)).status).toBe(OK);
      expect(
        (await request(servidor()).post('/auth/logout').set('Cookie', cookie)).status,
      ).toBe(SIN_CONTENIDO);

      // La MISMA cookie, reenviada a mano: si el cierre fuera solo borrar la
      // cookie del navegador, esto seguiria funcionando.
      const despues = await request(servidor()).get('/ubicaciones').set('Cookie', cookie);
      expect(despues.status).toBe(NO_AUTORIZADO);
    });
  });

  describe('limite de ubicaciones del plan', () => {
    it('al llegar al maximo, crear devuelve 409 y no crea', async () => {
      const cookie = await entrar(correoDe('otra-admin'));
      await duena.query(`UPDATE company SET max_locations = 2 WHERE id = $1`, [otra.companyId]);

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie)
        .send({ nombre: 'Una de mas', tipo: 'LOCAL' });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(respuesta.body).toMatchObject({ code: 'LIMITE_DEL_PLAN' });

      const { rows } = await duena.query<{ total: string }>(
        `SELECT count(*) AS total FROM location WHERE company_id = $1`,
        [otra.companyId],
      );
      expect(rows[0]?.total).toBe('2');
    });
  });

  describe('invitacion y activacion, sin una sola credencial real', () => {
    it('el ADMIN invita, el invitado activa y entra', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const nuevo = `nuevo.${randomUUID().slice(0, 8)}@snacklab.ec`;

      const invitacion = await request(servidor())
        .post('/usuarios')
        .set('Cookie', cookie)
        .send({ email: nuevo });
      expect(invitacion.status).toBe(ACEPTADO);

      const token = tokenDelCorreo(app, nuevo);

      const activacion = await request(servidor())
        .post('/usuarios/activacion')
        .send({ token, contrasena: 'higos secos en almibar' });
      expect(activacion.status).toBe(SIN_CONTENIDO);

      const entrada = await request(servidor())
        .post('/auth/login')
        .send({ email: nuevo, contrasena: 'higos secos en almibar' });
      expect(entrada.status).toBe(OK);
    });

    it('el mismo token no sirve dos veces', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const nuevo = `otro.${randomUUID().slice(0, 8)}@snacklab.ec`;

      await request(servidor()).post('/usuarios').set('Cookie', cookie).send({ email: nuevo });
      const token = tokenDelCorreo(app, nuevo);

      await request(servidor())
        .post('/usuarios/activacion')
        .send({ token, contrasena: 'primera vez con esta' });

      const segunda = await request(servidor())
        .post('/usuarios/activacion')
        .send({ token, contrasena: 'segunda vez con otra' });

      expect(segunda.status).toBe(NO_AUTORIZADO);
    });

    it('una contrasena de la lista de filtradas se rechaza al activar', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const nuevo = `debil.${randomUUID().slice(0, 8)}@snacklab.ec`;

      await request(servidor()).post('/usuarios').set('Cookie', cookie).send({ email: nuevo });
      const token = tokenDelCorreo(app, nuevo);

      const respuesta = await request(servidor())
        .post('/usuarios/activacion')
        .send({ token, contrasena: 'restaurante2026' });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
    });

    it('invitar un correo YA en uso responde igual: no es un oraculo', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios')
        .set('Cookie', cookie)
        .send({ email: correoDe('otra-admin') });

      expect(respuesta.status).toBe(ACEPTADO);
      expect(respuesta.body).toEqual({});
    });
  });

  describe('roles', () => {
    it('un ADMIN no puede tocar los roles del OWNER', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .delete('/usuarios/roles')
        .set('Cookie', cookie)
        .send({ userId: uno.owner, rol: 'OWNER', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('nadie modifica sus propios roles', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie)
        .send({ userId: uno.admin, rol: 'LECTURA', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('un usuario de OTRA company no existe: 404, no 204 en silencio', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie)
        .send({ userId: otra.admin, rol: 'LECTURA', locationId: null });

      expect(respuesta.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
    });

    it('GERENTE_LOCAL sin ubicacion se rechaza antes de tocar la base', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie)
        .send({ userId: uno.gerente, rol: 'GERENTE_LOCAL', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
    });

    it('asignar el mismo rol dos veces es idempotente', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const datos = { userId: uno.gerente, rol: 'LECTURA', locationId: null };

      await request(servidor()).post('/usuarios/roles').set('Cookie', cookie).send(datos);
      const segunda = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie)
        .send(datos);

      expect(segunda.status).toBe(SIN_CONTENIDO);

      const { rows } = await duena.query<{ total: string }>(
        `SELECT count(*) AS total FROM user_role WHERE user_id = $1 AND role_code = 'LECTURA'`,
        [uno.gerente],
      );
      expect(rows[0]?.total).toBe('1');
    });
  });

  describe('cambio de contrasena', () => {
    it('revoca TODAS las sesiones, incluida la que lo pide', async () => {
      const cookie = await entrar(correoDe('otra-gerente'));
      const otraSesion = await entrar(correoDe('otra-gerente'));

      const respuesta = await request(servidor())
        .post('/auth/password')
        .set('Cookie', cookie)
        .send({
          email: correoDe('otra-gerente'),
          actual: CONTRASENA,
          nueva: 'pimientos del piquillo asados',
        });

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toMatchObject({ sesionesRevocadas: 2 });

      // La OTRA sesion, que ni siquiera participo, tambien se cae.
      expect((await request(servidor()).get('/ubicaciones').set('Cookie', otraSesion)).status).toBe(
        NO_AUTORIZADO,
      );
    });

    it('exige la contrasena actual aunque ya haya sesion', async () => {
      const cookie = await entrar(correoDe('otra-admin'));

      const respuesta = await request(servidor())
        .post('/auth/password')
        .set('Cookie', cookie)
        .send({ email: correoDe('otra-admin'), actual: 'no es esta', nueva: 'chirimoyas del valle' });

      expect(respuesta.status).toBe(NO_AUTORIZADO);
    });
  });
});

/**
 * Saca el token de invitacion del correo que guardo el adaptador falso.
 *
 * Es lo que permite probar la invitacion de punta a punta sin una cuenta de
 * correo: criterio de aceptacion de P0 (CLAUDE.md §12) usado por primera vez.
 */
function tokenDelCorreo(app: INestApplication, destino: string): string {
  const mailer = app.get<FakeMailer>(MAILER_PORT);
  const mensaje = [...mailer.sent].reverse().find((m) => m.to === destino);

  if (mensaje === undefined) {
    throw new Error(`no se envio ninguna invitacion a ${destino}`);
  }

  const token = mensaje.body
    .split('\n')
    .map((linea) => linea.trim())
    // El token es la unica linea con pinta de base64url largo. Se busca por
    // FORMA y no por posicion: si manana el texto del correo cambia, la prueba
    // sigue encontrandolo en vez de romperse por una linea de mas.
    .find((linea) => /^[\w-]{40,}$/u.test(linea));

  if (token === undefined) {
    throw new Error('el correo de invitacion no lleva token');
  }
  return token;
}
