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
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

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
      `INSERT INTO company (name, status, plan_code) VALUES ($1, 'ACTIVE', 'BASICO') RETURNING id`,
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

    const cookie = cookieConCsrf(respuesta);
    if (cookie === '') {
      throw new Error('el login no devolvio cookie');
    }
    return cookie;
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
    // Y `rate_limit_hit` por lo mismo: `POST /usuarios` cuenta por IP (D-16.50).
    await duena.query('DELETE FROM rate_limit_hit');

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

    it('el token de SESION no viaja en el cuerpo: eso anularia el HttpOnly', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });

      // DESDE P16-A2 EL CUERPO LLEVA DOS COSAS, y la lista sigue siendo cerrada
      // a proposito: `csrf` es el token anti-CSRF (ADR-021), que TIENE que ser
      // legible por la pagina, y el de sesion sigue sin estar aqui.
      expect(Object.keys(respuesta.body as object).sort()).toEqual(['csrf', 'expiraEn']);

      const cookie = respuesta.headers['set-cookie']?.[0] ?? '';
      const token = decodeURIComponent((cookie.split(';')[0] ?? '').split('=')[1] ?? '');
      expect(token).not.toBe('');
      expect(respuesta.text).not.toContain(token);
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

      const respuesta = await request(servidor()).get('/ubicaciones').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      const ids = (respuesta.body as { id: string }[]).map((u) => u.id);
      expect(ids).not.toContain(otra.locationA);
    });
  });

  describe('escalada vertical', () => {
    it('GERENTE_LOCAL no puede crear ubicaciones', async () => {
      const cookie = await entrar(correoDe('uno-gerente'));

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre: 'Sucursal pirata', tipo: 'LOCAL' });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('ADMIN si puede', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre: `Sucursal ${randomUUID().slice(0, 6)}`, tipo: 'LOCAL' });

      expect(respuesta.status).toBe(CREADO);
    });
  });

  describe('escalada horizontal', () => {
    it('GERENTE_LOCAL solo ve SU ubicacion, no las de su company', async () => {
      const cookie = await entrar(correoDe('uno-gerente'));

      const respuesta = await request(servidor()).get('/ubicaciones').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

      const ids = (respuesta.body as { id: string }[]).map((u) => u.id);
      expect(ids).toEqual([uno.locationA]);
      expect(ids).not.toContain(uno.locationB);
    });

    /**
     * VIVE AQUI Y NO CON LAS DEMAS PRUEBAS DE CSRF, y no por gusto: el bloque
     * `roles` le asigna `LECTURA` —un rol de company— al mismo gerente, asi que
     * despues de el su alcance ya no es de ubicaciones. El orden de los
     * `describe` es parte del dato que esta prueba mira.
     */
    it('GET /auth/sesion publica el alcance como UNION, sin aplanarlo a una lista', async () => {
      const cookie = await entrar(correoDe('uno-gerente'));

      const respuesta = await request(servidor()).get('/auth/sesion').set('Cookie', cookie);

      expect(respuesta.status).toBe(OK);
      // Un `ubicaciones: []` que significara «todas» es la convencion que
      // alguien lee al reves una vez y convierte en fuga. El contrato publico
      // dice los dos casos con su nombre, igual que el puerto.
      expect((respuesta.body as { alcance: unknown }).alcance).toEqual({
        clase: 'ubicaciones',
        ids: [uno.locationA],
      });
    });
  });

  describe('cierre de sesion', () => {
    it('invalida en el SERVIDOR, no solo en el navegador', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      expect((await request(servidor()).get('/ubicaciones').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))).status).toBe(OK);
      expect(
        (await request(servidor()).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))).status,
      ).toBe(SIN_CONTENIDO);

      // La MISMA cookie, reenviada a mano: si el cierre fuera solo borrar la
      // cookie del navegador, esto seguiria funcionando.
      const despues = await request(servidor()).get('/ubicaciones').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));
      expect(despues.status).toBe(NO_AUTORIZADO);
    });
  });

  describe('limite de ubicaciones del plan', () => {
    it('al llegar al maximo, crear devuelve 409 y no crea', async () => {
      const cookie = await entrar(correoDe('otra-admin'));

      // DESDE P11 EL LIMITE VIVE EN EL PLAN, no en una columna de la company que
      // una prueba pueda bajar a 2. Se llena hasta el tope REAL del plan, que
      // ademas prueba el camino de verdad: el `FOR UPDATE` sobre la fila de
      // `company` con el `JOIN` al plan.
      const { rows: limites } = await duena.query<{ max_locations: number }>(
        `SELECT p.max_locations FROM company c JOIN plan p ON p.code = c.plan_code WHERE c.id = $1`,
        [otra.companyId],
      );
      const maximo = limites[0]?.max_locations ?? 0;

      const { rows: actuales } = await duena.query<{ total: string }>(
        `SELECT count(*) AS total FROM location WHERE company_id = $1`,
        [otra.companyId],
      );
      for (let n = Number(actuales[0]?.total ?? '0'); n < maximo; n += 1) {
        await duena.query(
          `INSERT INTO location (company_id, name, type, status)
           VALUES ($1, $2, 'LOCAL', 'ACTIVE')`,
          [otra.companyId, `Relleno ${String(n)}`],
        );
      }

      const respuesta = await request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre: 'Una de mas', tipo: 'LOCAL' });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(respuesta.body).toMatchObject({ code: 'LIMITE_DEL_PLAN' });

      const { rows } = await duena.query<{ total: string }>(
        `SELECT count(*) AS total FROM location WHERE company_id = $1`,
        [otra.companyId],
      );
      expect(Number(rows[0]?.total)).toBe(maximo);
    });
  });

  describe('invitacion y activacion, sin una sola credencial real', () => {
    it('el ADMIN invita, el invitado activa y entra', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const nuevo = `nuevo.${randomUUID().slice(0, 8)}@snacklab.ec`;

      const invitacion = await request(servidor())
        .post('/usuarios')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ email: nuevo });
      expect(invitacion.status).toBe(ACEPTADO);

      const token = await tokenDelCorreo(duena, nuevo);

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

      await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
      const token = await tokenDelCorreo(duena, nuevo);

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

      await request(servidor()).post('/usuarios').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send({ email: nuevo });
      const token = await tokenDelCorreo(duena, nuevo);

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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ userId: uno.owner, rol: 'OWNER', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
      // EL CODIGO, NO SOLO EL ESTADO: desde P16-A2 hay dos 403 distintos, y una
      // mutacion sin `X-CSRF-Token` responde 403 antes de llegar a los permisos.
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('nadie modifica sus propios roles', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ userId: uno.admin, rol: 'LECTURA', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('un usuario de OTRA company no existe: 404, no 204 en silencio', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ userId: otra.admin, rol: 'LECTURA', locationId: null });

      expect(respuesta.body).toMatchObject({ code: 'RECURSO_NO_ENCONTRADO' });
    });

    it('GERENTE_LOCAL sin ubicacion se rechaza antes de tocar la base', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ userId: uno.gerente, rol: 'GERENTE_LOCAL', locationId: null });

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('asignar el mismo rol dos veces es idempotente', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const datos = { userId: uno.gerente, rol: 'LECTURA', locationId: null };

      await request(servidor()).post('/usuarios/roles').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie)).send(datos);
      const segunda = await request(servidor())
        .post('/usuarios/roles')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
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
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({
          email: correoDe('otra-gerente'),
          actual: CONTRASENA,
          nueva: 'pimientos del piquillo asados',
        });

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toMatchObject({ sesionesRevocadas: 2 });

      // La OTRA sesion, que ni siquiera participo, tambien se cae.
      expect((await request(servidor()).get('/ubicaciones').set('Cookie', otraSesion).set('X-CSRF-Token', csrfDe(otraSesion))).status).toBe(
        NO_AUTORIZADO,
      );
    });

    it('exige la contrasena actual aunque ya haya sesion', async () => {
      const cookie = await entrar(correoDe('otra-admin'));

      const respuesta = await request(servidor())
        .post('/auth/password')
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ email: correoDe('otra-admin'), actual: 'no es esta', nueva: 'chirimoyas del valle' });

      expect(respuesta.status).toBe(NO_AUTORIZADO);
    });
  });

  /**
   * EL TOKEN ANTI-CSRF — U4, SEGURIDAD.md 4.2, ADR-021.
   *
   * Lo que estas pruebas defienden, dicho como ataque: una pagina cualquiera
   * que la victima visite con su sesion abierta hace `POST /ubicaciones`. El
   * navegador adjunta la cookie —`SameSite=Strict` deberia impedirlo, pero eso
   * lo decide el navegador, no la API— y sin token la sucursal se crea. Con
   * token no, porque el sitio cruzado no puede leerlo ni ponerlo en una
   * cabecera.
   *
   * Se prueban los CUATRO estados de la cabecera —ausente, ajena, correcta y
   * ruta publica— porque el fallo tipico de un CSRF mal hecho no es que
   * rechace: es que ACEPTE cualquier cosa que venga.
   */
  describe('las lecturas de la pantalla de usuarios y editar una ubicacion (P16-C)', () => {
    /** Las claves exactas de `GET /usuarios`: un campo nuevo tiene que decidirse, no colarse (D-16.98). */
    const CLAVES_DE_USUARIO = ['correoInvitacion', 'email', 'estado', 'id', 'invitacionCaducaEn', 'roles'];

    async function usuarios(cookie: string) {
      return request(servidor()).get('/usuarios').set('Cookie', cookie);
    }

    it('ADMIN lista a los usuarios de SU company, con sus roles, y ninguno de la otra (R1)', async () => {
      const respuesta = await usuarios(await entrar(correoDe('uno-admin')));

      expect(respuesta.status).toBe(OK);
      const lista = respuesta.body as { id: string; email: string; roles: { rol: string; locationId: string | null }[] }[];
      const ids = lista.map((u) => u.id);
      expect(ids).toEqual(expect.arrayContaining([uno.owner, uno.admin, uno.gerente]));
      expect(ids).not.toContain(otra.admin);
      expect(Object.keys(lista[0] ?? {}).sort()).toEqual(CLAVES_DE_USUARIO);
      // `toContainEqual` y no `toEqual`: otras pruebas de la suite le asignan roles de más.
      expect(lista.find((u) => u.id === uno.gerente)?.roles).toContainEqual({ rol: 'GERENTE_LOCAL', locationId: uno.locationA });
    });

    /**
     * Con un gerente PROPIO, de la bodega: el sembrado de la suite acumula roles
     * de otras pruebas (un `LECTURA` de company, entre ellos) y su alcance deja de
     * ser de ubicaciones.
     */
    it('🔴 un GERENTE_LOCAL solo ve a quien tiene un rol en SU ubicacion, y solo esas asignaciones', async () => {
      const gerenteDeBodega = await unaFila(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         SELECT company_id, $1, password_hash, 'ACTIVE' FROM app_user WHERE id = $2 RETURNING id`,
        [correoDe('uno-gerente-bodega'), uno.admin],
      );
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
         VALUES ($1, $2, 'GERENTE_LOCAL', $3, true)`,
        [uno.companyId, gerenteDeBodega, uno.locationB],
      );

      const respuesta = await usuarios(await entrar(correoDe('uno-gerente-bodega')));

      expect(respuesta.status).toBe(OK);
      const lista = respuesta.body as { id: string; roles: { locationId: string | null }[] }[];
      const ids = lista.map((u) => u.id);
      expect(ids).toContain(gerenteDeBodega);
      expect(ids).not.toContain(uno.owner);
      expect(ids).not.toContain(uno.admin);
      expect(ids).not.toContain(uno.gerente);
      expect(new Set(lista.flatMap((u) => u.roles.map((r) => r.locationId)))).toEqual(new Set([uno.locationB]));
    });

    it('🔴 BODEGA no lista usuarios (no tiene user.read)', async () => {
      const bodega = await unaFila(
        `INSERT INTO app_user (company_id, email, password_hash, status)
         SELECT company_id, $1, password_hash, 'ACTIVE' FROM app_user WHERE id = $2 RETURNING id`,
        [correoDe('uno-bodega'), uno.admin],
      );
      await duena.query(
        `INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location)
         VALUES ($1, $2, 'BODEGA', $3, true)`,
        [uno.companyId, bodega, uno.locationB],
      );

      const respuesta = await usuarios(await entrar(correoDe('uno-bodega')));

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });

    it('🔴 un invitado trae su caducidad y el estado de su ultimo correo, con el error, y NUNCA sus datos ni su token', async () => {
      const invitado = await unaFila(
        `INSERT INTO app_user (company_id, email, status, invitation_token_hash, invitation_expires_at)
         VALUES ($1, $2, 'INVITED', $3, now() + interval '7 days') RETURNING id`,
        [uno.companyId, correoDe('uno-invitado'), `hash-${randomUUID()}`],
      );
      // Dos correos: el primero se entregó y el segundo —el reenvío— falló. Manda el último.
      await duena.query(
        `INSERT INTO email_outbox (company_id, user_id, destinatario, plantilla, datos, estado, sent_at, created_at)
         VALUES ($1, $2, $3, 'INVITACION', '{"enlace":"https://app/activacion?token=secreto-viejo"}', 'ENVIADO', now(), now() - interval '1 hour')`,
        [uno.companyId, invitado, correoDe('uno-invitado')],
      );
      await duena.query(
        `INSERT INTO email_outbox (company_id, user_id, destinatario, plantilla, datos, estado, intentos, error)
         VALUES ($1, $2, $3, 'INVITACION', '{"enlace":"https://app/activacion?token=secreto-en-vuelo"}', 'FALLIDO', 5, 'Resend respondio 422 al enviar el correo.')`,
        [uno.companyId, invitado, correoDe('uno-invitado')],
      );

      const respuesta = await usuarios(await entrar(correoDe('uno-admin')));
      const suyo = (respuesta.body as { id: string; estado: string; invitacionCaducaEn: string | null; correoInvitacion: unknown }[])
        .find((u) => u.id === invitado);

      expect(suyo?.estado).toBe('INVITED');
      expect(suyo?.invitacionCaducaEn).not.toBeNull();
      expect(suyo?.correoInvitacion).toEqual({ estado: 'FALLIDO', error: 'Resend respondio 422 al enviar el correo.' });
      const crudo = JSON.stringify(respuesta.body);
      expect(crudo).not.toContain('token=');
      expect(crudo).not.toContain('secreto');
      expect(crudo).not.toContain('datos');
    });

    it('un usuario activo no trae correo de invitacion ni caducidad', async () => {
      const respuesta = await usuarios(await entrar(correoDe('uno-admin')));
      const admin = (respuesta.body as { id: string; invitacionCaducaEn: unknown; correoInvitacion: unknown }[]).find((u) => u.id === uno.admin);

      expect(admin?.invitacionCaducaEn).toBeNull();
      expect(admin?.correoInvitacion).toBeNull();
    });

    it('GET /roles trae el catalogo: cuales piden ubicacion y con que permisos', async () => {
      const respuesta = await request(servidor()).get('/roles').set('Cookie', await entrar(correoDe('uno-admin')));

      expect(respuesta.status).toBe(OK);
      const roles = respuesta.body as { codigo: string; requiereUbicacion: boolean; permisos: string[] }[];
      expect(roles.map((r) => r.codigo)).toEqual(['ADMIN', 'BODEGA', 'GERENTE_LOCAL', 'LECTURA', 'OWNER']);
      expect(roles.find((r) => r.codigo === 'GERENTE_LOCAL')?.requiereUbicacion).toBe(true);
      const bodega = roles.find((r) => r.codigo === 'BODEGA')?.permisos ?? [];
      expect(bodega).toContain('inventory.write');
      expect(bodega).not.toContain('inventory.read');
    });

    it('ADMIN renombra una ubicacion: 200 con la ubicacion como queda', async () => {
      const cookie = await entrar(correoDe('uno-admin'));
      const nombre = `uno bodega norte ${randomUUID().slice(0, 6)}`;

      const respuesta = await request(servidor())
        .put(`/ubicaciones/${uno.locationB}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre, tipo: 'AMBOS' });

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toEqual({ id: uno.locationB, nombre, tipo: 'AMBOS', estado: 'ACTIVE' });
    });

    it('🔴 un nombre que ya usa otra ubicacion de la company es 409 con el nombre, no un 500 del indice unico', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor())
        .put(`/ubicaciones/${uno.locationB}`)
        .set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie))
        .send({ nombre: 'uno centro', tipo: 'BODEGA' });

      expect(respuesta.status).toBe(CONFLICTO);
      expect(respuesta.body).toMatchObject({ code: 'CONFLICTO' });
      expect((respuesta.body as { message: string }).message).toContain('uno centro');
    });

    /**
     * 403 Y NO 404 para la de otra company: es lo que responde TODA ruta por
     * ubicación desde P15 (`exigirUbicacionEnAlcance` mira primero las ubicaciones
     * de la company de la sesión). Un 404 solo aquí sería un segundo contrato.
     */
    it('🔴 la ubicacion de OTRA company es 403 y no la toca; un GERENTE_LOCAL no edita ni la suya', async () => {
      const admin = await entrar(correoDe('uno-admin'));
      const gerente = await entrar(correoDe('uno-gerente'));

      const ajena = await request(servidor())
        .put(`/ubicaciones/${otra.locationA}`)
        .set('Cookie', admin).set('X-CSRF-Token', csrfDe(admin))
        .send({ nombre: 'secuestrada', tipo: 'LOCAL' });
      const suya = await request(servidor())
        .put(`/ubicaciones/${uno.locationA}`)
        .set('Cookie', gerente).set('X-CSRF-Token', csrfDe(gerente))
        .send({ nombre: 'mi local', tipo: 'LOCAL' });

      expect(ajena.status).toBe(PROHIBIDO);
      expect(ajena.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
      const { rows } = await duena.query<{ name: string }>('SELECT name FROM location WHERE id = $1', [otra.locationA]);
      expect(rows[0]?.name).not.toBe('secuestrada');
      expect(suya.status).toBe(PROHIBIDO);
      expect(suya.body).toMatchObject({ code: 'PERMISO_DENEGADO' });
    });
  });

  describe('token anti-CSRF', () => {
    /** Una mutacion cualquiera, de las que el ADMIN puede hacer. */
    function crearUbicacion(cookie: string): request.Test {
      return request(servidor())
        .post('/ubicaciones')
        .set('Cookie', cookie)
        .send({ nombre: `Sucursal ${randomUUID().slice(0, 6)}`, tipo: 'LOCAL' });
    }

    it('una mutacion SIN la cabecera es 403 CSRF_INVALIDO', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await crearUbicacion(cookie);

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'CSRF_INVALIDO' });
    });

    it('con el token de OTRA sesion es 403: no basta con traer «un» token', async () => {
      const mia = await entrar(correoDe('uno-admin'));
      const ajena = await entrar(correoDe('otra-admin'));

      const respuesta = await crearUbicacion(mia).set('X-CSRF-Token', csrfDe(ajena));

      expect(respuesta.status).toBe(PROHIBIDO);
      expect(respuesta.body).toMatchObject({ code: 'CSRF_INVALIDO' });
    });

    it('con el token de su propia sesion, pasa', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await crearUbicacion(cookie).set('X-CSRF-Token', csrfDe(cookie));

      expect(respuesta.status).toBe(CREADO);
    });

    it('una LECTURA no necesita token: el CSRF va contra los efectos', async () => {
      const cookie = await entrar(correoDe('uno-admin'));

      const respuesta = await request(servidor()).get('/ubicaciones').set('Cookie', cookie);

      expect(respuesta.status).toBe(OK);
    });

    it('una ruta publica sigue funcionando sin cabecera: no hay sesion que proteger', async () => {
      const respuesta = await request(servidor())
        .post('/auth/password/olvido')
        .send({ email: correoDe('uno-admin') });

      expect(respuesta.status).toBe(ACEPTADO);
    });

    /**
     * EL LOGIN ES PUBLICO, PERO NO POR LA RAZON QUE DECIA EL GUARD. Una peticion
     * cruzada al login no USA una credencial, la CREA: si colara, la victima se
     * quedaria con la sesion del ATACANTE abierta y escribiria sus conteos
     * dentro de la company de el. Lo que lo impide es que la API solo analiza
     * `application/json` (`bootstrap.ts`), y `application/json` es justo lo que
     * un `<form>` cruzado no puede emitir. Con el `urlencoded` que Nest monta
     * por defecto, esto devolvia 200 y `Set-Cookie`.
     */
    it('un formulario cruzado no puede iniciar sesion: el cuerpo va en JSON o no va', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .type('form')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect(respuesta.body).toMatchObject({ code: 'ENTRADA_INVALIDA' });
      expect(respuesta.headers['set-cookie']).toBeUndefined();
    });

    it('el login lo devuelve en el CUERPO y NO en ninguna cookie', async () => {
      const respuesta = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });

      const csrf = (respuesta.body as { readonly csrf: string }).csrf;
      expect(typeof csrf).toBe('string');
      expect(csrf.length).toBeGreaterThan(0);

      // Una cookie con el token seria el mismo canal que se esta protegiendo:
      // el navegador la mandaria sola en la peticion cruzada.
      const cookies = respuesta.headers['set-cookie'] ?? [];
      expect(cookies).toHaveLength(1);
      for (const cookie of cookies) {
        expect(cookie).not.toContain(csrf);
        expect(cookie.toLowerCase()).not.toContain('csrf');
      }
    });

    it('GET /auth/sesion devuelve el MISMO token que el login, y quien eres', async () => {
      const login = await request(servidor())
        .post('/auth/login')
        .send({ email: correoDe('uno-admin'), contrasena: CONTRASENA });
      const cookie = cookieConCsrf(login);

      const sesion = await request(servidor()).get('/auth/sesion').set('Cookie', cookie);

      expect(sesion.status).toBe(OK);
      const cuerpo = sesion.body as {
        readonly userId: string;
        readonly permisos: readonly string[];
        readonly alcance: { readonly clase: string; readonly ids?: readonly string[] };
        readonly csrf: string;
      };
      // Es LO QUE PERMITE RECARGAR LA PAGINA sin rotar el token: el del login
      // vive en memoria del navegador y la recarga se lo lleva; la cookie no.
      expect(cuerpo.csrf).toBe((login.body as { readonly csrf: string }).csrf);
      expect(cuerpo.alcance).toEqual({ clase: 'company' });
      expect(cuerpo.permisos.length).toBeGreaterThan(0);
      expect(cuerpo.userId).toMatch(/^[0-9a-f-]{36}$/u);
      // El tenant NO sale: no es un dato que el cliente pueda usar (Barrera 3).
      expect(cuerpo).not.toHaveProperty('companyId');
    });

    /**
     * LO QUE ESTA PRUEBA CLAVA ES QUE `IniciarSesion` NO REVOCA NADA. Cada login
     * abre una sesion nueva con SU token; la anterior sigue viva con el suyo, y
     * eso es lo que permite tener el movil y el ordenador a la vez.
     *
     * Su version anterior se titulaba «volver a entrar rota el token, y el
     * anterior deja de servir» y media cookie-NUEVA + token-VIEJO, que es
     * exactamente el caso de la prueba de mas arriba: dos pruebas para un solo
     * hecho, y el hecho que anunciaba el titulo —falso— sin cubrir. Caso 11 de
     * INC-007: una verificacion en verde que no mide lo que dice.
     */
    it('cada sesion lleva SU token, y la anterior sigue sirviendo con el suyo', async () => {
      const primera = await entrar(correoDe('uno-admin'));
      const segunda = await entrar(correoDe('uno-admin'));

      expect(csrfDe(segunda)).not.toBe(csrfDe(primera));

      // La sesion vieja con su token viejo: sigue siendo una sesion entera.
      const conLaVieja = await crearUbicacion(primera).set('X-CSRF-Token', csrfDe(primera));
      expect(conLaVieja.status).toBe(CREADO);

      // Y los tokens no son intercambiables ni entre dos sesiones del MISMO
      // usuario: el token pertenece a la fila de la sesion, no a la cuenta.
      const cruzado = await crearUbicacion(primera).set('X-CSRF-Token', csrfDe(segunda));
      expect(cruzado.status).toBe(PROHIBIDO);
      expect(cruzado.body).toMatchObject({ code: 'CSRF_INVALIDO' });
    });

    it('una sesion anterior a la migracion es invalida: 401, no 403', async () => {
      // Se fabrica el caso exacto del despliegue: la fila existe, es vigente, y
      // no tiene `csrf_token` porque se abrio antes de que la columna existiera.
      const cookie = await entrar(correoDe('uno-admin'));
      const token = cookie.split('=')[1] ?? '';
      await duena.query(
        `UPDATE "session" SET "csrf_token" = NULL
          WHERE "token_hash" = encode(sha256($1::bytea), 'hex')`,
        [decodeURIComponent(token)],
      );

      // NI SIQUIERA LEE. Media sesion no es una sesion: se corta con 401 para
      // que el usuario vuelva a entrar, en vez de dejarle navegar y descubrir
      // el problema al pulsar «Guardar» (ADR-021).
      const lectura = await request(servidor()).get('/ubicaciones').set('Cookie', cookie);
      expect(lectura.status).toBe(NO_AUTORIZADO);
      expect(lectura.body).toMatchObject({ code: 'SESION_INVALIDA' });

      const mutacion = await crearUbicacion(cookie).set('X-CSRF-Token', csrfDe(cookie));
      expect(mutacion.status).toBe(NO_AUTORIZADO);
    });
  });
});

/**
 * Saca el token de invitacion del correo ENCOLADO, leyendo `email_outbox` con
 * la duena.
 *
 * Desde P16-A1 la API no envia: encola en la misma transaccion que crea al
 * invitado (ADR-025), y el enlace con el token vive en `datos` mientras el
 * correo esta en vuelo. Leerlo de ahi es lo que permite probar la invitacion
 * de punta a punta sin una cuenta de correo ni un despachador levantado —
 * criterio de aceptacion de P0 (CLAUDE.md §12), por otra puerta.
 */
async function tokenDelCorreo(duena: Client, destino: string): Promise<string> {
  const { rows } = await duena.query<{ enlace: string }>(
    `SELECT datos->>'enlace' AS enlace FROM email_outbox
      WHERE destinatario = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [destino],
  );
  const enlace = rows[0]?.enlace;
  if (enlace === undefined) {
    throw new Error(`no se encolo ninguna invitacion a ${destino}`);
  }

  const token = new URL(enlace).searchParams.get('token');
  if (token === null) {
    throw new Error('el enlace de invitacion no lleva token');
  }
  return token;
}
