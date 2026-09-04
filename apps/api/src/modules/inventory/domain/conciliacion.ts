/**
 * Conciliar el conteo con el libro — SPEC §16 y §18, D7.
 *
 * Puro: entra lo que el libro dice, lo que se contó y lo que cuesta cada
 * unidad de uso; sale la diferencia por ítem y los tres valores agregados. Sin
 * base de datos, sin fechas, sin sesión.
 *
 * **LOS TRES VALORES AGREGADOS SON DISTINTOS Y NINGUNO SOBRA:**
 *
 * | | |
 * |---|---|
 * | `valorTeorico` | Lo que el libro dice que hay, todo el inventario |
 * | `valorCubierto` | La parte de `valorTeorico` que alguien fue a verificar |
 * | `valorFisico`  | El inventario final de SPEC §16: lo contado donde se contó, lo teórico donde no |
 *
 * `cobertura = valorCubierto / valorTeorico` es el indicador de D7, y **viaja
 * siempre pegado a los números que se derivan de él**. Un consumo real
 * calculado sobre un conteo del 12 % del valor no es un consumo real: es una
 * estimación, y quien la lea tiene derecho a saberlo sin preguntar.
 *
 * **UN ÍTEM NO CONTADO APORTA SU VALOR TEÓRICO A `valorFisico`, NO CERO.** Es
 * lo que significa «no genera diferencia» en D7: no contarlo no puede equivaler
 * a declarar que se consumió entero, que es lo que pasaría si valiera cero.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import type { ItemId } from '../../../shared/domain/identity/identificadores';
import { Money, Quantity, Ratio } from '../../../shared/domain/money/tipos-monetarios';

/** Lo que se sabe de un ítem al conciliar. */
export interface EntradaDeConciliacion {
  readonly itemId: ItemId;
  /** El saldo del libro en el corte. Puede ser negativo: faltan compras. */
  readonly teorico: Quantity;
  /** `null` si nadie lo contó — D7: no genera diferencia. */
  readonly contado: Quantity | null;
  /** `costo_neto_uso` de SPEC §12, a la fecha del corte. */
  readonly costoDeUso: Money;
}

export interface LineaConciliada {
  readonly itemId: ItemId;
  readonly teorico: Quantity;
  readonly contado: Quantity | null;
  /** `null` cuando no se contó. No es cero: es «sin verificar». */
  readonly diferencia: Quantity | null;
  readonly valorDeDiferencia: Money | null;
  readonly valorTeorico: Money;
  /**
   * El costo por unidad de uso con el que se valoró la línea.
   *
   * Viaja en la salida porque **un cero aquí significa «este ítem no tiene
   * precio confirmado»**, y quien lea la conciliación tiene derecho a
   * distinguir un inventario barato de uno sin costear. Reconstruirlo fuera
   * dividiendo valor entre cantidad fallaría justo donde importa: con cantidad
   * teórica cero no se puede dividir.
   */
  readonly costoDeUso: Money;
}

export interface Conciliacion {
  readonly lineas: readonly LineaConciliada[];
  readonly valorTeorico: Money;
  readonly valorCubierto: Money;
  readonly valorFisico: Money;
  /** `null` si no hay nada que verificar: dividir por cero no es «0 %». */
  readonly cobertura: Ratio | null;
}

export function conciliar(entradas: readonly EntradaDeConciliacion[]): Conciliacion {
  const lineas = entradas.map(conciliarUna);

  const valorTeorico = Money.sum(lineas.map((linea) => linea.valorTeorico));
  const valorCubierto = Money.sum(
    lineas.filter((linea) => linea.contado !== null).map((linea) => linea.valorTeorico),
  );
  const valorFisico = Money.sum(entradas.map(valorFisicoDe));

  return {
    lineas,
    valorTeorico,
    valorCubierto,
    valorFisico,
    cobertura: valorTeorico.isZero() ? null : valorCubierto.ratioTo(valorTeorico, DIVISION),
  };
}

/**
 * `CONSUMO_REAL = inicial + compras − final_fisico` — SPEC §16.
 *
 * El `inicial` es el inventario final físico del período anterior, no el saldo
 * del libro: la cadena de food cost real se ancla en conteos, que es lo que
 * dice la fórmula del Excel. Si no hubo conteo el mes pasado, quien llama pasa
 * el valor teórico del corte anterior y la cobertura lo delata.
 */
export function consumoReal(entrada: {
  readonly valorInicial: Money;
  readonly comprasDelPeriodo: Money;
  readonly valorFisico: Money;
}): Money {
  return entrada.valorInicial.plus(entrada.comprasDelPeriodo).minus(entrada.valorFisico);
}

function conciliarUna(entrada: EntradaDeConciliacion): LineaConciliada {
  const valorTeorico = valorDe(entrada.teorico, entrada.costoDeUso);

  if (entrada.contado === null) {
    return {
      itemId: entrada.itemId,
      teorico: entrada.teorico,
      contado: null,
      diferencia: null,
      valorDeDiferencia: null,
      valorTeorico,
      costoDeUso: entrada.costoDeUso,
    };
  }

  const diferencia = entrada.contado.minus(entrada.teorico);
  return {
    itemId: entrada.itemId,
    teorico: entrada.teorico,
    contado: entrada.contado,
    diferencia,
    valorDeDiferencia: valorDe(diferencia, entrada.costoDeUso),
    valorTeorico,
    costoDeUso: entrada.costoDeUso,
  };
}

function valorFisicoDe(entrada: EntradaDeConciliacion): Money {
  return valorDe(entrada.contado ?? entrada.teorico, entrada.costoDeUso);
}

/**
 * `magnitude()` es el único puente de `Quantity` a escalar, y afirmarlo aquí
 * es afirmar que `costoDeUso` está expresado **por unidad de uso** del mismo
 * ítem. Lo está: es `costo_neto_uso` de SPEC §12.
 */
function valorDe(cantidad: Quantity, costoDeUso: Money): Money {
  return costoDeUso.times(cantidad.magnitude());
}
