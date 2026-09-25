/**
 * Los tipos de `lector.mjs`, escritos a mano.
 *
 * EXISTEN PARA QUE «EN JAVASCRIPT» NO SIGNIFIQUE «SIN TIPOS». El lector está en
 * JavaScript plano por una razón de ejecución —tiene que arrancar en un proceso
 * aparte desde el fuente y desde `dist/`, ver `lector.mjs`— y no porque sus
 * tipos den igual. Quien lo usa desde TypeScript los tiene todos, y `tsc`
 * comprueba las llamadas igual que las de cualquier otro módulo.
 *
 * **Todo sale como `string`.** No es una simplificación de la declaración: es
 * lo que el lector hace, y la razón está en CLAUDE.md §3 — un decimal que
 * pasara por `number` entraría al dominio ya corrompido.
 */

export interface LimitesDelZip {
  /** Tope de bytes descomprimidos. Es lo que corta una zip bomb. */
  readonly bytesDescomprimidos: number;
  /** Tope de entradas. Un ZIP con cien mil ficheros también es un ataque. */
  readonly entradas: number;
}

export type FormatoDeArchivo = 'XLSX' | 'DELIMITADO';

export interface HojaLeida {
  readonly formato: FormatoDeArchivo;
  readonly filas: readonly (readonly string[])[];
}

export interface Delimitado {
  readonly filas: readonly (readonly string[])[];
  readonly delimitador: string;
}

/** Un error cuyo mensaje se puede enseñar al usuario tal cual. */
export declare class ErrorDeLectura extends Error {
  readonly publico: true;
  constructor(mensaje: string);
}

/** @throws {ErrorDeLectura} */
export declare function leerHoja(bytes: Uint8Array, limites: LimitesDelZip): HojaLeida;

/** @throws {ErrorDeLectura} */
export declare function formatoDe(bytes: Uint8Array): FormatoDeArchivo;

/** @throws {ErrorDeLectura} */
export declare function leerXlsx(
  bytes: Uint8Array,
  limites: LimitesDelZip,
): readonly (readonly string[])[];

export declare function leerDelimitado(bytes: Uint8Array): Delimitado;

/** @throws {ErrorDeLectura} */
export declare function leerEntradas(
  bytes: Uint8Array,
  queridas: readonly string[],
  limites: LimitesDelZip,
): ReadonlyMap<string, Uint8Array>;
