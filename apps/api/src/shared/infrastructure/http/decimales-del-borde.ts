/**
 * El vocabulario de números que la API acepta por el cable — y el único sitio
 * donde se escribe una expresión regular de número.
 *
 * ============================================================================
 * POR QUÉ EXISTE: LA CUARTA RECURRENCIA DE INC-012
 * ============================================================================
 *
 * Hasta P16-B cada DTO definía su propio `decimal` con su propia regex, y su
 * propio mensaje: diez expresiones en seis archivos, y el mismo nombre con signo
 * en uno y sin él en otro. En `docs/sistema/guardas-de-dominio.md` varias
 * restricciones estaban marcadas 🟡 «lo filtra el esquema»… y el esquema no las
 * filtraba:
 *
 *   - `precio: "0"` y `"-1"` pasaban → `reference_price_positivo` → **500**
 *   - `pvp: "0"`, `rendimientoPorciones: "0"` → `product_location_*` → **500**
 *   - `costoTotal: "-5"` en una merma → `inventory_movement_importe_no_negativo`
 *
 * Un esquema llamado `decimal` no dice si admite cero o signo, y un mensaje que
 * dice «debe ser una cantidad positiva» encima de una regex que acepta `"0"` es
 * peor que no tener mensaje. Nadie lo ve leyendo el DTO, porque el DTO no miente
 * en voz alta: solo no dice.
 *
 * AQUÍ CADA ESQUEMA SE LLAMA COMO LO QUE ACEPTA, y cada campo se elige mirando el
 * `CHECK` de su columna. La regla `regex-de-numero-solo-en-el-vocabulario` de
 * `audit:forbidden` impide volver a escribir una regex en un `*.dto.ts`.
 *
 * TODO NÚMERO VIAJA COMO CADENA (ADR-003). Ninguno de estos es `z.number()`.
 */

import { z } from 'zod';

/** Más largo que esto no es un importe: es un intento de ReDoS o un error. */
const LARGO_MAXIMO_DE_DECIMAL = 40;

const cadena = z.string().max(LARGO_MAXIMO_DE_DECIMAL);

/**
 * Con signo: la cantidad de un movimiento de AJUSTE, que puede restar. El `CHECK`
 * que corresponda —distinto de cero, signo según el tipo— lo explica el dominio.
 */
export const decimalConSigno = cadena.regex(
  /^-?\d+(\.\d+)?$/u,
  'debe ser un decimal en notación normal, con signo si hace falta, por ejemplo "2.30" o "-1.5"',
);

/** Cero incluido: un costo fijo de cero, una línea de receta en cero, un importe de merma. */
export const decimalNoNegativo = cadena.regex(
  /^\d+(\.\d+)?$/u,
  'debe ser un decimal sin signo, cero incluido, por ejemplo "0" o "2.30"',
);

/**
 * Estrictamente mayor que cero: un precio, un PVP, un rendimiento por lote, una
 * presentación, una cantidad de combo. El lookahead exige al menos un dígito
 * distinto de cero, así que `"0"`, `"0.00"` y `"000"` no pasan y `"0.5"` sí.
 */
export const decimalPositivo = cadena.regex(
  /^(?=.*[1-9])\d+(\.\d+)?$/u,
  'debe ser un decimal mayor que cero, por ejemplo "2.30"',
);

/** Entre 0 y 1, los dos incluidos: una tarifa de IVA, un rendimiento, un umbral. */
export const fraccion = cadena.regex(
  /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u,
  'debe ser una fracción entre 0 y 1, por ejemplo "0.15"',
);

/** Un entero sin signo, en cadena: unidades vendidas. */
export const enteroNoNegativo = cadena.regex(/^\d+$/u, 'debe ser un número entero sin signo, por ejemplo "12"');
