/**
 * El costo de un combo — SPEC §8.
 *
 * «Tipos: `SIMPLE` (receta a ítems) · `COMBO` (componentes que son productos
 * simples). **El combo usa las porciones reducidas, no los productos de
 * carta.** Menu engineering: el combo compite como ítem propio. El descuento
 * **no se prorratea**.»
 *
 * **EL SPEC NO ESCRIBE LA FÓRMULA**, así que P5 la fija con tres reglas
 * explícitas, cada una con su razón. Están en `docs/pruebas/casos-conocidos.md`
 * (CC-006) y en **ADR-008**:
 *
 * 1. **No se vuelve a aplicar la provisión de merma.** Cada componente ya la
 *    lleva dentro de su `COSTO_TOTAL_UNIDAD`. Aplicarla otra vez sería cobrar la
 *    merma dos veces, que es justo lo que R12 prohíbe.
 * 2. **No se divide por `rendimiento_porciones`.** Un combo es una unidad; sus
 *    componentes ya vienen costeados por porción.
 * 3. **El combo suma el empaque de sus componentes y añade el suyo si lo
 *    tiene.** Un combo servido en bandeja añade la bandeja **una vez**; si no
 *    lleva empaque propio, el total es la suma limpia de sus componentes.
 *
 * **EL DESCUENTO NO SE PRORRATEA.** El PVP del combo es suyo y suele ser menor
 * que la suma de los PVP sueltos. Esa diferencia es del combo: no se reparte
 * entre los componentes, que siguen valiendo lo que valen en la carta. Por eso
 * aquí solo se suman COSTOS, nunca precios de venta.
 *
 * ES DOMINIO PURO, y reutiliza el lado de venta del costeo del producto: la
 * aritmética de `venta_neta`, `mc_pct`, food cost y suma de control es la misma,
 * y tenerla en dos sitios sería tener R6 rota en uno de los dos.
 */

import { Money, type Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { ladoDeVenta, type ResultadoDeVenta } from './costeo-de-producto';

export interface ComponenteCosteado {
  readonly cantidad: Ratio;
  /** El `COSTO_TOTAL_UNIDAD` del producto simple, ya con su merma y su empaque. */
  readonly costoTotalUnidad: Money;
}

export interface EntradaDeCombo {
  readonly componentes: readonly ComponenteCosteado[];
  /** El empaque PROPIO del combo. `Money.CERO` si no lleva ninguno. */
  readonly empaqueNeto: Money;
  /** PVP CON IVA del combo (R14). `null` = sin precio fijado. */
  readonly pvp: Money | null;
  readonly ivaVenta: Ratio;
}

export interface CosteoDeCombo {
  readonly costoDeComponentes: Money;
  readonly empaqueNeto: Money;
  readonly costoTotalUnidad: Money;
  readonly venta: ResultadoDeVenta;
}

export function costearCombo(entrada: EntradaDeCombo): CosteoDeCombo {
  const costoDeComponentes = Money.sum(
    entrada.componentes.map((c) => c.costoTotalUnidad.times(c.cantidad)),
  );
  const costoTotalUnidad = costoDeComponentes.plus(entrada.empaqueNeto);

  return {
    costoDeComponentes,
    empaqueNeto: entrada.empaqueNeto,
    costoTotalUnidad,
    venta: ladoDeVenta({ pvp: entrada.pvp, ivaVenta: entrada.ivaVenta, costoTotalUnidad }),
  };
}
