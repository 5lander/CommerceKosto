/**
 * El neteo del IVA de compra — SPEC §12, la primera línea, textual:
 *
 * ```
 * precio_neto = iva_recuperable ? precio_compra / (1 + iva_compra) : precio_compra
 * ```
 *
 * **VIVE UNA SOLA VEZ, Y AQUÍ.** La necesitan dos módulos: `pricing`, para
 * netear el precio de referencia, e `inventory`, para netear el total de la
 * factura que teclea el bodeguero (D-16.9). Dos copias son dos oportunidades
 * de que difieran —la decisión 16 de P5 y D-16.40—, y el día que una de las
 * dos cambiara, el costo del plato y el food cost real dejarían de hablar del
 * mismo número sin que nada avisara.
 *
 * **SI EL IVA NO SE RECUPERA, ES COSTO** (R13). Entonces el bruto entra
 * íntegro al plato: no se divide por nada.
 *
 * La división lleva la escala `DIVISION` del proyecto, como toda división del
 * motor: es la única fuente de error de todo el sistema y su cota está
 * razonada en `shared/domain/decimal/escalas.ts`.
 *
 * ES DOMINIO PURO. Se prueba con los casos CC-IVA-01..03 de
 * `docs/pruebas/casos-conocidos.md`, calculados a mano antes que el código.
 */

import { DIVISION } from '../decimal/escalas';
import type { Money, Ratio } from '../money/tipos-monetarios';

export interface EntradaDeNeteo {
  /** Lo que se pagó, con IVA incluido si lo lleva. */
  readonly bruto: Money;
  /** La tarifa que aplicó a ESA compra. Fracción: `0.15`, no `15`. */
  readonly tarifa: Ratio;
  /** Configuración de la company (R13). */
  readonly recuperable: boolean;
}

export function netear(entrada: EntradaDeNeteo): Money {
  return entrada.recuperable
    ? entrada.bruto.dividedBy(entrada.tarifa.onePlus(), DIVISION)
    : entrada.bruto;
}
