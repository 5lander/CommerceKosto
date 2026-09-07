/**
 * Los topes de la importación — SEGURIDAD.md §5.1 y §5.4.
 *
 * ESTAN AQUI Y NO REPARTIDOS porque son la superficie de ataque entera medida
 * en números, y hay que poder leerla de una vez. Un tope que vive junto al
 * código que lo aplica se afloja sin que nadie se entere.
 *
 * SE RECHAZAN **ANTES** DE BUFERIZAR, que es lo que los hace valer. Comprobar
 * el tamaño después de haber cargado el archivo en memoria es comprobar que ya
 * te lo tragaste.
 */

import type { LimitesDelZip } from '../../../../parser/lector.mjs';

const BYTES_POR_KB = 1024;
const KB_POR_MB = 1024;
const MB = BYTES_POR_KB * KB_POR_MB;

/** Tope del archivo subido. SEGURIDAD.md §5.1 propone 5 MB. */
export const MAXIMO_MB = 5;
export const MAXIMO_BYTES = MAXIMO_MB * MB;

/**
 * Tope de filas de datos.
 *
 * El criterio de aceptación de P10 habla de 5.000 filas, así que ese es el
 * volumen que el sistema tiene que sostener; el tope se pone por encima para
 * que el caso de aceptación no viva pegado al límite.
 */
export const MAXIMO_DE_FILAS = 10_000;

/**
 * Los topes del ZIP.
 *
 * **64 MB descomprimidos frente a 5 MB comprimidos** es una ratio de 13:1, que
 * un `.xlsx` legítimo no alcanza ni de lejos —el XML comprime mucho, pero un
 * libro de 5.000 filas no pasa de unos pocos megas— y que una zip bomb supera
 * en el primer instante. Las bombas clásicas van de 1000:1 para arriba.
 */
const MAXIMO_DESCOMPRIMIDO_MB = 64;
const MAXIMO_DE_ENTRADAS = 512;

export const LIMITES_DEL_ZIP: LimitesDelZip = {
  bytesDescomprimidos: MAXIMO_DESCOMPRIMIDO_MB * MB,
  entradas: MAXIMO_DE_ENTRADAS,
};
