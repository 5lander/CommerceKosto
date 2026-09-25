/**
 * Las tres piezas del token anti-CSRF que comparten los dos procesos — ADR-021.
 *
 * AQUI NO HAY GUARD NI NESTJS: hay tres funciones puras sobre una peticion de
 * `node:http`. Los guards —uno en `iam`, otro en `backoffice`— las llaman. Esa
 * separacion es lo que permite que la comparacion en tiempo constante exista
 * UNA sola vez: dos copias de un `timingSafeEqual` son dos sitios donde
 * alguien puede "simplificar" a `===` sin que nadie lo note.
 *
 * POR QUE SE COMPARAN LOS HASHES Y NO LOS TOKENS.
 *
 * `timingSafeEqual` exige buffers de la MISMA longitud: con longitudes
 * distintas lanza `RangeError`. Comparar los tokens crudos obligaria entonces a
 * mirar la longitud primero, y esa comprobacion —que sale antes y es
 * instantanea— es en si misma un oraculo: revela el tamano del token bueno.
 * Hashear los dos lados con SHA-256 da SIEMPRE 32 bytes, asi que la longitud
 * deja de decir nada y la comparacion completa corre en tiempo constante.
 *
 * No se usa el hash para guardar nada: el token vive en claro en la fila de la
 * sesion (ADR-021). SHA-256 aqui es solo un igualador de longitud.
 *
 * LOS METODOS SEGUROS NO SE COMPRUEBAN, y es la definicion del ataque, no una
 * concesion: un CSRF sirve para PROVOCAR un efecto en el servidor, y quien lo
 * monta no puede leer la respuesta —eso lo impide el mismo origen—. Exigir el
 * token en un `GET` no cerraria nada y romperia toda navegacion normal.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** En minusculas: `node:http` normaliza los nombres de cabecera al recibirlas. */
export const CABECERA_DE_CSRF = 'x-csrf-token';

/** Lo que NO muta. Todo lo demas —POST, PUT, PATCH, DELETE— exige token. */
const METODOS_SEGUROS: readonly string[] = ['GET', 'HEAD', 'OPTIONS'];

/**
 * Sin metodo se responde `true`, y no es un caso teorico que se resuelve por
 * gusto: `IncomingMessage.method` es opcional en los tipos, y la unica lectura
 * defendible de «no se que es esto» es exigir el token.
 */
export function esMutacion(metodo: string | undefined): boolean {
  return metodo === undefined || !METODOS_SEGUROS.includes(metodo.toUpperCase());
}

/**
 * @returns el valor de `X-CSRF-Token`, o `null` si no viene.
 *
 * Una cabecera repetida llega como array. Se descarta entera en vez de tomar
 * la primera: dos valores distintos son una peticion que alguien esta
 * intentando colar por dos caminos a la vez.
 */
export function tokenDeLaCabecera(peticion: IncomingMessage): string | null {
  const bruto = peticion.headers[CABECERA_DE_CSRF];
  return typeof bruto === 'string' && bruto !== '' ? bruto : null;
}

/** Comparacion en tiempo constante. Ver la cabecera para el porque del hash. */
export function esElMismoToken(esperado: string, recibido: string): boolean {
  return timingSafeEqual(huella(esperado), huella(recibido));
}

function huella(valor: string): Buffer {
  return createHash('sha256').update(valor, 'utf8').digest();
}
