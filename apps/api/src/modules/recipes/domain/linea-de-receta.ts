/**
 * El costo de una línea de receta — SPEC §13, R4.
 *
 * ```
 * costo_linea = estado = "ACTIVA"
 *               ? cantidad × (base = "EP" ? costo_neto_uso : costo_bruto_uso)
 *               : 0
 * ```
 *
 * **EL SPEC LA LLAMA «LA CONDICIONAL MÁS FRÁGIL DEL MODELO», y con razón.** Si
 * la cantidad está expresada en EP —producto ya limpio— se aplica el
 * rendimiento; si está en AP —tal como se compra— no. Implementarla al revés
 * produce números plausibles y equivocados en las 293 líneas del Excel: nada
 * se rompe, nada avisa, y el food cost sale mal seis meses seguidos.
 *
 * POR QUÉ ES ASÍ, en una frase que conviene tener a mano: `costo_neto_uso` ya
 * lleva el rendimiento dentro (`costo_bruto / rendimiento`, SPEC §12). Si la
 * receta pide 200 g **ya limpios**, hay que comprar más de 200 g, y ese
 * sobreprecio está en el costo neto. Si la receta pide 200 g **tal como se
 * compran**, la merma se produce después y no la paga esta línea.
 *
 * SE ESCRIBE COMO UNA TABLA Y NO COMO UN `if`. Un `Record` sobre la unión de
 * bases obliga a que añadir una tercera base no compile hasta que alguien
 * decida qué costo le toca. Un `if` con `else` la habría tratado como AP en
 * silencio.
 *
 * ES DOMINIO PURO. Y aunque el cálculo completo del producto llegue en P5,
 * **esta línea se modela ya**: el plan de P4 lo pide porque el esquema y las
 * pruebas tienen que fijar la semántica antes de que exista el motor.
 */

import { Money } from '../../../shared/domain/money/tipos-monetarios';
import type { Count, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export type BaseDeLinea = 'AP' | 'EP';
export type EstadoDeLinea = 'ACTIVA' | 'INACTIVA';

/** Los dos costos por unidad de uso que produce la cadena de SPEC §12. */
export interface CostosDelItem {
  /** Sin el rendimiento: lo que cuesta la unidad tal como se compra. */
  readonly costoBrutoDeUso: Money;
  /** Con el rendimiento dentro: lo que cuesta la unidad aprovechable. */
  readonly costoNetoDeUso: Money;
}

export interface EntradaDeLinea {
  readonly cantidad: Ratio | Count;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
  readonly costos: CostosDelItem;
}

/**
 * La tabla que hace de R4 algo que no se puede escribir al revés sin querer.
 *
 * `EP` → costo NETO (lleva el rendimiento dentro).
 * `AP` → costo BRUTO (la merma se produce después).
 */
const COSTO_SEGUN_BASE: Readonly<Record<BaseDeLinea, (costos: CostosDelItem) => Money>> = {
  EP: (costos) => costos.costoNetoDeUso,
  AP: (costos) => costos.costoBrutoDeUso,
};

export function costoDeLinea(entrada: EntradaDeLinea): Money {
  // Una línea inactiva cuesta CERO y no se borra: SPEC §13 la tiene en la
  // fórmula, y conservarla deja ver qué se quitó y cuándo.
  if (entrada.estado !== 'ACTIVA') {
    return Money.CERO;
  }

  return COSTO_SEGUN_BASE[entrada.base](entrada.costos).times(entrada.cantidad);
}

/**
 * `pct_del_producto = costo_linea / Σ(costo_linea del mismo producto)` (SPEC §13).
 *
 * Con total cero devuelve cero en vez de lanzar: un producto cuyas líneas
 * cuestan cero —porque aún no hay precios— tiene que poder mostrarse.
 */
export function participacionEnElProducto(entrada: {
  readonly costoDeLaLinea: Money;
  readonly costoDelProducto: Money;
}): Ratio {
  if (entrada.costoDelProducto.isZero()) {
    return RATIO_CERO;
  }
  return entrada.costoDeLaLinea.ratioTo(entrada.costoDelProducto);
}

const RATIO_CERO = Money.CERO.ratioTo(Money.fromDecimalString('1'));
