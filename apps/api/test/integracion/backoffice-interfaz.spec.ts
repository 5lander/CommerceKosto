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
 *   - todo lo que trae datos **sigue exigiendo sesión**.
 */

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BackofficeModule } from '../../src/modules/backoffice/backoffice.module';

const OK = 200;
const SIN_SESION = 401;

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

  beforeAll(async () => {
    app = await NestFactory.create(BackofficeModule, { logger: false, cors: false });
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  function servidor(): Server {
    return app.getHttpServer() as Server;
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
    for (const ruta of ['/companies', '/accesos', '/planes']) {
      const respuesta = await request(servidor()).get(ruta);
      expect(respuesta.status).toBe(SIN_SESION);
    }
  });
});
