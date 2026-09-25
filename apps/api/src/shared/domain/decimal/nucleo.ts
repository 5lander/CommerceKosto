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

import { ErrorDeDominio, type CodigoDeDominio } from '../errors/error-de-dominio';
import { valorParaMensaje } from '../errors/valor-en-mensaje';
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

/**
 * ES UN ERROR DE DOMINIO, Y ESO LO CONVIERTE EN UN 400 (P16-A2, INC-012).
 *
 * Antes extendia `Error` a secas y salia como **500 `INTERNAL_ERROR`**: un
 * precio escrito con coma, con espacio de miles o con mas decimales de los que
 * el sistema conserva tumbaba la peticion sin decir que corregir. Y el mensaje
 * llevaba dentro el nombre del metodo interno que lo lanzo
 * (`Money.fromDecimalString`), que ahora que el texto VIAJA AL CLIENTE no tiene
 * por que salir: se mueve a `detalle`, que el filtro escribe en el log en nivel
 * `debug` y nunca en la respuesta. (Hasta la revision de P16-A2 nadie leia ese
 * campo, asi que el dato no se reubicaba: se perdia.)
 *
 * Es SIEMPRE un error de entrada. Un decimal mal formado no se fabrica dentro:
 * lo que viene de la base sale de columnas `numeric(24,12)` y lo que se calcula
 * no pasa por aqui —esta funcion es la puerta de `cadena -> numero`, y esa
 * puerta solo la cruzan los valores que alguien escribio—.
 */
export class ValorDecimalInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(valor: string, motivo: string, contexto: string) {
    super(`El valor "${valorParaMensaje(valor)}" no es un numero valido: ${motivo}.`, { contexto });
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

/**
 * SIGUE SIENDO UN 500, Y ESO ES LO CORRECTO (P16-A2).
 *
 * Se penso convertirlo en 400 junto con los otros dos y se descarto: este no es
 * un error del borde, es el techo de escala saltando **a mitad de un calculo**.
 * Multiplicar suma escalas, asi que llegar aqui significa que una cadena de
 * operaciones tiene un paso de mas — un bug del motor, no una peticion mal
 * escrita. Convertirlo en 400 le diria al usuario que arregle algo que no es
 * suyo, y —peor— el filtro dejaria de escribir la traza en el log, que es
 * justo lo unico con lo que se diagnostica.
 *
 * Lo que si se cerro es el camino por el que un dato de entrada llegaba hasta
 * aqui: `desdeCadena` rechaza antes, con `ValorDecimalInvalidoError` y un 400
 * que explica el limite. Despues de eso, si esto salta, es de casa.
 */
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
      'se espera un decimal en notacion normal, con punto y sin signo +, sin espacios, ' +
        'sin separadores de miles y sin exponente (por ejemplo "1234.56")',
      contexto,
    );
  }
  if (decimalesDeLaCadena(valor) > MAXIMA) {
    throw new ValorDecimalInvalidoError(
      valor,
      `tiene mas de ${String(MAXIMA)} decimales, que es todo lo que este sistema conserva; ` +
        'redondealo antes de enviarlo',
      contexto,
    );
  }
  return new D(valor);
}

/**
 * Decimales que trae la CADENA, contados sobre el texto y no sobre el numero.
 *
 * Es la guarda de entrada del techo de escala, y tiene que correr ANTES de
 * construir el valor: `new D(...)` con 40 decimales ya no se puede examinar sin
 * haberlo aceptado. Ver `EscalaExcedidaError`, que es lo que pasaba antes.
 */
function decimalesDeLaCadena(valor: string): number {
  const punto = valor.indexOf('.');
  return punto === -1 ? 0 : valor.length - punto - 1;
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
