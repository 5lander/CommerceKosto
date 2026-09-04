/**
 * Nucleo de la aritmetica decimal exacta.
 *
 * ESTE ES EL UNICO ARCHIVO DEL PROYECTO QUE PUEDE IMPORTAR `decimal.js`.
 * `audit:forbidden` y `dependency-cruiser` lo verifican. Fuera de esta carpeta,
 * el resto del sistema solo ve `Money`, `Ratio`, `Count` y `Quantity`
 * (y desde P3, `UnitCost`). Ver ADR-003.
 *
 * `decimal.js` tiene dos propiedades que pueden romper la conciliacion R7 en
 * silencio, y las dos se neutralizan aqui:
 *
 *  1. CONFIGURACION GLOBAL Y MUTABLE. `Decimal.set({...})` afecta a todo el
 *     proceso: cualquier modulo del proyecto, cualquier dependencia transitiva
 *     o un test mal aislado puede cambiar la precision de todos los calculos, y
 *     R7 pasaria de 0.00 a 0.01 sin que ningun diff lo explique.
 *     -> Se usa `Decimal.clone(...)`, que produce un constructor INDEPENDIENTE
 *        con su propia configuracion, inmune a `Decimal.set` global.
 *        `nucleo.spec.ts` lo demuestra ejecutando un `set` global y verificando
 *        que los resultados de aqui no se mueven.
 *
 *  2. TRABAJA EN DIGITOS SIGNIFICATIVOS, NO EN DECIMALES. `precision: 20`
 *     significa 20 digitos en total, no 20 decimales. Al acumular importes de
 *     magnitudes muy distintas (de 0.00832 a 59.78 en un mismo lote) eso es
 *     sutilmente incorrecto.
 *     -> Ninguna operacion publica depende de `precision`: toda division exige
 *        escala EXPLICITA y redondea con `toDecimalPlaces`, que si trabaja en
 *        decimales. `precision` se fija muy alta solo como colchon interno.
 */

import DecimalJs from 'decimal.js';

import { MAXIMA, type Escala } from './escalas';

/** Colchon interno de digitos significativos. Ninguna operacion depende de el. */
const PRECISION_INTERNA = 60;

/** Sin notacion exponencial jamas: `toString()` debe ser literal siempre. */
const SIN_EXPONENCIAL_NEGATIVO = -9e15;
const SIN_EXPONENCIAL_POSITIVO = 9e15;

/**
 * `ROUND_HALF_UP` de decimal.js: "rounds towards nearest neighbour; if
 * equidistant, rounds away from zero". Es exactamente el `ROUND()` de Excel,
 * que es la fuente de verdad del modelo (docs/SPEC.md, encabezado).
 *
 * NO es banker's rounding. La diferencia importa: con banker's, `0.125` a dos
 * decimales daria `0.12` y `2.5` a cero daria `2`. Con este, `0.13` y `3`.
 * `nucleo.spec.ts` lo prueba con los casos que discriminan entre ambos.
 */
const MEDIO_HACIA_ARRIBA = DecimalJs.ROUND_HALF_UP;

/**
 * Constructor propio, aislado de la configuracion global del proceso.
 * @internal
 */
export const D = DecimalJs.clone({
  precision: PRECISION_INTERNA,
  rounding: MEDIO_HACIA_ARRIBA,
  toExpNeg: SIN_EXPONENCIAL_NEGATIVO,
  toExpPos: SIN_EXPONENCIAL_POSITIVO,
  defaults: true,
});

/** @internal */
export type Nucleo = InstanceType<typeof D>;

/**
 * Cadena decimal literal. Se rechaza notacion exponencial, separadores de
 * miles, signo `+` y espacios: son sintomas de un dato que viene mal de un
 * borde y que hay que corregir alli, no tolerar aqui.
 */
const CADENA_DECIMAL = /^-?\d+(?:\.\d+)?$/;

export class ValorDecimalInvalidoError extends Error {
  public override readonly name = 'ValorDecimalInvalidoError';

  public constructor(valor: string, motivo: string) {
    super(`Valor decimal invalido "${valor}": ${motivo}`);
  }
}

export class DivisionPorCeroError extends Error {
  public override readonly name = 'DivisionPorCeroError';

  public constructor(contexto: string) {
    super(
      `Division por cero en ${contexto}. Las formulas del SPEC protegen este caso ` +
        'explicitamente (factor_conversion = 0, rendimiento = 0, rendimiento_porciones = 0): ' +
        'el guard va en la regla de negocio, no en la aritmetica.',
    );
  }
}

export class EscalaExcedidaError extends Error {
  public override readonly name = 'EscalaExcedidaError';

  public constructor(escalaObtenida: number) {
    super(
      `La operacion produjo escala ${String(escalaObtenida)}, por encima del maximo ${String(MAXIMA)}. ` +
        'Multiplicar suma escalas: revisa si la cadena de operaciones tiene un paso de mas.',
    );
  }
}

/**
 * Convierte una cadena decimal literal en el valor interno.
 * @internal
 */
export function desdeCadena(valor: string, contexto: string): Nucleo {
  if (!CADENA_DECIMAL.test(valor)) {
    throw new ValorDecimalInvalidoError(
      valor,
      `${contexto} exige una cadena decimal literal (sin exponente, sin signo +, sin espacios ni separadores de miles)`,
    );
  }
  return new D(valor);
}

/**
 * Decimales que ocupa un valor. `decimal.js` los expone como `dp()`.
 * @internal
 */
export function decimalesDe(valor: Nucleo): number {
  return valor.decimalPlaces();
}

/** @internal */
export function verificarEscala(valor: Nucleo): Nucleo {
  const decimales = decimalesDe(valor);
  if (decimales > MAXIMA) throw new EscalaExcedidaError(decimales);
  return valor;
}

/**
 * La UNICA operacion que redondea. Escala obligatoria en la firma: no hay valor
 * por defecto, precisamente porque un defecto es el mecanismo por el que R7
 * pasaria a dar 0.01 sin que nadie lo note.
 * @internal
 */
export function dividir(operacion: {
  readonly dividendo: Nucleo;
  readonly divisor: Nucleo;
  readonly escala: Escala;
  readonly contexto: string;
}): Nucleo {
  const { dividendo, divisor, escala, contexto } = operacion;
  if (divisor.isZero()) throw new DivisionPorCeroError(contexto);
  return dividendo.dividedBy(divisor).toDecimalPlaces(escala, MEDIO_HACIA_ARRIBA);
}

/**
 * Redondeo explicito, con la semantica de Excel.
 * @internal
 */
export function redondear(valor: Nucleo, escala: Escala): Nucleo {
  return valor.toDecimalPlaces(escala, MEDIO_HACIA_ARRIBA);
}

/**
 * Representacion literal con un numero fijo de decimales, sin exponente.
 * @internal
 */
export function aCadenaFija(valor: Nucleo, escala: Escala): string {
  return valor.toFixed(escala, MEDIO_HACIA_ARRIBA);
}
