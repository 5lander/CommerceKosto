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
 * Y EL 4xx TAMBIEN DEJA RASTRO, desde la revision de P16-A2: su `code` y su
 * `detalle` salen al log en nivel `debug`. Antes no salia nada —el filtro solo
 * escribia la traza de los 5xx—, asi que el dia que tres errores de borde
 * pasaron de 500 a 400 su contexto interno (`Money.fromDecimalString`, el tipo
 * del identificador) dejo de verse en ninguna parte: el cambio no reubicaba el
 * diagnostico, lo borraba. `debug` y no `warn` porque un 4xx es lo normal en
 * una API publica y no es un incidente; se enciende cuando se esta depurando.
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
import { valorParaMensaje } from '../../domain/errors/valor-en-mensaje';

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
 * atacante no anade nada que no supiera ya. `LIMITE_DE_SOLICITUDES` es el
 * tercer 429 (D-16.24) y se distingue por el `code`: el cliente tiene que
 * saber si es su cuenta, el limitador global o una peticion repetida de mas.
 *
 * `CSRF_INVALIDO` es el SEGUNDO 403 (P16-A2, ADR-021), y comparte estado con
 * `PERMISO_DENEGADO` a proposito: los dos son "estas autenticado y aun asi no".
 * Se distinguen por el `code`, porque la reaccion del cliente es opuesta —uno
 * se arregla recargando la pagina, el otro pidiendole permisos a un
 * administrador— y un 403 indistinguible manda al usuario al sitio equivocado.
 *
 * `PERIODO_SIN_DATOS` es el SEGUNDO 404 (P16-A2, D-16.2), y la misma logica:
 * "ese mes no se ha abierto" no es "ese recurso no existe". El cliente reacciona
 * distinto —lo primero se arregla cargando las ventas del mes, lo segundo es un
 * enlace roto— y con un solo `code` la pantalla tendria que adivinar cual de las
 * dos cosas le pasa. **El contrato es el `code`, no el estado**: los dos son 404.
 */
const ESTADO_POR_CODIGO: Readonly<Record<CodigoDeDominio, number>> = {
  CREDENCIALES_INVALIDAS: HttpStatus.UNAUTHORIZED,
  ACCESO_BLOQUEADO: HttpStatus.TOO_MANY_REQUESTS,
  SESION_INVALIDA: HttpStatus.UNAUTHORIZED,
  PERMISO_DENEGADO: HttpStatus.FORBIDDEN,
  CSRF_INVALIDO: HttpStatus.FORBIDDEN,
  RECURSO_NO_ENCONTRADO: HttpStatus.NOT_FOUND,
  PERIODO_SIN_DATOS: HttpStatus.NOT_FOUND,
  LIMITE_DEL_PLAN: HttpStatus.CONFLICT,
  CONFLICTO: HttpStatus.CONFLICT,
  CONFLICTO_DE_VERSION: HttpStatus.CONFLICT,
  ENTRADA_INVALIDA: HttpStatus.BAD_REQUEST,
  LIMITE_DE_SOLICITUDES: HttpStatus.TOO_MANY_REQUESTS,
};

/**
 * Se exporta para que `bootstrap.ts` la ponga en `exposedHeaders` de CORS: una
 * cabecera que el navegador no puede leer es una cabecera que no existe.
 */
export const CABECERA_DE_REINTENTO = 'Retry-After';

/**
 * Un error de dominio que sabe cuando reintentar. El filtro no conoce la
 * clase: mira la forma, para que cualquier error futuro con espera —un
 * bloqueo de cuenta, un cierre de periodo en curso— gane la cabecera sin
 * tocar este archivo.
 */
function segundosDeReintento(exception: ErrorDeDominio): number | null {
  if (!('reintentarEnSegundos' in exception)) {
    return null;
  }
  const segundos: unknown = exception.reintentarEnSegundos;
  return typeof segundos === 'number' && Number.isInteger(segundos) && segundos > 0 ? segundos : null;
}

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
  /** `Retry-After` cuando el error trae espera; vacio en el resto. */
  readonly cabeceras: Readonly<Record<string, string>>;
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
    const reintento = segundosDeReintento(exception);
    return {
      status: ESTADO_POR_CODIGO[exception.codigo],
      body: { code: exception.codigo, message: exception.message },
      cabeceras: reintento === null ? {} : { [CABECERA_DE_REINTENTO]: String(reintento) },
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
    cabeceras: {},
  };
}

/**
 * LA LINEA DE LOG DE UN ERROR DE DOMINIO, que es donde vive lo que el cliente
 * NO puede ver.
 *
 * `mensaje` sale al cliente y por eso no puede llevar nada de dentro;
 * `detalle` es lo contrario —el metodo que lanzo, el motivo exacto, el permiso
 * que faltaba— y hasta esta revision no lo leia nadie: la cabecera de
 * `error-de-dominio.ts` prometia un log que no existia.
 *
 * Los valores pasan por `valorParaMensaje` porque varios vienen de quien llamo
 * (`plan`, `estado`, `concepto`): sin limpiarlos, un salto de linea dentro de
 * uno parte la linea del log en dos y la segunda la escribe el atacante — la
 * inyeccion de log de SEGURIDAD.md §9.
 *
 * Es una funcion pura y se prueba como tal: probarla a traves del filtro
 * obligaria a fabricar un doble de `ArgumentsHost` con `as unknown as`, que
 * `audit:forbidden` prohibe.
 */
export function diagnosticoDe(exception: ErrorDeDominio): string {
  const detalle = Object.entries(exception.detalle)
    .map(([clave, valor]) => `${clave}=${valorParaMensaje(String(valor))}`)
    .join(' ');
  return detalle === '' ? exception.codigo : `${exception.codigo} ${detalle}`;
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  public catch(exception: unknown, host: ArgumentsHost): void {
    const { status, body, cabeceras } = errorResponseFor(exception);

    if (status >= PRIMER_CODIGO_DE_SERVIDOR) {
      // El log lleva la excepcion entera; la respuesta, nada de ella.
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    } else if (exception instanceof ErrorDeDominio) {
      // Un 4xx no es un incidente, pero su `detalle` es el unico sitio donde
      // queda el porque interno: al log en `debug`, nunca a la respuesta.
      this.logger.debug(diagnosticoDe(exception));
    }

    const response = host.switchToHttp().getResponse<ServerResponse>();
    response.statusCode = status;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    for (const [nombre, valor] of Object.entries(cabeceras)) {
      response.setHeader(nombre, valor);
    }
    response.end(JSON.stringify(body));
  }
}
