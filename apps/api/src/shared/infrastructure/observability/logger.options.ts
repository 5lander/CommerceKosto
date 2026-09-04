/**
 * Logging estructurado en JSON con `correlation_id` — CLAUDE.md §13.
 *
 * LO QUE NUNCA SALE POR AQUI. `redact` elimina la cabecera `authorization`, las
 * cookies y el `set-cookie` de la respuesta. No es una precaucion teorica: el
 * log de peticiones es lo primero que se comparte al depurar un incidente, y un
 * token de sesion en un log es un token de sesion regalado (SEGURIDAD.md §9).
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
import { enterRequestContext } from './request-context';

export const CORRELATION_HEADER = 'x-correlation-id';

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
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
        remove: true,
      },
      // En desarrollo el JSON de una linea es ilegible; en produccion es lo
      // unico que un agregador sabe leer. No se anade `pino-pretty`: seria una
      // dependencia mas para una comodidad local (OPTIMIZACION.md §1).
      autoLogging: { ignore: (request: IncomingMessage) => request.url === '/health' },
    },
  };
}
