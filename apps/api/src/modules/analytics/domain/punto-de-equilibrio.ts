/**
 * Punto de equilibrio, prime cost y margen de seguridad — SPEC §17, textual.
 *
 * ```
 * costo_alimentos_empaque = venta_neta_mes_total - mc_mes_total
 * costos_variables_adic   = venta_neta × pct_variable_total   [de T6]
 * MC_NETO                 = mc - costos_variables_adic
 * costos_fijos            = Σ(montos fijos de T6)
 * UTILIDAD_OPERATIVA      = mc_neto - costos_fijos
 *
 * mano_de_obra   = Σ(líneas de T6 clasificadas como MANO_DE_OBRA)
 * PRIME_COST     = costo_alimentos_empaque + mano_de_obra
 * prime_cost_pct = prime_cost / venta_neta          → objetivo ≤ 0.65
 *
 * mc_promedio_unitario    = (mc_mes_total - costos_variables_adic) / unidades_totales
 * unidades_equilibrio_mes = mc_promedio ≤ 0 ? null : costos_fijos / mc_promedio_unitario
 * unidades_por_dia        = unidades_equilibrio_mes / dias_operativos
 * venta_neta_equilibrio   = unidades_equilibrio × (venta_neta_total / unidades_totales)
 * venta_con_iva_equilibrio = venta_neta_equilibrio × (1 + iva_venta)
 * MARGEN_DE_SEGURIDAD     = 1 - venta_neta_equilibrio / venta_neta
 * ```
 *
 * **LA MANO DE OBRA SE IDENTIFICA POR CLASIFICACIÓN, NO POR EL TEXTO DEL
 * CONCEPTO**, y es el propio SPEC quien lo exige: en el Excel se filtra por el
 * prefijo `"Sueldos*"` y la nota dice que «es frágil». Un concepto llamado
 * «Nómina», «Salarios» o «Rol de pagos» quedaría fuera del prime cost sin que
 * nada avisara, y el prime cost es el indicador que decide si un local es
 * viable. Aquí la clasificación es una columna con `CHECK` y tres valores.
 *
 * **`mc_promedio ≤ 0` DEVUELVE `null`, NO UN NÚMERO NEGATIVO.** Un margen de
 * contribución neto negativo significa que cada unidad vendida pierde dinero:
 * no hay ninguna cantidad de unidades que alcance el equilibrio. Un número
 * negativo ahí se leería como una meta alcanzable.
 *
 * ES DOMINIO PURO. Los días operativos y el IVA llegan por parámetro: son
 * configuración por company (D3).
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export type ClasificacionDeCosto = 'MANO_DE_OBRA' | 'OTRO_FIJO' | 'VARIABLE';

/**
 * Una línea de T6.
 *
 * `importe` significa dos cosas según la clasificación, y no es ambigüedad:
 * `VARIABLE` lo trae como **fracción de la venta neta** —`0.03` es 3 %— y las
 * otras dos como **monto mensual**. Lo dice el catálogo `is_percentage` de la
 * base, no el nombre del concepto.
 */
export interface LineaDeCosto {
  readonly concepto: string;
  readonly clasificacion: ClasificacionDeCosto;
  readonly importe: Money;
}

export interface EntradaDePuntoDeEquilibrio {
  readonly ventaNetaMes: Money;
  readonly mcMesTotal: Money;
  readonly unidadesTotales: Count;
  readonly costos: readonly LineaDeCosto[];
  readonly diasOperativos: Count;
  readonly ivaVenta: Ratio;
}

export interface PuntoDeEquilibrio {
  readonly ventaNeta: Money;
  readonly costoAlimentosYEmpaque: Money;
  readonly margenContribucion: Money;
  readonly costosVariables: Money;
  readonly mcNeto: Money;
  readonly costosFijos: Money;
  readonly utilidadOperativa: Money;

  readonly manoDeObra: Money;
  readonly primeCost: Money;
  readonly primeCostPct: Ratio | null;

  /** `null` cuando cada unidad pierde dinero: no hay equilibrio alcanzable. */
  readonly unidadesEquilibrioMes: Ratio | null;
  readonly unidadesPorDia: Ratio | null;
  readonly ventaNetaEquilibrio: Money | null;
  readonly ventaConIvaEquilibrio: Money | null;
  readonly margenDeSeguridad: Ratio | null;
}

export function puntoDeEquilibrio(entrada: EntradaDePuntoDeEquilibrio): PuntoDeEquilibrio {
  const totales = totalesDeT6(entrada.costos);
  const costosVariables = entrada.ventaNetaMes.times(totales.pctVariable);
  const mcNeto = entrada.mcMesTotal.minus(costosVariables);
  const costoAlimentosYEmpaque = entrada.ventaNetaMes.minus(entrada.mcMesTotal);
  const primeCost = costoAlimentosYEmpaque.plus(totales.manoDeObra);

  return {
    ventaNeta: entrada.ventaNetaMes,
    costoAlimentosYEmpaque,
    margenContribucion: entrada.mcMesTotal,
    costosVariables,
    mcNeto,
    costosFijos: totales.fijos,
    utilidadOperativa: mcNeto.minus(totales.fijos),

    manoDeObra: totales.manoDeObra,
    primeCost,
    primeCostPct: entrada.ventaNetaMes.isZero()
      ? null
      : primeCost.ratioTo(entrada.ventaNetaMes, DIVISION),

    ...equilibrio({ ...entrada, mcNeto, costosFijos: totales.fijos }),
  };
}

interface TotalesDeT6 {
  readonly fijos: Money;
  readonly manoDeObra: Money;
  readonly pctVariable: Ratio;
}

/**
 * Los tres totales en una pasada.
 *
 * **`MANO_DE_OBRA` CUENTA DOS VECES, Y ES CORRECTO.** Suma a `costos_fijos`
 * —porque el sueldo se paga haya o no ventas— y a `prime_cost` —porque el
 * prime cost es comida más gente—. No son dos conceptos que se solapen por
 * error: son dos preguntas distintas sobre el mismo dinero.
 */
function totalesDeT6(costos: readonly LineaDeCosto[]): TotalesDeT6 {
  const de = (clase: ClasificacionDeCosto): readonly LineaDeCosto[] =>
    costos.filter((linea) => linea.clasificacion === clase);

  const manoDeObra = Money.sum(de('MANO_DE_OBRA').map((linea) => linea.importe));
  const otrosFijos = Money.sum(de('OTRO_FIJO').map((linea) => linea.importe));

  return {
    fijos: manoDeObra.plus(otrosFijos),
    manoDeObra,
    // El importe de una línea VARIABLE es una fracción de la venta neta, así
    // que sumarlas da el porcentaje total. `Money` es el tipo con que viaja
    // desde la base, y este es el único sitio donde se lee como razón.
    pctVariable: Ratio.fromDecimalString(
      Money.sum(de('VARIABLE').map((linea) => linea.importe)).toStorageString(),
    ),
  };
}

interface Equilibrio {
  readonly unidadesEquilibrioMes: Ratio | null;
  readonly unidadesPorDia: Ratio | null;
  readonly ventaNetaEquilibrio: Money | null;
  readonly ventaConIvaEquilibrio: Money | null;
  readonly margenDeSeguridad: Ratio | null;
}

const SIN_EQUILIBRIO: Equilibrio = {
  unidadesEquilibrioMes: null,
  unidadesPorDia: null,
  ventaNetaEquilibrio: null,
  ventaConIvaEquilibrio: null,
  margenDeSeguridad: null,
};

function equilibrio(
  entrada: EntradaDePuntoDeEquilibrio & { readonly mcNeto: Money; readonly costosFijos: Money },
): Equilibrio {
  const unidades = entrada.unidadesTotales.asRatio();
  if (entrada.unidadesTotales.isZero()) return SIN_EQUILIBRIO;

  const mcPromedioUnitario = entrada.mcNeto.dividedBy(unidades, DIVISION);
  // Cada unidad pierde dinero: ninguna cantidad de unidades llega al equilibrio.
  if (!mcPromedioUnitario.isPositive()) return SIN_EQUILIBRIO;

  const unidadesEquilibrio = entrada.costosFijos.ratioTo(mcPromedioUnitario, DIVISION);
  const ventaNetaPorUnidad = entrada.ventaNetaMes.dividedBy(unidades, DIVISION);
  const ventaNetaEquilibrio = ventaNetaPorUnidad.times(unidadesEquilibrio);

  return {
    unidadesEquilibrioMes: unidadesEquilibrio,
    unidadesPorDia: entrada.diasOperativos.isZero()
      ? null
      : unidadesEquilibrio.dividedBy(entrada.diasOperativos.asRatio(), DIVISION),
    ventaNetaEquilibrio,
    ventaConIvaEquilibrio: ventaNetaEquilibrio.times(entrada.ivaVenta.onePlus()),
    margenDeSeguridad: entrada.ventaNetaMes.isZero()
      ? null
      : Ratio.UNO.minus(ventaNetaEquilibrio.ratioTo(entrada.ventaNetaMes, DIVISION)),
  };
}
