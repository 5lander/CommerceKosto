/**
 * CORS: qué origen puede llamar a esta API desde un navegador, con qué métodos
 * y con qué cabeceras.
 *
 * **POR QUÉ ESTA SUITE NO EXISTÍA Y HACÍA FALTA.** `supertest` no hace
 * preflight: manda el `DELETE` directamente, sin el `OPTIONS` previo. Así que
 * `DELETE /usuarios/roles` —que existe desde P1— pasaba todas las pruebas de
 * integración y era **inalcanzable desde el navegador**, porque `methods` no lo
 * listaba y el preflight lo rechazaba. Ningún check lo veía. La única forma de
 * verlo es emitir el `OPTIONS` a mano, que es lo que se hace aquí.
 *
 * **LA APP SE LEVANTA CON ORÍGENES A PROPÓSITO.** En producción `CORS_ORIGENES`
 * está **vacío** —hay un solo origen, el frontend lo sirve el mismo Caddy— y
 * con la lista vacía `createApplication` deja `cors: false`: no hay política que
 * probar. Lo que se prueba aquí es la política que se aplica cuando SÍ hay
 * orígenes declarados, que es lo que ocurre en desarrollo y lo que ocurriría el
 * día que el frontend viva en otro dominio.
 *
 * Una sola app de Nest, como en todas las suites, y sin sembrar nada: el
 * preflight lo contesta el middleware antes de llegar a ninguna ruta, y el
 * navegador lo manda **sin credenciales** por definición.
 */

import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { CABECERA_DE_CSRF } from '../../src/shared/infrastructure/http/csrf';

const SIN_CONTENIDO = 204;

/** Exactamente lo que `bootstrap.ts` declara en `allowedHeaders`, en su orden. */
const CABECERAS_DECLARADAS = `Content-Type,${CABECERA_DE_CSRF}`;

const PERMITIDO = 'https://panel.ejemplo.test';
const AJENO = 'https://sitio-de-otro.test';

describe('CORS', () => {
  let app: INestApplication;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function preflight(origen: string, metodo: string, cabeceras: string) {
    return request(servidor())
      .options('/usuarios/roles')
      .set('Origin', origen)
      .set('Access-Control-Request-Method', metodo)
      .set('Access-Control-Request-Headers', cabeceras);
  }

  beforeAll(async () => {
    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      corsOrigenes: [PERMITIDO],
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('un origen de la lista blanca', () => {
    /**
     * Lo que esta prueba mide de verdad es el `DELETE` en `Allow-Methods`. La
     * cabecera pedida vuelve **tambien sin `allowedHeaders`**, por reflejo; lo
     * que separa las dos configuraciones esta tres pruebas mas abajo, en «no
     * refleja una cabecera que nadie declaro».
     */
    it('recibe el preflight de un DELETE con X-CSRF-Token', async () => {
      const respuesta = await preflight(PERMITIDO, 'DELETE', 'x-csrf-token,content-type');

      expect(respuesta.status).toBe(SIN_CONTENIDO);
      expect(respuesta.headers['access-control-allow-origin']).toBe(PERMITIDO);
      expect(respuesta.headers['access-control-allow-methods']).toContain('DELETE');
      expect(respuesta.headers['access-control-allow-headers']?.toLowerCase()).toContain(
        'x-csrf-token',
      );
    });

    /**
     * `Content-Type` es el que rompe todo si se olvida: sin él, ningún `POST`
     * con cuerpo JSON pasa el preflight — y desde D-16.74 la API **solo**
     * entiende JSON, así que no habría forma de escribir nada.
     */
    it('y Content-Type sigue permitido, que es lo que sostiene todo POST', async () => {
      const respuesta = await preflight(PERMITIDO, 'POST', 'content-type');

      expect(respuesta.headers['access-control-allow-headers']?.toLowerCase()).toContain(
        'content-type',
      );
    });

    /**
     * **LA UNICA PRUEBA DE ESTA SUITE QUE DISTINGUE UNA LISTA DECLARADA DE UN
     * REFLEJO, y por eso pide una cabecera que nadie declaro.**
     *
     * Las dos de arriba piden `x-csrf-token` y `content-type` y comprueban que
     * vuelven. Eso NO mide `allowedHeaders`: sin esa linea, el paquete `cors`
     * devuelve tal cual lo que el navegador puso en
     * `Access-Control-Request-Headers`, asi que salen verdes con la lista
     * cerrada y con la lista abierta —que era la configuracion anterior, donde
     * la lista blanca de cabeceras era en la practica `*`—. Verificado contra el
     * propio paquete: con la config vieja, pedir `x-inventado` devuelve
     * `x-inventado`; con la nueva, devuelve la politica.
     *
     * De ahi el `toBe` y no un `toContain`: lo que se afirma es que la lista es
     * **exacta**. Si alguien la «simplifica» a un `toContain`, esta suite vuelve
     * a estar verde sin medir nada (INC-007).
     */
    it('no refleja una cabecera que nadie declaro: la lista es exacta', async () => {
      const respuesta = await preflight(PERMITIDO, 'POST', 'x-inventado');

      expect(respuesta.status).toBe(SIN_CONTENIDO);
      expect(respuesta.headers['access-control-allow-headers']).toBe(CABECERAS_DECLARADAS);
      expect(respuesta.headers['access-control-allow-headers']).not.toContain('x-inventado');
    });

    it('permite mandar la cookie de sesion, y por eso el origen no puede ser *', async () => {
      const respuesta = await preflight(PERMITIDO, 'PUT', 'content-type');

      expect(respuesta.headers['access-control-allow-credentials']).toBe('true');
      expect(respuesta.headers['access-control-allow-origin']).not.toBe('*');
    });

    it('cachea el preflight, para que una mutacion no sean siempre dos viajes', async () => {
      const respuesta = await preflight(PERMITIDO, 'POST', 'content-type');

      expect(Number(respuesta.headers['access-control-max-age'])).toBeGreaterThan(0);
    });

    /**
     * Lo que el JavaScript de la página puede LEER de la respuesta. El mensaje
     * de los 5xx le pide al usuario que cite `x-correlation-id`; sin esta
     * cabecera declarada, el navegador no se lo deja ver.
     */
    it('expone x-correlation-id y Retry-After', async () => {
      const respuesta = await request(servidor()).get('/health').set('Origin', PERMITIDO);

      const expuestas = (respuesta.headers['access-control-expose-headers'] ?? '').toLowerCase();
      expect(expuestas).toContain('x-correlation-id');
      expect(expuestas).toContain('retry-after');
    });
  });

  describe('un origen que no esta en la lista', () => {
    /**
     * **LA CABECERA QUE DECIDE ES `Access-Control-Allow-Origin`, Y SOLO ESA.**
     * El paquete `cors` emite `Allow-Credentials`, `Allow-Methods` y
     * `Allow-Headers` sin mirar el origen —describen la política, no al
     * llamante—, así que buscar su ausencia mediría una casualidad de la
     * librería. Lo que corta la respuesta en el navegador es que no aparezca
     * el eco del origen: sin `Allow-Origin` no hay permiso, lleve lo que lleve
     * el resto. Se comprueba además que no salga un `*`, que con credenciales
     * sería la combinación que el propio navegador rechaza.
     */
    it('no recibe el eco de su origen, que es lo que el navegador exige', async () => {
      const respuesta = await preflight(AJENO, 'DELETE', 'x-csrf-token');

      expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('tampoco en una peticion normal', async () => {
      const respuesta = await request(servidor()).get('/health').set('Origin', AJENO);

      expect(respuesta.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});
