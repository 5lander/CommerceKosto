/**
 * El consolidado de company — SPEC §18: «todo esto se calcula **por ubicación**,
 * y el consolidado de company es la agregación sobre ubicaciones».
 *
 * ESA FRASE ES TODO LO QUE EL SPEC DICE, y esconde la única decisión difícil
 * del paquete: **qué se agrega sumando y qué no.**
 *
 * ```
 *   SUMAN                          NO SUMAN — se RECALCULAN sobre los totales
 *   ─────                          ────────────────────────────────────────────
 *   unidades vendidas              food_cost_pct = Σcosto ÷ Σventa_neta
 *   venta neta                     margen_pct    = Σmc    ÷ Σventa_neta
 *   margen de contribucion         cobertura     = Σverificado ÷ Σvalor_total
 *   consumo teorico
 *   compras del mes
 *   inventario final
 *   costos fijos
 * ```
 *
 * **POR QUE UN PORCENTAJE NO SE PROMEDIA — y es la razon de existir de este
 * archivo.** Un local que vende 200 dolares al mes con un food cost del 80 % y
 * otro que vende 100.000 con el 30 % no dan «55 %». Dan 30,1 %, porque el
 * segundo es quinientas veces mas grande. La media simple le da a cada local un
 * voto igual, y **el dueno no toma decisiones por local sino por dolar**.
 *
 * El error es facil de cometer y **imposible de ver en pantalla**: 55 % es un
 * numero perfectamente plausible. Es exactamente la clase de fallo que
 * CLAUDE.md §0 describe — no se ve hoy, se ve seis meses despues.
 *
 * Por eso `consolidar` no expone ninguna via para promediar: los porcentajes
 * salen SIEMPRE de dividir dos totales, y hay una prueba con dos ubicaciones de
 * tamanos muy distintos cuyo resultado ponderado y cuya media simple difieren
 * en decenas de puntos. Si alguien cambia esto por un promedio, esa prueba cae.
 *
 * **UNA UBICACION SIN DATOS DEL MES NO VALE CERO.** Se aparta y se nombra, por
 * la misma razon por la que un item sin contar vale su teorico y no cero
 * (ADR-010 §5): un dato que falta no es un dato que vale cero. Sumarla como
 * cero rebajaria el food cost consolidado por no haber mirado.
 *
 * **Y EL CONSOLIDADO DICE EN QUE ESTADO ESTA CADA MES.** El periodo es de una
 * ubicacion, no de la company (ADR-010 §1), asi que esto puede estar sumando
 * meses cerrados con meses todavia abiertos. Quien lo lea tiene derecho a
 * saberlo sin preguntar — es la misma obligacion que la cobertura de D7.
 *
 * ES DOMINIO PURO. Entran los aportes de cada ubicacion, sale el consolidado.
 * Ni base, ni reloj, ni configuracion.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import type { LocationId } from '../../../shared/domain/identity/identificadores';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export type EstadoDelPeriodo = 'ABIERTO' | 'CERRADO';

/** Lo que una ubicación aporta al consolidado. Todo lo aditivo, y nada más. */
export interface AporteDeUbicacion {
  readonly locationId: LocationId;
  readonly nombre: string;
  readonly estadoDelPeriodo: EstadoDelPeriodo;

  readonly unidades: Count;
  readonly ventaNeta: Money;
  readonly mcTotal: Money;
  readonly consumoTeorico: Money;
  readonly consumoReal: Money;
  readonly comprasDelMes: Money;
  readonly inventarioFinal: Money;
  readonly costosFijos: Money;

  /** Valor verificado por el conteo, para recalcular la cobertura (D7). */
  readonly valorVerificado: Money;
  readonly valorInventariado: Money;
}

/** Una ubicación que existe pero no tiene nada de ese mes. */
export interface UbicacionSinDatos {
  readonly locationId: LocationId;
  readonly nombre: string;
}

export interface TotalesConsolidados {
  readonly unidades: Count;
  readonly ventaNeta: Money;
  readonly mcTotal: Money;
  readonly consumoTeorico: Money;
  readonly consumoReal: Money;
  readonly comprasDelMes: Money;
  readonly inventarioFinal: Money;
  readonly costosFijos: Money;
}

export interface Consolidado {
  readonly anio: number;
  readonly mes: number;

  readonly ubicaciones: readonly AporteDeUbicacion[];
  readonly sinDatos: readonly UbicacionSinDatos[];

  /** Cuántas de las incluidas tienen el mes ya cerrado. Ver ADR-010 §1. */
  readonly cerradas: number;
  readonly abiertas: number;

  readonly totales: TotalesConsolidados;

  /** `Σconsumo_teorico ÷ Σventa_neta`. **Nunca** el promedio de los locales. */
  readonly foodCostTeoricoPct: Ratio | null;
  readonly foodCostRealPct: Ratio | null;
  readonly margenPct: Ratio | null;
  /** `Σvalor_verificado ÷ Σvalor_inventariado`. También ponderada (D7). */
  readonly cobertura: Ratio | null;
}

export function consolidar(entrada: {
  readonly anio: number;
  readonly mes: number;
  readonly aportes: readonly AporteDeUbicacion[];
  readonly sinDatos: readonly UbicacionSinDatos[];
}): Consolidado {
  const { aportes } = entrada;
  const totales = sumar(aportes);

  return {
    anio: entrada.anio,
    mes: entrada.mes,
    ubicaciones: aportes,
    sinDatos: entrada.sinDatos,
    cerradas: aportes.filter((a) => a.estadoDelPeriodo === 'CERRADO').length,
    abiertas: aportes.filter((a) => a.estadoDelPeriodo === 'ABIERTO').length,
    totales,
    foodCostTeoricoPct: sobre(totales.consumoTeorico, totales.ventaNeta),
    foodCostRealPct: sobre(totales.consumoReal, totales.ventaNeta),
    margenPct: sobre(totales.mcTotal, totales.ventaNeta),
    cobertura: sobre(
      Money.sum(aportes.map((a) => a.valorVerificado)),
      Money.sum(aportes.map((a) => a.valorInventariado)),
    ),
  };
}

function sumar(aportes: readonly AporteDeUbicacion[]): TotalesConsolidados {
  return {
    unidades: aportes.reduce((suma, a) => suma.plus(a.unidades), Count.CERO),
    ventaNeta: Money.sum(aportes.map((a) => a.ventaNeta)),
    mcTotal: Money.sum(aportes.map((a) => a.mcTotal)),
    consumoTeorico: Money.sum(aportes.map((a) => a.consumoTeorico)),
    consumoReal: Money.sum(aportes.map((a) => a.consumoReal)),
    comprasDelMes: Money.sum(aportes.map((a) => a.comprasDelMes)),
    inventarioFinal: Money.sum(aportes.map((a) => a.inventarioFinal)),
    costosFijos: Money.sum(aportes.map((a) => a.costosFijos)),
  };
}

/** Sin denominador no hay porcentaje. `null`, nunca cero ni `NaN`. */
function sobre(parte: Money, total: Money): Ratio | null {
  return total.isZero() ? null : parte.ratioTo(total, DIVISION);
}
