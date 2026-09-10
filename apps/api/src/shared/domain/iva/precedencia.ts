/**
 * De dónde sale la tarifa de IVA de una compra — D-16.9, D-16.43.
 *
 * **DOS NIVELES, Y NINGUNO ES LA COMPANY.** La tarifa es del artículo de
 * compra —la factura del saco de harina dice 0 % y la del detergente 15 %— o,
 * cuando la compra no trae artículo, del grupo del ítem. Por encima de los
 * dos, lo que diga el cuerpo de la petición: quien tiene la factura delante
 * sabe más que el catálogo.
 *
 * **NUNCA HAY UN VALOR POR DEFECTO.** Antes `company_settings.iva_compra`
 * rellenaba el hueco y el precio de un plátano nacía con el IVA del
 * detergente. Cuando ningún nivel define la tarifa, esta función devuelve
 * `null` y quien la llama rechaza la compra con `TarifaDeIvaDesconocidaError`,
 * que dice dónde ponerla. Un 400 hoy es más barato que un costo plausible y
 * equivocado durante seis meses.
 *
 * Las tarifas viajan como CADENA decimal: parsearlas es de quien las usa
 * (`Ratio.fromDecimalString`), y así esta función sirve igual al caso de uso
 * de un movimiento suelto, al lote del importador y a la sugerencia de precio.
 *
 * ES DOMINIO PURO. CC-IVA-04 la prueba.
 */

export interface FuentesDeTarifa {
  /** Lo que trae la petición o la fila del archivo. */
  readonly cuerpo: string | null;
  /** La del artículo de compra, si la compra lo trae. */
  readonly articulo: string | null;
  /** La del grupo del ítem, si el grupo la define. */
  readonly grupo: string | null;
}

/** Cuerpo > artículo > grupo. `null` cuando ninguno la define. */
export function elegirTarifa(fuentes: FuentesDeTarifa): string | null {
  return fuentes.cuerpo ?? fuentes.articulo ?? fuentes.grupo;
}
