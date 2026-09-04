/**
 * Cabeceras de seguridad — SEGURIDAD.md §4.4, verificadas por
 * `audit:sec-headers`.
 *
 * SE APLICAN COMO MIDDLEWARE DE LA PLATAFORMA, NO COMO INTERCEPTOR DE NEST.
 * Un interceptor solo corre para peticiones que llegan a un manejador: un 404,
 * un 429 del limitador o un error de parseo del cuerpo saldrian SIN cabeceras,
 * y son exactamente las respuestas de las que un atacante aprende mas.
 *
 * EL NONCE. La CSP se escribe con nonce y no con `unsafe-inline` (§4.1). En P0
 * la API solo devuelve JSON y nadie consume el nonce todavia; lo que ya es real
 * es que sea IRREPETIBLE por respuesta, porque una CSP con nonce fijo no vale
 * mas que ninguna. La prueba de integracion comprueba justamente eso: dos
 * peticiones, dos nonces distintos.
 *
 * Se guarda en un `WeakMap` y no en `res.locals` porque `locals` esta tipado
 * como `Record<string, any>` y leerlo introduciria `any` en el codigo, que
 * CLAUDE.md §3 prohibe. El `WeakMap` no retiene la respuesta viva.
 */

import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import helmet from 'helmet';

const BYTES_DE_NONCE = 16;
const HSTS_DOS_ANOS_EN_SEGUNDOS = 63_072_000;

const nonces = new WeakMap<ServerResponse, string>();

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;

function nonceDe(response: ServerResponse): string {
  return nonces.get(response) ?? '';
}

const asignarNonce: Middleware = (_request, response, next) => {
  nonces.set(response, randomBytes(BYTES_DE_NONCE).toString('base64'));
  next();
};

/**
 * Las dos que helmet no pone.
 *
 * `Cache-Control: no-store` va en TODA respuesta y no solo en las que llevan
 * datos personales: en esta API no hay ninguna que no los lleve, y decidir caso
 * por caso es como se acaba cacheando la equivocada en un proxy compartido.
 */
const cabecerasQueHelmetNoPone: Middleware = (_request, response, next) => {
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Cache-Control', 'no-store');
  next();
};

export function securityHeaders(): Middleware[] {
  return [
    asignarNonce,
    cabecerasQueHelmetNoPone,
    helmet({
      contentSecurityPolicy: {
        // `useDefaults: false`: la politica se escribe entera y a la vista. Con
        // los defaults, anadir una directiva hereda en silencio el resto, y
        // nadie sabe decir que permite la politica sin leer helmet.
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", (_request, response) => `'nonce-${nonceDe(response)}'`],
          'style-src': ["'self'", (_request, response) => `'nonce-${nonceDe(response)}'`],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'"],
          'connect-src': ["'self'"],
          // Sin plugins, sin `<base>` inyectable, sin envio de formularios a
          // terceros y sin poder ser embebido: los cuatro cierres clasicos.
          'object-src': ["'none'"],
          'base-uri': ["'none'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'upgrade-insecure-requests': [],
        },
      },
      hsts: { maxAge: HSTS_DOS_ANOS_EN_SEGUNDOS, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      noSniff: true,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginEmbedderPolicy: false,
    }),
  ];
}
