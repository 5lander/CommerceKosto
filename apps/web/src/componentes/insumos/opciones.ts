/**
 * Las opciones de los formularios de insumo, compartidas por el alta y la edición.
 *
 * **LOS VALORES SON LOS DE LA API** (`COMPRADO`, `FACTURA`…); los textos, los de
 * `textos/es.ts`. Una sola lista: el día que la API gane un origen de precio, se
 * añade aquí y aparece en los dos formularios.
 */

import type { Opcion } from '../ui/Selector';
import { TEXTOS } from '../../textos/es';

/** Un porcentaje con hasta tres cifras enteras y dos decimales, con coma o punto. */
export const PORCENTAJE = /^\d{0,3}(?:[.,]\d{0,2})?$/u;

/** El valor del selector de grupo que significa «ninguno»: la API recibe `null`. */
export const SIN_GRUPO = '';

export const SI = 'si';

export const TIPOS: readonly Opcion[] = [
  { valor: 'COMPRADO', texto: TEXTOS.insumos.tipos.COMPRADO },
  { valor: 'PRODUCIDO', texto: TEXTOS.insumos.tipos.PRODUCIDO },
];

export const SI_NO: readonly Opcion[] = [
  { valor: SI, texto: TEXTOS.insumo.llevaStockSi },
  { valor: 'no', texto: TEXTOS.insumo.llevaStockNo },
];

export const CONFIANZAS: readonly Opcion[] = [
  { valor: 'FACTURA', texto: TEXTOS.insumo.confianzas.FACTURA },
  { valor: 'ESTIMADO', texto: TEXTOS.insumo.confianzas.ESTIMADO },
];

/** Los grupos de la API como opciones, con «Sin grupo» delante. */
export function opcionesDeGrupos(grupos: readonly { readonly id: string; readonly nombre: string }[]): readonly Opcion[] {
  return [{ valor: SIN_GRUPO, texto: TEXTOS.insumo.sinGrupo }, ...grupos.map((g) => ({ valor: g.id, texto: g.nombre }))];
}
