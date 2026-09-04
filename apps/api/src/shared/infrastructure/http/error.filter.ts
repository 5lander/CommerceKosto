/**
 * Formato UNICO de error de toda la API: `{ code, message }` (CLAUDE.md §8).
 *
 * "El mensaje al usuario y el detalle del log son cosas distintas"
 * (CLAUDE.md §3). Aqui esa frase se hace codigo:
 *
 *   4xx  el mensaje sale tal cual — es informacion que el llamante necesita
 *        para corregir SU peticion, y no revela nada del interior.
 *
 *   5xx  el mensaje NO sale. Un fallo inesperado lleva dentro rutas de
 *        archivo, nombres de tabla, fragmentos de SQL y a veces valores; todo
 *        eso es reconocimiento gratis para quien esta sondeando. Sale un texto
 *        fijo, y el detalle completo va al log con su `correlation_id`.
 *
 * El `correlation_id` no viaja en el cuerpo: ya va en la cabecera
 * `x-correlation-id` de toda respuesta. Un usuario que abre un ticket lo cita,
 * y con el se llega al log exacto sin haber filtrado nada por el camino.
 *
 * SE ESCRIBE SOBRE `ServerResponse` Y NO SOBRE EL `Response` DE EXPRESS: los
 * tipos de express declaran `res.locals` como `Record<string, any>` y traerlos
 * mete `any` en el codigo. Ademas deja el filtro atado solo al HTTP de Node.
 */

import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import {
  ErrorDeDominio,
  type CodigoDeDominio,
} from '../../domain/errors/error-de-dominio';

const MENSAJE_GENERICO = 'Error interno. Cita el identificador de la cabecera x-correlation-id si necesitas soporte.';
const CODIGO_GENERICO = 'INTERNAL_ERROR';
const PRIMER_CODIGO_DE_SERVIDOR = 500;

/**
 * Catalogo explicito de codigos, y no la busqueda inversa del enum `HttpStatus`.
 *
 * El codigo forma parte del CONTRATO de la API: un cliente lo compara. Sacarlo
 * de una propiedad interna del enum lo ataria a como NestJS decida nombrar sus
 * miembros, y un renombrado suyo en un minor romperia clientes sin que nada en
 * este repositorio cambiara. Lo que no esta en la lista sale como
 * `INTERNAL_ERROR`, que es el unico codigo que un cliente no debe interpretar.
 */
const CODIGOS: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.REQUEST_TIMEOUT]: 'REQUEST_TIMEOUT',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'UNSUPPORTED_MEDIA_TYPE',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
  [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
};

function codigoDe(status: number): string {
  return CODIGOS[status] ?? CODIGO_GENERICO;
}

/**
 * La traduccion de una regla de negocio rota a una respuesta HTTP.
 *
 * ES UN `Record` EXHAUSTIVO SOBRE LA UNION, Y ESA ES LA GRACIA. Un codigo de
 * dominio nuevo sin fila aqui NO COMPILA. Con un `default` de respaldo, el
 * olvido se convertiria en un 500 en produccion —un fallo de negocio disfrazado
 * de fallo del servidor— y nadie lo veria hasta que un cliente lo reportara.
 *
 * `ACCESO_BLOQUEADO` sale como 429 y no como 401 a proposito: es informacion
 * util y honesta para un cliente legitimo —"espera y reintenta"—, y para el
 * atacante no anade nada que no supiera ya.
 */
const ESTADO_POR_CODIGO: Readonly<Record<CodigoDeDominio, number>> = {
  CREDENCIALES_INVALIDAS: HttpStatus.UNAUTHORIZED,
  ACCESO_BLOQUEADO: HttpStatus.TOO_MANY_REQUESTS,
  SESION_INVALIDA: HttpStatus.UNAUTHORIZED,
  PERMISO_DENEGADO: HttpStatus.FORBIDDEN,
  RECURSO_NO_ENCONTRADO: HttpStatus.NOT_FOUND,
  LIMITE_DEL_PLAN: HttpStatus.CONFLICT,
  ENTRADA_INVALIDA: HttpStatus.BAD_REQUEST,
};

/** Extrae el texto de una `HttpException` sin tocar `any`. */
function mensajeDe(exception: HttpException): string {
  const cuerpo: unknown = exception.getResponse();

  if (typeof cuerpo === 'string') {
    return cuerpo;
  }

  if (typeof cuerpo === 'object' && cuerpo !== null && 'message' in cuerpo) {
    const mensaje: unknown = cuerpo.message;
    if (typeof mensaje === 'string') {
      return mensaje;
    }
    if (Array.isArray(mensaje)) {
      return mensaje.filter((parte): parte is string => typeof parte === 'string').join('; ');
    }
  }

  return exception.message;
}

export interface ErrorResponse {
  readonly status: number;
  readonly body: { readonly code: string; readonly message: string };
}

/**
 * LA DECISION ES UNA FUNCION PURA, y el filtro es solo el cable que la conecta
 * a Nest.
 *
 * No es simetria por gusto: probar esto a traves del filtro obligaria a
 * fabricar dobles de `ArgumentsHost` y `ServerResponse`, y la unica forma de
 * fabricarlos es `as unknown as`, que `audit:forbidden` prohibe en todo el
 * repositorio por ser la llave que abre cualquier defensa de tipos. Separada,
 * la parte que decide —que es la que tiene la regla de seguridad dentro— se
 * prueba con valores de verdad y sin un solo doble.
 */
export function errorResponseFor(exception: unknown): ErrorResponse {
  // Un error de dominio es una regla de negocio rota, no un fallo: su codigo y
  // su mensaje son parte del contrato de la API y salen tal cual.
  if (exception instanceof ErrorDeDominio) {
    return {
      status: ESTADO_POR_CODIGO[exception.codigo],
      body: { code: exception.codigo, message: exception.message },
    };
  }

  const status =
    exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

  const esDeServidor = status >= PRIMER_CODIGO_DE_SERVIDOR;

  return {
    status,
    body: {
      code: esDeServidor ? CODIGO_GENERICO : codigoDe(status),
      message:
        esDeServidor || !(exception instanceof HttpException) ? MENSAJE_GENERICO : mensajeDe(exception),
    },
  };
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body } = errorResponseFor(exception);

    if (status >= PRIMER_CODIGO_DE_SERVIDOR) {
      // El log lleva la excepcion entera; la respuesta, nada de ella.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    const response = host.switchToHttp().getResponse<ServerResponse>();
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(JSON.stringify(body));
  }
}
