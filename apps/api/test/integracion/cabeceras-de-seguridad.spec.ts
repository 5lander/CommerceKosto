/**
 * `security/sec-headers.test` de SEGURIDAD.md §11 — las cabeceras de §4.4 estan
 * presentes en TODA respuesta.
 *
 * Se ejecuta tambien de forma aislada como `npm run audit:sec-headers`, por eso
 * el bloque raiz se llama exactamente "cabeceras de seguridad": ese es el
 * patron con el que el script lo selecciona.
 *
 * LA PRUEBA QUE JUSTIFICA QUE SEAN MIDDLEWARE Y NO INTERCEPTOR es la del 404.
 * Un interceptor de Nest solo corre para peticiones que llegan a un manejador;
 * un 404, un 429 del limitador o un cuerpo malformado saldrian sin cabeceras, y
 * son justo las respuestas de las que un atacante aprende mas.
 */

import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';

/**
 * `cache-control` se comprueba por CONTENIDO y no por igualdad: terminus
 * responde `no-cache, no-store, must-revalidate` en las rutas de salud, que es
 * mas estricto que lo que exige §4.4. Exigir igualdad exacta obligaria a
 * relajar la cabecera para que la prueba pasara, que es justo al reves.
 */
const OBLIGATORIAS: readonly (readonly [string, string, 'exacto' | 'contiene'])[] = [
  ['strict-transport-security', 'max-age=63072000; includeSubDomains; preload', 'exacto'],
  ['x-frame-options', 'DENY', 'exacto'],
  ['x-content-type-options', 'nosniff', 'exacto'],
  ['referrer-policy', 'strict-origin-when-cross-origin', 'exacto'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=()', 'exacto'],
  ['cache-control', 'no-store', 'contiene'],
];

function comprobar(recibido: string | undefined, esperado: string, modo: 'exacto' | 'contiene'): void {
  if (modo === 'exacto') {
    expect(recibido).toBe(esperado);
    return;
  }
  expect(recibido ?? '').toContain(esperado);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const NO_ENCONTRADO = 404;

describe('cabeceras de seguridad', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApplication(loadConfiguration(process.env));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

/**
 * `INestApplication.getHttpServer()` esta declarado como `any` en NestJS. Se
 * fija aqui, en un unico sitio y con el tipo real, en vez de dejar que ese
 * `any` se propague por cada llamada a supertest — que es justo lo que
 * `no-unsafe-argument` detecta y lo que CLAUDE.md §3 prohibe.
 */
  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  describe('en una respuesta que SI llega a un manejador', () => {
    it.each(OBLIGATORIAS)('%s = %s', async (cabecera, valor, modo) => {
      const respuesta = await request(servidor()).get('/health');
      comprobar(respuesta.headers[cabecera], valor, modo);
    });
  });

  describe('en una respuesta que NO llega a ningun manejador', () => {
    it.each(OBLIGATORIAS)('un 404 tambien lleva %s', async (cabecera, valor, modo) => {
      const respuesta = await request(servidor()).get('/ruta-que-no-existe');

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      comprobar(respuesta.headers[cabecera], valor, modo);
    });
  });

  describe('Content-Security-Policy', () => {
    it('es estricta: sin unsafe-inline y sin unsafe-eval', async () => {
      const csp = (await request(servidor()).get('/health')).headers['content-security-policy'] ?? '';

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).not.toContain('unsafe-inline');
      expect(csp).not.toContain('unsafe-eval');
    });

    it('lleva nonce, y el nonce es DISTINTO en cada respuesta', async () => {
      // Una CSP con nonce fijo no vale mas que una sin nonce: el atacante que
      // logra inyectar un `<script>` solo necesita conocer un valor constante.
      const nonce = async (): Promise<string> => {
        const csp = (await request(servidor()).get('/health')).headers['content-security-policy'] ?? '';
        return /'nonce-([^']+)'/u.exec(csp)?.[1] ?? '';
      };

      const primero = await nonce();
      const segundo = await nonce();

      expect(primero).not.toBe('');
      expect(primero).not.toBe(segundo);
    });
  });

  describe('lo que NO debe salir', () => {
    it('no revela el framework en x-powered-by', async () => {
      const respuesta = await request(servidor()).get('/health');
      expect(respuesta.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('correlacion', () => {
    it('toda respuesta lleva un x-correlation-id', async () => {
      const respuesta = await request(servidor()).get('/health');
      expect(respuesta.headers['x-correlation-id']).toMatch(UUID);
    });

    it('respeta el que envia el cliente si es un UUID', async () => {
      const propio = '0198f3a1-1c2d-7e4f-8a9b-0c1d2e3f4a5b';

      const respuesta = await request(servidor()).get('/health').set('x-correlation-id', propio);

      expect(respuesta.headers['x-correlation-id']).toBe(propio);
    });

    it('IGNORA uno que no sea UUID y genera el suyo', async () => {
      // Entrada no confiable: sin la validacion, el identificador que va a TODA
      // linea de log lo elige quien llama.
      //
      // El caso con salto de linea —la inyeccion de log clasica— no se puede
      // ejercitar desde aqui: Node se niega a EMITIR una cabecera que lo
      // contenga, y el fallo ocurre en el cliente antes de salir. Esa via la
      // cierra el propio runtime en los dos sentidos; lo que cubre esta prueba
      // es lo que si llega: un valor con formato arbitrario.
      const inyeccion = 'no-es-un-uuid-cualquier-cosa';

      const respuesta = await request(servidor()).get('/health').set('x-correlation-id', inyeccion);

      expect(respuesta.headers['x-correlation-id']).toMatch(UUID);
    });
  });
});
