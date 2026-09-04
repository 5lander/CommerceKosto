/**
 * El costeo del producto — SPEC §14, textual.
 *
 * ```
 * costo_bruto_lote  = Σ(cantidad × costo_bruto_uso)   [solo líneas ACTIVA]
 * costo_neto_lote   = Σ(costo_linea)                  [solo líneas ACTIVA]
 * costo_por_porcion = rendimiento = 0 ? 0 : costo_neto_lote / rendimiento_porciones
 * costo_con_merma   = costo_por_porcion × (1 + merma_no_atribuible)
 * COSTO_TOTAL_UNIDAD = costo_con_merma + empaque_neto
 *
 * venta_neta    = pvp_con_iva / (1 + iva_venta)
 * iva_en_precio = pvp_con_iva - venta_neta
 * MARGEN_CONTRIBUCION = venta_neta - costo_total_unidad
 * mc_pct        = margen_contribucion / venta_neta
 * FOOD_COST_PCT = costo_total_unidad / venta_neta
 * suma_control  = mc_pct + food_cost_pct        → debe dar 1
 * multiplicador = venta_neta / costo_total_unidad
 * impacto_merma = costo_bruto_lote = 0 ? null : costo_neto_lote / costo_bruto_lote - 1
 * ```
 *
 * **ESTE ARCHIVO ES EL PRODUCTO.** Un dueño de restaurante fija el precio de su
 * carta con lo que salga de aquí. Las fórmulas van copiadas del SPEC, no
 * derivadas de memoria, y se prueban contra `docs/pruebas/casos-conocidos.md`,
 * cuyos valores esperados salen del Excel original y no de este código.
 *
 * ES DOMINIO PURO: entran valores, salen valores. Ni base de datos, ni reloj,
 * ni configuración leída de ningún sitio. Todos los parámetros de SPEC §11
 * llegan por argumento, porque son configuración por company (D3) y ninguno
 * puede estar escrito aquí.
 *
 * **DOS BLOQUES, NO UNO.** El costo existe siempre; la venta solo si hay PVP.
 * `product_location.pvp` es anulable y un producto sin precio fijado es lo
 * normal antes de decidirlo. Devolver `food_cost_pct = 0` en ese caso sería
 * decir «este plato no cuesta nada», que es lo contrario de la verdad. Por eso
 * el lado de venta es una UNIÓN: o está entero, o dice por qué no está. Es la
 * guarda que el SPEC no escribe y CC-009 exige.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import { Money, Ratio, type Count } from '../../../shared/domain/money/tipos-monetarios';
import {
  costoDeLinea,
  participacionEnElProducto,
  type BaseDeLinea,
  type CostosDelItem,
  type EstadoDeLinea,
} from '../../recipes/domain/linea-de-receta';

/**
 * Una línea de receta con los costos de su ítem YA RESUELTOS.
 *
 * El motor no consulta precios: los recibe. Es lo que permite probarlo con la
 * base apagada, que es el criterio arquitectónico de CLAUDE.md §2.
 */
export interface LineaParaCostear {
  readonly cantidad: Ratio;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
  readonly costos: CostosDelItem;
}

/** Lo que aporta cada línea, para el desglose de SPEC §13. */
export interface LineaCosteada {
  readonly costo: Money;
  /** `pct_del_producto`: cuánto pesa esta línea en el costo del plato. */
  readonly participacion: Ratio;
}

export interface CostosDelProducto {
  readonly costoBrutoLote: Money;
  readonly costoNetoLote: Money;
  readonly costoPorPorcion: Money;
  readonly costoConMerma: Money;
  readonly empaqueNeto: Money;
  readonly costoTotalUnidad: Money;
  /**
   * Cuánto más cuesta el lote por la merma que el rendimiento de cada ítem
   * explica. `null` cuando el lote bruto es cero, tal como el SPEC lo escribe:
   * un `0` se leería como «esta receta no tiene merma», que es otra cosa.
   */
  readonly impactoMerma: Ratio | null;
  readonly lineas: readonly LineaCosteada[];
}

export interface Vendible {
  readonly clase: 'vendible';
  readonly ventaNeta: Money;
  readonly ivaEnPrecio: Money;
  readonly margenContribucion: Money;
  readonly mcPct: Ratio;
  readonly foodCostPct: Ratio;
  /** R6: `mc_pct + food_cost_pct` tiene que dar exactamente 1. */
  readonly sumaControl: Ratio;
  readonly multiplicador: Ratio | null;
}

export interface SinPrecio {
  readonly clase: 'sin_precio';
  readonly motivo: string;
}

/**
 * O el bloque de venta entero, o el motivo por el que no hay.
 *
 * Es una unión y no un puñado de campos anulables a propósito: con anulables,
 * quien consume esto puede olvidarse de mirar uno. Con la unión, no compila
 * hasta que decide qué hacer con el caso sin precio.
 */
export type ResultadoDeVenta = Vendible | SinPrecio;

export interface CosteoDeProducto {
  readonly costos: CostosDelProducto;
  readonly venta: ResultadoDeVenta;
}

export interface EntradaDeCosteo {
  readonly lineas: readonly LineaParaCostear[];
  /** Cuántas porciones salen del lote. `null` = todavía no capturado. */
  readonly rendimientoPorciones: Ratio | null;
  /** SPEC §11. Solo lo que ningún rendimiento explica (R12). */
  readonly provisionMerma: Ratio;
  readonly empaqueNeto: Money;
  /** PVP CON IVA incluido (R14). `null` = producto sin precio fijado. */
  readonly pvp: Money | null;
  readonly ivaVenta: Ratio;
}

export function costearProducto(entrada: EntradaDeCosteo): CosteoDeProducto {
  const costos = costosDelProducto(entrada);
  return {
    costos,
    venta: ladoDeVenta({
      pvp: entrada.pvp,
      ivaVenta: entrada.ivaVenta,
      costoTotalUnidad: costos.costoTotalUnidad,
    }),
  };
}

function costosDelProducto(entrada: EntradaDeCosteo): CostosDelProducto {
  const lote = costosDelLote(entrada.lineas);
  const costoPorPorcion = porPorcion(lote.neto, entrada.rendimientoPorciones);
  const costoConMerma = costoPorPorcion.times(entrada.provisionMerma.onePlus());

  return {
    costoBrutoLote: lote.bruto,
    costoNetoLote: lote.neto,
    costoPorPorcion,
    costoConMerma,
    empaqueNeto: entrada.empaqueNeto,
    costoTotalUnidad: costoConMerma.plus(entrada.empaqueNeto),
    impactoMerma: impactoDeLaMerma(lote),
    lineas: lote.lineas,
  };
}

interface CostosDelLote {
  readonly bruto: Money;
  readonly neto: Money;
  readonly lineas: readonly LineaCosteada[];
}

/**
 * `costo_bruto_lote` y `costo_neto_lote` en una sola pasada.
 *
 * **EL BRUTO TAMBIÉN SALTA LAS LÍNEAS INACTIVAS.** SPEC §14 lo dice —«solo
 * líneas ACTIVA»— en las dos sumas, y es lo que hace que `impacto_merma` mida
 * la merma de lo que de verdad entra al plato. Sumar el bruto de una línea
 * excluida daría un impacto de merma menor que el real.
 */
function costosDelLote(lineas: readonly LineaParaCostear[]): CostosDelLote {
  const activas = lineas.filter((linea) => linea.estado === 'ACTIVA');

  const bruto = Money.sum(activas.map((l) => l.costos.costoBrutoDeUso.times(l.cantidad)));
  const costosDeLinea = lineas.map((linea) => costoDeLinea(linea));
  const neto = Money.sum(costosDeLinea);

  return {
    bruto,
    neto,
    lineas: costosDeLinea.map((costo) => ({
      costo,
      participacion: participacionEnElProducto({ costoDeLaLinea: costo, costoDelProducto: neto }),
    })),
  };
}

/**
 * La guarda del SPEC: rendimiento cero devuelve cero, no lanza.
 *
 * Significa «todavía no se capturó», y un producto a medio configurar tiene que
 * poder mirarse. Lo que no puede pasar es que produzca `Infinity` y viaje hasta
 * un margen, y por eso la guarda va aquí delante: `Money.dividedBy` lanza ante
 * el cero, no devuelve infinito.
 */
function porPorcion(neto: Money, rendimientoPorciones: Ratio | null): Money {
  if (rendimientoPorciones === null || rendimientoPorciones.isZero()) {
    return Money.CERO;
  }
  return neto.dividedBy(rendimientoPorciones, DIVISION);
}

function impactoDeLaMerma(lote: CostosDelLote): Ratio | null {
  if (lote.bruto.isZero()) {
    return null;
  }
  return lote.neto.ratioTo(lote.bruto).minus(Ratio.UNO);
}

const SIN_PVP: SinPrecio = {
  clase: 'sin_precio',
  motivo:
    'Este producto no tiene PVP fijado en esta ubicación. El costo está calculado; ' +
    'el margen y el food cost necesitan un precio de venta.',
};

const PVP_CERO: SinPrecio = {
  clase: 'sin_precio',
  motivo:
    'El PVP de este producto es cero en esta ubicación. Un food cost sobre venta neta ' +
    'cero no es un porcentaje: es una división por cero.',
};

/**
 * El lado de venta, exportado porque los combos también lo necesitan.
 *
 * Un combo llega con su costo total ya resuelto —la suma de sus componentes— y
 * de ahí en adelante la aritmética es idéntica. Sin este punto único habría dos
 * sitios calculando `venta_neta`, `mc_pct` y la suma de control, que es
 * exactamente la clase de duplicación que hace que R6 se rompa en uno de los dos.
 */
export function ladoDeVenta(entrada: {
  readonly pvp: Money | null;
  readonly ivaVenta: Ratio;
  readonly costoTotalUnidad: Money;
}): ResultadoDeVenta {
  const { costoTotalUnidad } = entrada;

  if (entrada.pvp === null) {
    return SIN_PVP;
  }
  if (entrada.pvp.isZero()) {
    return PVP_CERO;
  }

  // R14: el PVP incluye IVA y el food cost se calcula sobre la venta NETA.
  // Calcularlo sobre el PVP daría un food cost ~13 % menor con IVA del 15 %.
  const ventaNeta = entrada.pvp.dividedBy(entrada.ivaVenta.onePlus(), DIVISION);
  const margenContribucion = ventaNeta.minus(costoTotalUnidad);

  // R6 POR CONSTRUCCIÓN, NO POR SUERTE.
  //
  // Dividir las dos veces —`mc/venta` y `costo/venta`— es la forma obvia y es
  // la que puede romper la suma de control: cada división redondea a la escala
  // 12, y cuando las dos caen en un empate exacto en el decimal trece, ambas
  // redondean hacia arriba y la suma da 1.000000000001. Una regla que CLAUDE.md
  // §6 marca como invariante no puede depender de que eso no pase nunca.
  //
  // Se divide UNA vez —el food cost, que es el número que manda el semáforo— y
  // el margen es su complemento. Así `mc% + food_cost% = 1` es cierto siempre,
  // y coincide dígito a dígito con lo que `V_COSTEO` muestra en los tres casos
  // conocidos. Que el complemento no esconda un error lo comprueba una prueba
  // que calcula `mc/venta` por separado y exige que coincidan.
  const foodCostPct = costoTotalUnidad.ratioTo(ventaNeta);
  const mcPct = Ratio.UNO.minus(foodCostPct);

  return {
    clase: 'vendible',
    ventaNeta,
    ivaEnPrecio: entrada.pvp.minus(ventaNeta),
    margenContribucion,
    mcPct,
    foodCostPct,
    sumaControl: mcPct.plus(foodCostPct),
    // Un plato que no cuesta nada no tiene multiplicador: no es infinito, es
    // que la pregunta «cuántas veces el costo» no tiene respuesta sin costo.
    multiplicador: costoTotalUnidad.isZero() ? null : ventaNeta.ratioTo(costoTotalUnidad),
  };
}

/**
 * `venta_neta_mes` y `mc_mes` (SPEC §14).
 *
 * Van aparte del costeo porque necesitan las unidades vendidas del período, y
 * el período es una dimensión que el Excel no tiene (SPEC §3): en el SaaS llega
 * con P7. Aquí existen porque la conciliación R7 los necesita.
 */
export function totalesDelMes(entrada: {
  readonly venta: Vendible;
  readonly unidades: Count;
}): { readonly ventaNetaMes: Money; readonly mcMes: Money } {
  return {
    ventaNetaMes: entrada.venta.ventaNeta.times(entrada.unidades),
    mcMes: entrada.venta.margenContribucion.times(entrada.unidades),
  };
}
