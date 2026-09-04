/**
 * Tipos de dominio para dinero y magnitudes adimensionales.
 *
 * El producto real de este sistema es la exactitud del numero: un dueno de
 * restaurante fija precios con lo que aqui se calcule. Por eso estos tipos no
 * son azucar sintactico sobre `number`, son una barrera.
 *
 * TRES DEFENSAS CONTRA EL PUNTO FLOTANTE, de compilacion a ejecucion:
 *
 *  1. Marca nominal + campo privado. `money + 1`, `money * 2`, `a > b` y
 *     `Math.max(a, b)` son errores de COMPILACION. Ver money.type-contract.spec.ts.
 *  2. Ningun constructor acepta `number`. Se entra por cadena decimal literal,
 *     de modo que `0.1` nunca llega a la aritmetica como binario.
 *  3. `valueOf()` lanza. Cierra los caminos que el compilador no ve: un `any`
 *     colado desde `JSON.parse`, un helper generico, una doble asercion.
 *
 * Y una cuarta, fuera del tipo: `audit:forbidden` prohibe `as unknown as` en
 * todo el repositorio, y los literales con punto decimal dentro de `domain/`.
 *
 * MATRIZ DE OPERACIONES — lo que hace imposible mezclar magnitudes:
 *
 *   Money    +/-  Money             -> Money
 *   Money     x   Ratio | Count     -> Money
 *   Money     /   Ratio | Count     -> Money
 *   Money     /   Money             -> Ratio     (food cost %, multiplicador)
 *   Ratio    x/   Ratio             -> Ratio
 *   Quantity +/-  Quantity misma ud -> Quantity  (distinta ud -> error)
 *   Quantity  x   Ratio | Count     -> Quantity
 *   Quantity  /   Quantity misma ud -> Ratio
 *   cualquiera con `number`         -> error de compilacion
 *   Money     x   Money             -> el metodo no existe
 */

import {
  aCadenaFija,
  D,
  desdeCadena,
  dividir,
  redondear,
  verificarEscala,
  type Nucleo,
} from '../decimal/nucleo';
import { ALMACENAMIENTO, DIVISION, PRESENTACION, type Escala } from '../decimal/escalas';
import { exigirMismaUnidad, type UnidadDeUso } from '../unidad/unidad-de-uso';

declare const MARCA_MONEY: unique symbol;
declare const MARCA_RATIO: unique symbol;
declare const MARCA_COUNT: unique symbol;
declare const MARCA_QUANTITY: unique symbol;

/** Resultado de una comparacion: menor, igual o mayor. */
export type Comparacion = -1 | 0 | 1;

const CERO = '0';
const UNO = '1';

export class ImporteCapturadoInvalidoError extends Error {
  public override readonly name = 'ImporteCapturadoInvalidoError';

  public constructor(valor: string) {
    super(
      `El importe tecleado "${valor}" tiene mas de ${String(PRESENTACION)} decimales. ` +
        'Un precio que un usuario escribe es un hecho contractual: se guarda tal cual, no se redondea por nosotros.',
    );
  }
}

export class ConteoInvalidoError extends Error {
  public override readonly name = 'ConteoInvalidoError';

  public constructor(valor: string) {
    super(`Conteo invalido "${valor}": debe ser un entero no negativo.`);
  }
}

/**
 * Lo que TODO valor decimal de este modulo comparte: comparacion y
 * serializacion. `Money`, `Ratio`, `Count` y `Quantity` heredan de aqui.
 *
 * POR QUE UNA BASE Y NO CUATRO COPIAS. La API de comparacion tiene que estar
 * COMPLETA en los cuatro tipos: `audit:forbidden` prohibe `.toNumber()` y
 * `as unknown as`, que son las dos salidas de emergencia por las que alguien
 * compararia importes, y una regla que bloquea la unica via disponible acaba
 * relajandose por presion. Completa y por cuadruplicado son ~50 lineas
 * identicas, que es la cuarta repeticion — el umbral que OPTIMIZACION.md §1
 * fija para extraer. Lo detecto `audit:duplication`.
 *
 * EL VALOR SIGUE SIENDO PRIVADO DE VERDAD. `#valor` vive aqui, en un campo
 * privado de clase, no en un `protected`: sigue siendo inalcanzable desde
 * fuera, y los metodos de esta clase pueden leerlo en `otro` porque el acceso
 * ocurre lexicamente dentro de la clase que lo declara.
 *
 * LA MARCA NOMINAL NO SE HEREDA, y por eso `Money` y `Ratio` siguen sin poder
 * mezclarse: cada subclase declara la suya. Compartir comportamiento no es
 * compartir identidad.
 *
 * `otro: this` y no `otro: ValorDecimal`: en cada subclase el parametro se
 * concreta a esa subclase. `money.compare(ratio)` no compila.
 */
abstract class ValorDecimal {
  readonly #valor: Nucleo;

  protected constructor(valor: Nucleo) {
    this.#valor = valor;
  }

  /** @internal Solo para los tipos hermanos de este modulo. */
  public get nucleo(): Nucleo {
    return this.#valor;
  }

  /**
   * Punto de extension de la comparacion.
   *
   * Existe por `Quantity`, que antes de comparar EXIGE la misma unidad: sin
   * este gancho, heredar la comparacion la habria dejado comparando kilos con
   * unidades en silencio. La base por defecto no exige nada.
   */
  protected exigirComparable(otro: this): Nucleo {
    return otro.nucleo;
  }

  public compare(otro: this): Comparacion {
    return this.#valor.comparedTo(this.exigirComparable(otro)) as Comparacion;
  }

  public equals(otro: this): boolean {
    return this.compare(otro) === 0;
  }

  public lessThan(otro: this): boolean {
    return this.compare(otro) === -1;
  }

  public lessThanOrEqual(otro: this): boolean {
    return this.compare(otro) <= 0;
  }

  public greaterThan(otro: this): boolean {
    return this.compare(otro) === 1;
  }

  public greaterThanOrEqual(otro: this): boolean {
    return this.compare(otro) >= 0;
  }

  public isZero(): boolean {
    return this.#valor.isZero();
  }

  /** `-0` no es negativo: es cero. */
  public isNegative(): boolean {
    return this.#valor.isNegative() && !this.#valor.isZero();
  }

  public isPositive(): boolean {
    return this.#valor.isPositive() && !this.#valor.isZero();
  }

  /** UNICA entrada al ORM. Escala 12, el contrato de `numeric(24,12)`. */
  public toStorageString(): string {
    return aCadenaFija(this.#valor, ALMACENAMIENTO);
  }

  /** Escala nativa, sin perdida. Para logs, mensajes de prueba y el canario de R7. */
  public toExactString(): string {
    return this.#valor.toFixed();
  }

  public toJSON(): string {
    return this.toExactString();
  }

  /**
   * Cierra la coercion implicita que el compilador no puede ver.
   *
   * Abstracto a proposito: el mensaje dice que usar EN SU LUGAR, y eso depende
   * del tipo. Un texto generico convertiria el unico momento en que alguien lee
   * este error en una perdida de tiempo.
   */
  public abstract valueOf(): never;
}

/**
 * Un importe en la moneda de la company (USD, D11).
 *
 * No lleva escala fija: `+`, `-` y `x` son exactos y la escala crece sola. El
 * redondeo ocurre solo al dividir, al persistir y al presentar.
 */
export class Money extends ValorDecimal {
  private declare readonly [MARCA_MONEY]: 'USD';

  private constructor(valor: Nucleo) {
    super(verificarEscala(valor));
  }

  /** @internal Solo para los tipos hermanos de este modulo. */
  public static desdeNucleo(valor: Nucleo): Money {
    return new Money(valor);
  }

  public static readonly CERO: Money = new Money(new D(CERO));

  /** Valor derivado de un calculo o leido de un caso conocido. Cualquier escala. */
  public static fromDecimalString(valor: string): Money {
    return new Money(desdeCadena(valor, 'Money.fromDecimalString'));
  }

  /**
   * Importe tecleado por un usuario. Exige como maximo dos decimales: si trae
   * mas, es un error del borde y se rechaza en vez de redondearse en silencio.
   */
  public static fromCapturedInput(valor: string): Money {
    const nucleo = desdeCadena(valor, 'Money.fromCapturedInput');
    if (nucleo.decimalPlaces() > PRESENTACION) throw new ImporteCapturadoInvalidoError(valor);
    return new Money(nucleo);
  }

  /** Borde del ORM: lo que viene de una columna `numeric(24,12)`. */
  public static fromDatabase(valor: string): Money {
    return new Money(desdeCadena(valor, 'Money.fromDatabase'));
  }

  /**
   * Suma exacta. El orden de los sumandos no altera el resultado — y esa es
   * justamente la propiedad que el punto flotante no tiene.
   */
  public static sum(valores: readonly Money[]): Money {
    return valores.reduce((acumulado, actual) => acumulado.plus(actual), Money.CERO);
  }

  public plus(otro: Money): Money {
    return new Money(this.nucleo.plus(otro.nucleo));
  }

  public minus(otro: Money): Money {
    return new Money(this.nucleo.minus(otro.nucleo));
  }

  /** No acepta `Money`: multiplicar dinero por dinero no significa nada. */
  public times(factor: Ratio | Count): Money {
    return new Money(this.nucleo.times(factor.nucleo));
  }

  public dividedBy(divisor: Ratio | Count, escala: Escala): Money {
    return new Money(dividir({ dividendo: this.nucleo, divisor: divisor.nucleo, escala, contexto: 'Money.dividedBy' }));
  }

  /**
   * Dinero entre dinero da una proporcion adimensional: es `food_cost_pct`,
   * `mc_pct` y el multiplicador del SPEC §14.
   */
  public ratioTo(otro: Money, escala: Escala = DIVISION): Ratio {
    return Ratio.desdeNucleo(dividir({ dividendo: this.nucleo, divisor: otro.nucleo, escala, contexto: 'Money.ratioTo' }));
  }

  public negated(): Money {
    return new Money(this.nucleo.negated());
  }

  public abs(): Money {
    return new Money(this.nucleo.abs());
  }

  // --- Comparacion --------------------------------------------------------
  //
  // La API esta COMPLETA a proposito, no solo `compare`. `audit:forbidden`
  // prohibe `.toNumber()` y `as unknown as`, que son las dos salidas de
  // emergencia por las que alguien compararia importes; una regla que bloquea
  // la unica via disponible acaba relajandose por presion. Aqui la via legal
  // existe y es mas comoda que la ilegal.
  //
  // Todas son insensibles a la escala: `1.50` y `1.5` son el mismo importe.

  /** UNICA entrada a un DTO. El `ROUND(x, 2)` del SPEC. */
  public toDisplayString(): string {
    return aCadenaFija(this.nucleo, PRESENTACION);
  }

  public round(escala: Escala): Money {
    return new Money(redondear(this.nucleo, escala));
  }

  public override valueOf(): never {
    throw new TypeError(
      'Money no se convierte a number. Un importe en punto flotante deja de ser exacto: ' +
        'usa plus/minus/times/dividedBy, o toDisplayString() para mostrarlo.',
    );
  }
}

/**
 * Proporcion adimensional: IVA, rendimiento, merma no atribuible, food cost %,
 * indice de popularidad, multiplicador.
 */
export class Ratio extends ValorDecimal {
  private declare readonly [MARCA_RATIO]: 'ratio';

  private constructor(valor: Nucleo) {
    super(verificarEscala(valor));
  }

  /** @internal */
  public static desdeNucleo(valor: Nucleo): Ratio {
    return new Ratio(valor);
  }

  public static readonly CERO: Ratio = new Ratio(new D(CERO));
  public static readonly UNO: Ratio = new Ratio(new D(UNO));

  public static fromDecimalString(valor: string): Ratio {
    return new Ratio(desdeCadena(valor, 'Ratio.fromDecimalString'));
  }

  /**
   * `1 + r`. Aparece tres veces en el SPEC —`precio_neto`, `venta_neta` y
   * `costo_con_merma`— y tenerlo con nombre evita escribir el `1` suelto cada vez.
   */
  public onePlus(): Ratio {
    return new Ratio(this.nucleo.plus(UNO));
  }

  public plus(otro: Ratio): Ratio {
    return new Ratio(this.nucleo.plus(otro.nucleo));
  }

  public minus(otro: Ratio): Ratio {
    return new Ratio(this.nucleo.minus(otro.nucleo));
  }

  public times(otro: Ratio): Ratio {
    return new Ratio(this.nucleo.times(otro.nucleo));
  }

  public dividedBy(divisor: Ratio, escala: Escala): Ratio {
    return new Ratio(dividir({ dividendo: this.nucleo, divisor: divisor.nucleo, escala, contexto: 'Ratio.dividedBy' }));
  }

  // --- Comparacion --------------------------------------------------------
  //
  // Misma API que `Money`, y por la misma razon. Ademas tiene consumidor
  // inmediato: los umbrales de food cost del SPEC §11 (objetivo minimo 0.25,
  // umbral verde 0.28, maximo aceptable 0.32) son comparaciones de Ratio.

  public round(escala: Escala): Ratio {
    return new Ratio(redondear(this.nucleo, escala));
  }

  public override valueOf(): never {
    throw new TypeError('Ratio no se convierte a number. Usa toExactString() o los metodos del tipo.');
  }

}

/** Conteo entero no negativo: unidades vendidas, numero de productos activos. */
export class Count extends ValorDecimal {
  private declare readonly [MARCA_COUNT]: 'count';

  /** Sin `verificarEscala`: un entero no puede pasarse de escala. */
  private constructor(valor: Nucleo) {
    super(valor);
  }

  public static readonly CERO: Count = new Count(new D(CERO));

  /**
   * Acepta `number` a proposito, y es la unica excepcion del modulo: un conteo
   * es un entero, y los enteros seguros SI son exactos en punto flotante. Se
   * valida que lo sea.
   */
  public static fromInteger(valor: number): Count {
    if (!Number.isSafeInteger(valor) || valor < 0) throw new ConteoInvalidoError(String(valor));
    return new Count(new D(valor));
  }

  public static fromString(valor: string): Count {
    const nucleo = desdeCadena(valor, 'Count.fromString');
    if (!nucleo.isInteger() || nucleo.isNegative()) throw new ConteoInvalidoError(valor);
    return new Count(nucleo);
  }

  public plus(otro: Count): Count {
    return new Count(this.nucleo.plus(otro.nucleo));
  }


  public override valueOf(): never {
    throw new TypeError('Count no se convierte a number. Usa toExactString() o los metodos del tipo.');
  }
}

/**
 * Una cantidad de un item, con su unidad de uso pegada.
 *
 * La unidad no es decoracion: es lo que hace que `1 kg + 1 unid` sea un error
 * en vez de `2`. El criterio de aceptacion de P2 —"una conversion invalida
 * (kg -> unidades sin factor) se rechaza en el dominio"— descansa sobre esto.
 *
 * `Quantity` esta en P0, y no en P2 con el catalogo, precisamente para que P2
 * no tenga que modelar cantidades sin tipo y retiparlas despues.
 */
export class Quantity extends ValorDecimal {
  private declare readonly [MARCA_QUANTITY]: 'quantity';

  readonly #unidad: UnidadDeUso;

  private constructor(valor: Nucleo, unidad: UnidadDeUso) {
    super(verificarEscala(valor));
    this.#unidad = unidad;
  }

  public get unidad(): UnidadDeUso {
    return this.#unidad;
  }

  /**
   * El gancho de `ValorDecimal`: aqui comparar EXIGE la misma unidad.
   *
   * Sin esto, heredar la comparacion habria dejado `1 kg > 500 unid`
   * respondiendo en silencio. Toda la API comparativa pasa por aqui.
   */
  protected override exigirComparable(otro: Quantity): Nucleo {
    exigirMismaUnidad(this.#unidad, otro.#unidad, 'comparar');
    return otro.nucleo;
  }

  public static cero(unidad: UnidadDeUso): Quantity {
    return new Quantity(new D(CERO), unidad);
  }

  public static of(valor: string, unidad: UnidadDeUso): Quantity {
    return new Quantity(desdeCadena(valor, 'Quantity.of'), unidad);
  }

  public static fromDatabase(valor: string, unidad: UnidadDeUso): Quantity {
    return new Quantity(desdeCadena(valor, 'Quantity.fromDatabase'), unidad);
  }

  /** Todas deben compartir unidad; la lista vacia necesita saber cual es. */
  public static sum(valores: readonly Quantity[], unidad: UnidadDeUso): Quantity {
    return valores.reduce((acumulado, actual) => acumulado.plus(actual), Quantity.cero(unidad));
  }

  public plus(otro: Quantity): Quantity {
    const unidad = exigirMismaUnidad(this.#unidad, otro.#unidad, 'sumar');
    return new Quantity(this.nucleo.plus(otro.nucleo), unidad);
  }

  public minus(otro: Quantity): Quantity {
    const unidad = exigirMismaUnidad(this.#unidad, otro.#unidad, 'restar');
    return new Quantity(this.nucleo.minus(otro.nucleo), unidad);
  }

  /** Escalar adimensional: la unidad no cambia. */
  public timesScalar(factor: Ratio | Count): Quantity {
    return new Quantity(this.nucleo.times(factor.nucleo), this.#unidad);
  }

  public dividedByScalar(divisor: Ratio | Count, escala: Escala): Quantity {
    return new Quantity(
      dividir({
        dividendo: this.nucleo,
        divisor: divisor.nucleo,
        escala,
        contexto: 'Quantity.dividedByScalar',
      }),
      this.#unidad,
    );
  }

  /** Cantidad entre cantidad de la MISMA unidad: las unidades se cancelan. */
  public ratioTo(otro: Quantity, escala: Escala = DIVISION): Ratio {
    exigirMismaUnidad(this.#unidad, otro.#unidad, 'dividir');
    return Ratio.desdeNucleo(
      dividir({
        dividendo: this.nucleo,
        divisor: otro.nucleo,
        escala,
        contexto: 'Quantity.ratioTo',
      }),
    );
  }

  /**
   * La magnitud SIN su unidad, para multiplicar un costo por unidad de uso.
   *
   * ES EL UNICO AGUJERO DELIBERADO DE LA DISCIPLINA DE UNIDADES, y conviene
   * saber por que existe. La tabla de P0 preveia un tipo `UnitCost` que
   * heredara la unidad, de modo que `Money / Quantity` diera `$/kg` y
   * `UnitCost x Quantity` volviera a dar `Money` comprobando la unidad. Ese
   * tipo nunca se construyo: P3 modelo `costo_neto_uso` como `Money` a secas y
   * P5 levanto el motor de costeo entero encima. Introducirlo ahora obligaria
   * a retipar `costing/domain`, que es el codigo donde un error no se ve en
   * pantalla — el riesgo no guarda ninguna proporcion con la mejora.
   *
   * Asi que la conversion se hace explicita, con nombre, y en un solo sitio:
   * quien la llama esta declarando que el `Money` que va a multiplicar ya esta
   * expresado POR UNIDAD DE USO de este mismo item. Un `grep magnitude(`
   * devuelve la lista completa de sitios donde eso se afirma.
   *
   * Devuelve `Ratio` y no `Count` porque una cantidad no es un entero: 2,5 kg
   * es una cantidad perfectamente normal y `Count` la rechazaria.
   */
  public magnitude(): Ratio {
    return Ratio.desdeNucleo(this.nucleo);
  }

  public negated(): Quantity {
    return new Quantity(this.nucleo.negated(), this.#unidad);
  }

  public abs(): Quantity {
    return new Quantity(this.nucleo.abs(), this.#unidad);
  }

  /**
   * NO lanza si las unidades difieren: devuelve `false`.
   *
   * Es la unica de la familia que se aparta de `compare`, y a proposito.
   * «¿son iguales?» tiene respuesta cuando las unidades no coinciden —no lo
   * son— mientras que «¿cual es mayor?» no la tiene. Preguntar por igualdad
   * entre magnitudes distintas es legitimo; ordenarlas no.
   */
  public override equals(otro: Quantity): boolean {
    return this.#unidad === otro.#unidad && this.nucleo.equals(otro.nucleo);
  }

  public override toJSON(): string {
    return `${this.toExactString()} ${this.#unidad}`;
  }

  public override valueOf(): never {
    throw new TypeError(
      'Quantity no se convierte a number: perderia la unidad y la exactitud a la vez. ' +
        'Usa los metodos del tipo, o toStorageString() para persistirla.',
    );
  }
}
