/**
 * Logging estructurado en JSON con `correlation_id` — CLAUDE.md §13.
 *
 * LO QUE NUNCA SALE POR AQUI. `redact` elimina las CUATRO cabeceras que llevan
 * un secreto: `authorization`, la cookie de la peticion, el `set-cookie` de la
 * respuesta y —desde P16-A2— `X-CSRF-Token`. No es una precaucion teorica: el
 * log de peticiones es lo primero que se comparte al depurar un incidente, y un
 * token de sesion en un log es un token de sesion regalado (SEGURIDAD.md §9).
 *
 * EL TOKEN ANTI-CSRF ENTRA EN ESA LISTA AUNQUE VIVA EN CLARO EN LA BASE. ADR-021
 * razona esa exposicion para un volcado de `session` —superficie estrecha y con
 * dueno—; un log es lo contrario: viaja al agregador, a un ticket y a un
 * tercero. Y el token no rota dentro de la sesion, asi que una sola linea
 * filtrada vale lo que dure la sesion. Con el token en la mano, la defensa
 * desaparece en los dos escenarios que `iam/.../cookies.ts` cita como su razon
 * de ser: el navegador que ignora `SameSite` y el subdominio del mismo sitio.
 *
 * LA RUTA SE DERIVA DE `CABECERA_DE_CSRF` en vez de escribirse a mano: si
 * alguien renombra la cabecera, la redaccion le sigue. Que un secreto nuevo se
 * quede fuera de esta lista es exactamente el fallo que este bloque existe para
 * no repetir, y `logger.options.spec.ts` clava la lista entera.
 *
 * El `correlation_id` se genera en `genReqId`, que es el primer punto del ciclo
 * de vida de la peticion en el que existe, y se hace tres cosas de una sola
 * vez: entra en el contexto asincrono, sale en la respuesta para que el cliente
 * pueda citarlo en un ticket, y queda en cada linea de log.
 *
 * Se ACEPTA un `x-correlation-id` entrante solo si es un UUID. Es entrada no
 * confiable: sin esa validacion, cualquiera podria inyectar saltos de linea o
 * texto arbitrario en los logs (*log injection*) o reutilizar el identificador
 * de otro para confundir el rastro.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { Params } from 'nestjs-pino';

import type { Configuration } from '../config/environment';
import { CABECERA_DE_CSRF } from '../http/csrf';
import { enterRequestContext } from './request-context';

export const CORRELATION_HEADER = 'x-correlation-id';

/**
 * Toda cabecera portadora de un secreto, y ni una mas. Es publica para que la
 * prueba la pueda clavar entera; ver la cabecera de este archivo.
 *
 * `x-motivo` NO esta, y no es un olvido: es dato de negocio del back office —el
 * porque de un acceso cross-tenant— que SEGURIDAD.md §4.2 manda REGISTRAR, no
 * esconder. Ademas su proceso no monta este logger.
 */
export const CABECERAS_SIN_LOG: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  `req.headers["${CABECERA_DE_CSRF}"]`,
  'res.headers["set-cookie"]',
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function correlationIdDe(request: IncomingMessage): string {
  const recibido = request.headers[CORRELATION_HEADER];
  return typeof recibido === 'string' && UUID.test(recibido) ? recibido : randomUUID();
}

export function loggerOptions(config: Configuration): Params {
  return {
    pinoHttp: {
      level: config.logLevel,
      genReqId: (request: IncomingMessage, response: ServerResponse): string => {
        const correlationId = correlationIdDe(request);
        enterRequestContext({ correlationId });
        response.setHeader(CORRELATION_HEADER, correlationId);
        return correlationId;
      },
      // `req.id` es lo que devolvio `genReqId`. Se emite ademas con nombre
      // plano `correlation_id` porque asi lo nombra SEGURIDAD.md §10 y asi se
      // busca en el agregador: `req.id` obliga a conocer la forma del objeto.
      customProps: (request: IncomingMessage) => ({ correlation_id: request.id }),
      redact: { paths: [...CABECERAS_SIN_LOG], remove: true },
      // En desarrollo el JSON de una linea es ilegible; en produccion es lo
      // unico que un agregador sabe leer. No se anade `pino-pretty`: seria una
      // dependencia mas para una comodidad local (OPTIMIZACION.md §1).
      autoLogging: { ignore: (request: IncomingMessage) => request.url === '/health' },
    },
  };
}
