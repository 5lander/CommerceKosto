/**
 * Food cost real y varianza — SPEC §16, textual. **Aquí vive R7.**
 *
 * ```
 * CONSUMO_REAL    = inicial + compras - final_fisico
 * CONSUMO_TEORICO = Σ(consumo_teorico_mes × costo_neto_uso)
 *
 * VARIANZA_USD = consumo_real - consumo_teorico
 * varianza_pct = varianza_usd / consumo_teorico     → sobre 5% es problema de proceso
 *
 * food_cost_teorico_pct = consumo_teorico / venta_neta_mes
 * food_cost_real_pct    = consumo_real / venta_neta_mes
 * brecha_en_puntos      = (real_pct - teorico_pct) × 100
 *
 * empaque_teorico_mes = Σ(empaque_neto × unidades_mes)
 * provision_merma_mes = Σ(costo_por_porcion × merma_no_atribuible × unidades_mes)
 * costo_ventas_teorico = consumo_teorico + empaque_teorico + provision_merma
 * costo_ventas_v_costeo = venta_neta_mes_total - mc_mes_total
 * DIFERENCIA_CONCILIACION = ROUND(costo_ventas_teorico - costo_ventas_v_costeo, 2)
 * ```
 *
 * > ✅ **`DIFERENCIA_CONCILIACION` debe dar exactamente 0.**
 *
 * **QUÉ SIGNIFICA QUE R7 DÉ CERO, Y QUÉ NO.** Es una identidad algebraica: los
 * dos lados calculan el mismo costo de ventas por caminos distintos —uno desde
 * los ítems consumidos, otro desde el margen de cada plato— y si el motor de
 * costeo está sano tienen que coincidir. Lo que R7 detecta es un motor que
 * *dejó* de estar sano: un componente que se suma en un lado y no en el otro,
 * un redondeo que se cuela, un empaque que se olvida.
 *
 * **Lo que R7 NO detecta es un número de entrada equivocado.** Si el consumo
 * teórico está mal calculado, los dos lados se equivocan igual y la diferencia
 * sigue dando cero. Por eso los casos conocidos —cuyos valores salen del Excel
 * y no de este código— siguen siendo la defensa principal, y R7 es la segunda.
 *
 * ES DOMINIO PURO. Entran ocho importes, salen los indicadores. Ni base, ni
 * reloj, ni configuración leída de ningún sitio.
 */

import { DIVISION, PRESENTACION } from '../../../shared/domain/decimal/escalas';
import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export interface EntradaDeFoodCostReal {
  /** El conteo confirmado del período anterior, valorizado. */
  readonly inventarioInicial: Money;
  /** `Σ(total_cost)` de los movimientos `COMPRA` del período. */
  readonly comprasDelMes: Money;
  /** El conteo de este período: lo contado donde se contó, lo teórico donde no. */
  readonly inventarioFinalFisico: Money;
  /** `Σ(consumo por receta × costo_neto_uso)`. */
  readonly consumoTeorico: Money;
  readonly ventaNetaMes: Money;
  readonly empaqueTeoricoMes: Money;
  readonly provisionMermaMes: Money;
  readonly mcMesTotal: Money;
}

export interface FoodCostReal {
  readonly consumoReal: Money;
  readonly consumoTeorico: Money;
  readonly varianzaUsd: Money;
  /** `null` sin consumo teórico: la varianza relativa no tiene denominador. */
  readonly varianzaPct: Ratio | null;
  readonly foodCostTeoricoPct: Ratio | null;
  readonly foodCostRealPct: Ratio | null;
  /** En PUNTOS porcentuales, no en fracción. `(real − teórico) × 100`. */
  readonly brechaEnPuntos: Ratio | null;
  readonly costoVentasTeorico: Money;
  readonly costoVentasSegunCosteo: Money;
  /** R7 — redondeado a 2 decimales, **tiene que dar exactamente cero**. */
  readonly diferenciaConciliacion: Money;
}

const CIEN = Ratio.fromDecimalString('100');

export function foodCostReal(entrada: EntradaDeFoodCostReal): FoodCostReal {
  const consumoReal = entrada.inventarioInicial
    .plus(entrada.comprasDelMes)
    .minus(entrada.inventarioFinalFisico);

  const costoVentasTeorico = entrada.consumoTeorico
    .plus(entrada.empaqueTeoricoMes)
    .plus(entrada.provisionMermaMes);

  const costoVentasSegunCosteo = entrada.ventaNetaMes.minus(entrada.mcMesTotal);

  return {
    consumoReal,
    consumoTeorico: entrada.consumoTeorico,
    varianzaUsd: consumoReal.minus(entrada.consumoTeorico),
    varianzaPct: sobre(consumoReal.minus(entrada.consumoTeorico), entrada.consumoTeorico),
    ...porcentajes({ ...entrada, consumoReal }),
    costoVentasTeorico,
    costoVentasSegunCosteo,
    // EL `ROUND(·, 2)` ES PARTE DE LA FÓRMULA, no una comodidad de
    // presentación: SPEC §16 lo escribe dentro de la definición de
    // DIFERENCIA_CONCILIACION. Sin él, un residuo de 1e-13 arrastrado por
    // catorce divisiones haría fallar una regla que sí se cumple.
    diferenciaConciliacion: costoVentasTeorico.minus(costoVentasSegunCosteo).round(PRESENTACION),
  };
}

interface Porcentajes {
  readonly foodCostTeoricoPct: Ratio | null;
  readonly foodCostRealPct: Ratio | null;
  readonly brechaEnPuntos: Ratio | null;
}

function porcentajes(
  entrada: EntradaDeFoodCostReal & { readonly consumoReal: Money },
): Porcentajes {
  const teorico = sobre(entrada.consumoTeorico, entrada.ventaNetaMes);
  const real = sobre(entrada.consumoReal, entrada.ventaNetaMes);

  return {
    foodCostTeoricoPct: teorico,
    foodCostRealPct: real,
    brechaEnPuntos: teorico === null || real === null ? null : real.minus(teorico).times(CIEN),
  };
}

/**
 * El cociente, o `null` si el divisor es cero.
 *
 * **Devolver `null` y no cero**: un food cost sobre venta cero no es «0 %», es
 * una pregunta sin respuesta. Un cero ahí se leería como «este local no gasta
 * nada en comida», que es lo contrario de lo que un mes sin ventas significa.
 */
function sobre(numerador: Money, divisor: Money): Ratio | null {
  return divisor.isZero() ? null : numerador.ratioTo(divisor, DIVISION);
}
