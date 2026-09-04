/**
 * El factor de conversión de un artículo de compra — SPEC §5 y §12.
 *
 * QUÉ ES EXACTAMENTE. Cuántas unidades **de uso** salen de UN artículo de
 * compra. Es el divisor de la fórmula del costo del insumo:
 *
 *   costo_bruto_uso = factor_conversion = 0 ? 0 : precio_neto / factor_conversion
 *
 * Un saco de 2 kg de harina, con la harina medida en gramos, tiene factor 2000.
 *
 * ES EL CRITERIO DE ACEPTACIÓN DE P2: «una conversión inválida (kg → unidades
 * sin factor) se rechaza **en el dominio**». Aquí está, y sin base de datos.
 *
 * LA REGLA, EN UNA FRASE: si la presentación y la unidad de uso comparten
 * dimensión, el factor **se deriva** y dar uno explícito es un error; si no la
 * comparten, el factor **es obligatorio** porque no hay física que lo deduzca.
 *
 * POR QUÉ RECHAZAR UN FACTOR EXPLÍCITO CUANDO ES DERIVABLE, en vez de
 * ignorarlo o de dejar que gane. Porque un saco de 2 kg con «factor 1500»
 * escrito a mano produce un costo por gramo un 33 % más alto, y nada en la
 * pantalla lo delata: el número es plausible. Lo que se puede calcular no se
 * captura. Un dato capturado que contradice a la física es un error de captura,
 * y se dice.
 *
 * ES DOMINIO PURO: entran valores, sale un `Ratio` o un error tipado.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import { Quantity, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import type { UnidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';

/**
 * Las tres magnitudes del catálogo. Dos unidades se convierten entre sí sin
 * factor explícito **solo** si comparten dimensión.
 */
export type Dimension = 'MASA' | 'VOLUMEN' | 'CONTEO';

export interface UnidadDelCatalogo {
  readonly codigo: UnidadDeUso;
  readonly dimension: Dimension;
  /** Cuántas unidades base de su dimensión hay en una de estas. */
  readonly factorABase: Ratio;
}

export type ProblemaDeConversion =
  | {
      readonly clase: 'falta_factor';
      readonly compra: string;
      readonly uso: string;
    }
  | {
      readonly clase: 'factor_de_mas';
      readonly compra: string;
      readonly uso: string;
    }
  | { readonly clase: 'factor_no_positivo' }
  | { readonly clase: 'presentacion_no_positiva' }
  | {
      readonly clase: 'presentacion_en_otra_unidad';
      readonly esperada: string;
      readonly recibida: string;
    };

export interface EntradaDeConversion {
  /** La presentación del artículo: «2 kg», «900 ml», «6 unid». */
  readonly presentacion: Quantity;
  readonly unidadDeCompra: UnidadDelCatalogo;
  readonly unidadDeUso: UnidadDelCatalogo;
  /**
   * Cuántas unidades de uso salen de **una** unidad de compra. Obligatorio
   * cuando las dimensiones difieren —«un huevo pesa 50 g»— y prohibido cuando
   * no, porque entonces lo dice la física.
   */
  readonly factorExplicito: Ratio | null;
}

/** @returns `null` si la conversión es válida. */
export function problemaDeConversion(entrada: EntradaDeConversion): ProblemaDeConversion | null {
  const { presentacion, unidadDeCompra, unidadDeUso, factorExplicito } = entrada;

  if (presentacion.unidad !== unidadDeCompra.codigo) {
    return {
      clase: 'presentacion_en_otra_unidad',
      esperada: unidadDeCompra.codigo,
      recibida: presentacion.unidad,
    };
  }

  if (!presentacion.isPositive()) {
    return { clase: 'presentacion_no_positiva' };
  }

  const mismaDimension = unidadDeCompra.dimension === unidadDeUso.dimension;

  if (mismaDimension && factorExplicito !== null) {
    return { clase: 'factor_de_mas', compra: unidadDeCompra.codigo, uso: unidadDeUso.codigo };
  }

  if (!mismaDimension && factorExplicito === null) {
    return { clase: 'falta_factor', compra: unidadDeCompra.codigo, uso: unidadDeUso.codigo };
  }

  if (factorExplicito !== null && !factorExplicito.isPositive()) {
    return { clase: 'factor_no_positivo' };
  }

  return null;
}

export class ConversionInvalidaError extends Error {
  public override readonly name = 'ConversionInvalidaError';

  public constructor(public readonly problema: ProblemaDeConversion) {
    super(mensajeDelProblemaDeConversion(problema));
  }
}

/**
 * @returns cuántas unidades de uso salen de un artículo de compra.
 * @throws {ConversionInvalidaError}
 */
export function factorDeConversion(entrada: EntradaDeConversion): Ratio {
  const problema = problemaDeConversion(entrada);
  if (problema !== null) {
    throw new ConversionInvalidaError(problema);
  }

  const { presentacion, unidadDeCompra, unidadDeUso, factorExplicito } = entrada;

  // La presentación, ya sin unidad: «2 kg» dividido por «1 kg» es 2. Se hace
  // así y no leyendo el decimal a pelo porque `ratioTo` exige que las unidades
  // coincidan, de modo que el compilador y el dominio siguen custodiando el
  // valor hasta el último paso.
  const cuantas = presentacion.ratioTo(Quantity.of('1', presentacion.unidad));

  const porUnidadDeCompra =
    factorExplicito ?? unidadDeCompra.factorABase.dividedBy(unidadDeUso.factorABase, DIVISION);

  return cuantas.times(porUnidadDeCompra);
}

const MENSAJES: Readonly<Record<ProblemaDeConversion['clase'], string>> = {
  falta_factor:
    'Hace falta decir cuántas unidades de uso salen de una unidad de compra: no hay forma de deducirlo.',
  factor_de_mas: 'El factor se calcula solo entre estas dos unidades: no se captura.',
  factor_no_positivo: 'El factor de conversión tiene que ser mayor que cero.',
  presentacion_no_positiva: 'La presentación tiene que ser mayor que cero.',
  presentacion_en_otra_unidad: 'La presentación no está en la unidad de compra declarada.',
};

export function mensajeDelProblemaDeConversion(problema: ProblemaDeConversion): string {
  const base = MENSAJES[problema.clase];

  if (problema.clase === 'falta_factor' || problema.clase === 'factor_de_mas') {
    return `${base} (compra en "${problema.compra}", uso en "${problema.uso}")`;
  }
  if (problema.clase === 'presentacion_en_otra_unidad') {
    return `${base} Se esperaba "${problema.esperada}" y llegó "${problema.recibida}".`;
  }
  return base;
}
