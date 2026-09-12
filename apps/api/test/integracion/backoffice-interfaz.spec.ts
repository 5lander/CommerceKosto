/**
 * La superficie HTTP de la interfaz del back office — P13.
 *
 * **ES UN ARCHIVO APARTE POR UNA RAZÓN CONCRETA, no por orden.** `backoffice.spec.ts`
 * monta la aplicación CLIENTE para comprobar que no tiene la conexión
 * privilegiada, y **dos aplicaciones HTTP de Nest en el mismo worker de vitest
 * hacen que Node reviente con un fallo nativo, sin mensaje**. Cada archivo corre
 * en su propio worker, así que aquí cabe una y allí la otra.
 *
 * Lo que se comprueba es lo que decide si el panel funciona y si es seguro:
 *
 *   - los tres recursos de la página son **públicos**, porque sin ellos no hay
 *     dónde escribir la contraseña;
 *   - el guion servido es el **compilado**, no un archivo vacío;
 *   - la página **no lleva nada en línea**, que es lo que la CSP exige;
 *   - todo lo que trae datos **sigue exigiendo sesión**;
 *   - `GET /correo/salud` (P16-A1, D-16.27c) devuelve contadores e instantes y
 *     **nada** de la cola: ni `datos`, ni un solo destinatario (D-16.34).
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BackofficeModule } from '../../src/modules/backoffice/backoffice.module';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const SIN_SESION = 401;
const PROHIBIDO = 403;
const SIN_CONTENIDO = 204;

const CONTRASENA = 'siete cebollas moradas';

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

/**
 * Un `dist/ui/` vacío pesa cero bytes.
 *
 * El umbral no mide calidad: mide que **hay algo**. Sin él, la prueba de que el
 * guion se sirve pasaría con un archivo vacío y el back office mostraría una
 * página en blanco — INC-007 otra vez, un verde que no comprueba nada.
 */
const MINIMO_DEL_GUION = 2000;

describe('la interfaz del back office', () => {
  let app: INestApplication;
  let duena: Client;
  let operador: string;

  beforeAll(async () => {
    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();

    app = await NestFactory.create(BackofficeModule, { logger: false, cors: false });
    await app.init();

    operador = `operador-${randomUUID().slice(0, 8)}@ejemplo.invalid`;
    await duena.query(`INSERT INTO backoffice_user (email, password_hash, status) VALUES ($1, $2, 'ACTIVE')`, [
      operador,
      await new Argon2Hasher().hash(CONTRASENA),
    ]);
  }, 60_000);

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  async function entrar(): Promise<string> {
    const respuesta = await request(servidor()).post('/sesion').send({ email: operador, contrasena: CONTRASENA });
    expect(respuesta.status).toBe(OK);
    return cookieConCsrf(respuesta);
  }

  it('los tres recursos son públicos: sin ellos no hay dónde escribir la contraseña', async () => {
    const pagina = await request(servidor()).get('/');
    expect(pagina.status).toBe(OK);
    expect(pagina.headers['content-type']).toMatch(/text\/html/u);

    const estilos = await request(servidor()).get('/ui/estilos.css');
    expect(estilos.status).toBe(OK);
    expect(estilos.headers['content-type']).toMatch(/text\/css/u);

    const guion = await request(servidor()).get('/ui/app.js');
    expect(guion.status).toBe(OK);
    expect(guion.headers['content-type']).toMatch(/javascript/u);
  });

  it('el guion servido es el COMPILADO, no un archivo vacío', async () => {
    const guion = await request(servidor()).get('/ui/app.js');

    expect(guion.text).toContain('X-Motivo');
    expect(guion.text.length).toBeGreaterThan(MINIMO_DEL_GUION);
  });

  it('la página NO lleva script ni estilo en línea: lo impide la CSP', async () => {
    const pagina = await request(servidor()).get('/');

    // Con `script-src 'self'` y sin nonce en la plantilla, un `<script>` con
    // cuerpo sencillamente no se ejecutaría. Que la página no lo tenga es lo que
    // la hace funcionar, no una preferencia de estilo.
    expect(pagina.text).not.toMatch(/<script(?![^>]*\bsrc=)/u);
    expect(pagina.text).not.toMatch(/style=/u);
  });

  it('la página se sirve con las cabeceras de seguridad puestas', async () => {
    const pagina = await request(servidor()).get('/');

    expect(pagina.headers['content-security-policy']).toContain("script-src 'self'");
    expect(pagina.headers['x-frame-options']).toBe('DENY');
    expect(pagina.headers['x-content-type-options']).toBe('nosniff');
  });

  it('todo lo que trae datos sigue exigiendo sesión', async () => {
    for (const ruta of ['/companies', '/accesos', '/planes', '/correo/salud']) {
      const respuesta = await request(servidor()).get(ruta);
      expect(respuesta.status).toBe(SIN_SESION);
    }
  });

  it('GET /correo/salud: contadores e instantes, y en la respuesta CRUDA ni `datos` ni un solo correo', async () => {
    // Que haya algo en la cola, para que «no aparece» no sea «no habia nada».
    await duena.query(
      `INSERT INTO email_outbox (destinatario, plantilla, datos, estado, created_at)
       VALUES ($1, 'INVITACION', '{"enlace":"http://localhost:3001/activacion?token=secreto","caducaEn":"2026-09-17T00:00:00Z"}'::jsonb,
               'PENDIENTE', now() - interval '2 hours')`,
      [`salud-${randomUUID().slice(0, 8)}@snacklab.ec`],
    );
    const cookie = await entrar();

    const respuesta = await request(servidor()).get('/correo/salud').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

    expect(respuesta.status).toBe(OK);
    const salud = respuesta.body as { pendientesAntiguos: unknown; fallidos: unknown; ultimoEnvio: unknown };
    expect(Object.keys(salud).sort()).toEqual(['fallidos', 'pendientesAntiguos', 'ultimoEnvio']);
    expect(typeof salud.pendientesAntiguos).toBe('number');
    expect(typeof salud.fallidos).toBe('number');
    expect(salud.ultimoEnvio === null || typeof salud.ultimoEnvio === 'string').toBe(true);
    expect(salud.pendientesAntiguos).toBeGreaterThan(0);

    const crudo = respuesta.text;
    expect(crudo).not.toContain('datos');
    expect(crudo).not.toContain('@');
    expect(crudo).not.toContain('token');
    expect(crudo).not.toContain('snacklab');
  });

  it('GET /correo/salud no deja fila en backoffice_access_log: no se miro ningún tenant', async () => {
    const cookie = await entrar();
    const antes = await duena.query<{ n: string }>(`SELECT count(*)::text AS n FROM backoffice_access_log`);

    await request(servidor()).get('/correo/salud').set('Cookie', cookie).set('X-CSRF-Token', csrfDe(cookie));

    const despues = await duena.query<{ n: string }>(`SELECT count(*)::text AS n FROM backoffice_access_log`);
    expect(despues.rows[0]?.n).toBe(antes.rows[0]?.n);
  });

  /**
   * EL BACK OFFICE TAMBIÉN LLEVA TOKEN ANTI-CSRF (ADR-021).
   *
   * Hoy sus mutaciones son `fetch` con `Content-Type: application/json` desde
   * su propia página, y eso ya las protege: un sitio cruzado no puede emitir
   * esa petición sin un preflight que `cors: false` rechaza. Pero esa defensa
   * es una propiedad del despliegue de hoy —el día que estas rutas sirvan un
   * `<form method="post">`, que no necesita preflight, desaparece sin que
   * ningún check avise—. El token no depende de eso.
   */
  it('una mutación del back office sin la cabecera es 403 CSRF_INVALIDO', async () => {
    const cookie = await entrar();

    const respuesta = await request(servidor()).post('/salir').set('Cookie', cookie);

    expect(respuesta.status).toBe(PROHIBIDO);
    expect(respuesta.body).toMatchObject({ code: 'CSRF_INVALIDO' });
  });

  it('con su token, la misma mutación pasa; y el token no viaja en la cookie', async () => {
    const login = await request(servidor()).post('/sesion').send({ email: operador, contrasena: CONTRASENA });
    const cookie = cookieConCsrf(login);
    const csrf = (login.body as { readonly csrf: string }).csrf;

    for (const puesta of login.headers['set-cookie'] ?? []) {
      expect(puesta).not.toContain(csrf);
    }

    const respuesta = await request(servidor()).post('/salir').set('Cookie', cookie).set('X-CSRF-Token', csrf);

    expect(respuesta.status).toBe(SIN_CONTENIDO);
  });
});
