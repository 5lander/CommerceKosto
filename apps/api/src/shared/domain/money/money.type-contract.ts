/**
 * Contrato de tipos de `Money`. **NO es un test de ejecucion: es una asercion
 * de compilacion.** Nada de este archivo se ejecuta nunca; lo verifica `tsc`
 * a traves de `audit:types`.
 *
 * ESTE ARCHIVO ES EL CRITERIO DE ACEPTACION DE P0 que dice:
 *   "un test que intenta sumar dinero con punto flotante falla"
 *
 * Cada `@ts-expect-error` AFIRMA que la linea siguiente no compila, y es
 * autoverificable en las dos direcciones:
 *
 *   - si la linea sigue siendo un error  -> `tsc` calla, el contrato se cumple
 *   - si algun dia deja de serlo         -> `tsc` falla con
 *     "Unused '@ts-expect-error' directive" y `audit:types` se pone en rojo
 *
 * Es decir: la proteccion no puede degradarse en silencio. Y por eso no es un
 * `.spec.ts`: si se ejecutara, cada linea lanzaria en tiempo de ejecucion
 * (que es lo correcto, pero es la OTRA defensa) y el archivo dejaria de medir
 * lo que dice medir.
 *
 * `@ts-expect-error` esta prohibido en todo el repositorio por
 * `audit:forbidden`, con una unica excepcion acotada a los archivos
 * `*.type-contract.ts` — registrada en ADR-003.
 *
 * Lo que NO cubre este archivo, porque TypeScript no puede: los operadores
 * relacionales (`<`, `>`, `<=`, `>=`) SI compilan entre dos operandos del mismo
 * tipo, aunque ese tipo no sea numerico. Esa via la corta `valueOf()`, y se
 * verifica en `tipos-monetarios.spec.ts`.
 */

import { DIVISION } from '../decimal/escalas';
import { Count, Money, Quantity, Ratio } from './tipos-monetarios';
import { unidadDeUso } from '../unidad/unidad-de-uso';

export function contratoDeTipos(): void {
  const precio = Money.fromDecimalString('0.10');
  const otro = Money.fromDecimalString('0.20');
  const proporcion = Ratio.fromDecimalString('0.15');

  // --- Los operadores aritmeticos no aplican a Money ----------------------

  // @ts-expect-error El operador + no aplica entre Money y number.
  precio + 1;
  // @ts-expect-error El operando izquierdo de * debe ser number o bigint.
  precio * 2;
  // @ts-expect-error Sumar dos Money con + concatenaria, no sumaria.
  precio + otro;

  // --- Money no es asignable donde se espera un number --------------------

  // @ts-expect-error Math.max espera number.
  Math.max(precio, otro);
  // @ts-expect-error Acumular con + sobre Money.
  [precio, otro].reduce((a, b) => a + b);
  // @ts-expect-error Un Money no rellena una variable numerica.
  const suelto: number = precio;
  void suelto;

  // --- Ningun constructor acepta un literal numerico ----------------------

  // @ts-expect-error Exige cadena: un literal decimal ya habria perdido
  // exactitud antes de llegar aqui.
  Money.fromDecimalString(0.1);
  // @ts-expect-error Idem para el importe tecleado.
  Money.fromCapturedInput(12.34);
  // @ts-expect-error Idem para Ratio.
  Ratio.fromDecimalString(0.15);

  // --- Las operaciones no aceptan number ----------------------------------

  // @ts-expect-error times admite Ratio o Count, nunca number.
  precio.times(2);
  // @ts-expect-error dividedBy tampoco.
  precio.dividedBy(3, DIVISION);

  // --- La escala de division es obligatoria -------------------------------

  // @ts-expect-error Sin escala no compila: un valor por defecto es justo el
  // mecanismo por el que R7 pasaria a dar 0.01 sin que nadie lo note.
  precio.dividedBy(Count.fromInteger(3));

  // --- No se pueden mezclar magnitudes distintas --------------------------

  // @ts-expect-error Money + Ratio no significa nada.
  precio.plus(proporcion);
  // @ts-expect-error Multiplicar dinero por dinero tampoco.
  precio.times(precio);
  // @ts-expect-error Un Ratio no se compara con un Money.
  proporcion.compare(precio);

  // --- Quantity: la unidad tambien es parte del tipo ----------------------

  const enKilos = Quantity.of('18.14', unidadDeUso('kg'));

  // @ts-expect-error Una cantidad no se suma a un importe.
  enKilos.plus(precio);
  // @ts-expect-error Ni un importe a una cantidad.
  precio.plus(enKilos);
  // @ts-expect-error timesScalar admite Ratio o Count, nunca number.
  enKilos.timesScalar(2);
  // @ts-expect-error Quantity.of exige unidad: una cantidad sin unidad no
  // significa nada.
  Quantity.of('1');
  // @ts-expect-error La unidad no es una cadena cualquiera: se construye con
  // unidadDeUso(), que valida el codigo.
  Quantity.of('1', 'kg');

  // Mezclar DOS unidades distintas si compila —ambas son UnidadDeUso— y se
  // corta en ejecucion con UnidadIncompatibleError. Es el mismo reparto de
  // responsabilidades que con los operadores relacionales: lo que el sistema de
  // tipos no puede expresar, lo hace cumplir el dominio. Ver quantity.spec.ts.

  // --- Y esto SI compila: es la aritmetica correcta -----------------------

  const costo = Money.fromDecimalString('0.4611078936');
  const merma = Ratio.fromDecimalString('0.02');
  const unidades = Count.fromInteger(340);

  const conMerma: Money = costo.times(merma.onePlus());
  const delMes: Money = conMerma.times(unidades);
  const foodCost: Ratio = costo.ratioTo(otro, DIVISION);

  void delMes;
  void foodCost;
}
