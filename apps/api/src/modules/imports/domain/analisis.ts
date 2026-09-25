/**
 * El análisis de un archivo: qué filas valen, cuáles no y por qué.
 *
 * ES LA ETAPA QUE EL SPEC §10 EXIGE ANTES DE ESCRIBIR NADA, y su forma la fija
 * el criterio de aceptación de P10: «un archivo con una fila inválida en la
 * posición 150 no escribe ninguna de las 149 anteriores». Para eso el análisis
 * es **total**: se recorren todas las filas y se recogen todos los problemas,
 * no se corta en el primero.
 *
 * **POR QUE SE SIGUE ANALIZANDO DESPUES DEL PRIMER ERROR.** Cortar sería más
 * rápido y convertiría la importación en un juego de veinte preguntas: arreglas
 * la fila 12, vuelves a subir, ahora falla la 30. Con doscientos ítems eso es
 * abandonar. El usuario tiene que ver **todos** los problemas de una vez.
 *
 * **EL NUMERO DE FILA ES EL DEL ARCHIVO, no el del array.** Se cuenta desde 1 y
 * la cabecera ocupa la 1, así que la primera fila de datos es la 2 — que es lo
 * que el usuario ve en Excel cuando va a corregirla. Un «error en la fila 149»
 * que en Excel es la 151 es peor que no decir nada.
 *
 * ES DOMINIO PURO. Entran celdas de texto, sale el veredicto.
 */

import { leerCabecera, type Cabecera, type Columna } from './columnas';

export type TipoDeImportacion =
  | 'ITEMS'
  | 'ARTICULOS'
  | 'PRECIOS'
  | 'PRODUCTOS'
  | 'RECETAS'
  | 'MOVIMIENTOS';

export interface ProblemaDeFila {
  /** El número que el usuario ve en su hoja de cálculo. */
  readonly fila: number;
  /** La columna culpable, o `null` si el problema es de la fila entera. */
  readonly columna: string | null;
  readonly motivo: string;
}

/** Una fila que pasó la validación, con sus valores ya en claro. */
export interface FilaValida {
  readonly fila: number;
  readonly valores: Readonly<Record<string, string>>;
}

export interface Analisis {
  readonly tipo: TipoDeImportacion;
  /** Filas de datos leídas, sin contar la cabecera. */
  readonly total: number;
  readonly validas: readonly FilaValida[];
  readonly problemas: readonly ProblemaDeFila[];
  readonly columnasIgnoradas: readonly string[];
}

/**
 * El contrato que cada tipo de importación cumple.
 *
 * Un descriptor por tipo, y el motor de abajo es el mismo para los cinco. Sin
 * esto, «importar ítems» y «importar recetas» serían dos programas parecidos y
 * cada arreglo habría que hacerlo cinco veces.
 */
export interface Descriptor {
  readonly tipo: TipoDeImportacion;
  readonly columnas: readonly Columna[];
  /**
   * Valida una fila y devuelve sus problemas. Lista vacía = fila buena.
   *
   * Devuelve **todos** los problemas de la fila, no el primero: si faltan la
   * unidad y el precio, se dicen los dos.
   */
  readonly validar: (fila: readonly string[], cabecera: Cabecera) => readonly ProblemaDeFilaCruda[];
  /** Los valores que se guardan de una fila buena. */
  readonly extraer: (fila: readonly string[], cabecera: Cabecera) => Readonly<Record<string, string>>;
}

/** Un problema visto por el validador, todavía sin número de fila. */
export interface ProblemaDeFilaCruda {
  readonly columna: string | null;
  readonly motivo: string;
}

/** La cabecera ocupa la fila 1. */
const PRIMERA_FILA_DE_DATOS = 2;

export interface ProblemaDeCabecera {
  readonly faltantes: readonly string[];
}

/**
 * Analiza un archivo ya convertido en filas de texto.
 *
 * @throws nunca. Un archivo malo produce un análisis con problemas, no una
 *   excepción: la previsualización tiene que poder enseñarlos.
 */
export function analizar(
  filas: readonly (readonly string[])[],
  descriptor: Descriptor,
): Analisis | ProblemaDeCabecera {
  const encabezados = filas[0] ?? [];
  const cabecera = leerCabecera(encabezados, descriptor.columnas);

  // SIN LAS COLUMNAS OBLIGATORIAS NO SE ANALIZA NADA. Validar fila a fila un
  // archivo al que le falta la columna del nombre produciria mil errores
  // identicos y ni uno util.
  if (cabecera.faltantes.length > 0) return { faltantes: cabecera.faltantes };

  const datos = filas.slice(1);
  const validas: FilaValida[] = [];
  const problemas: ProblemaDeFila[] = [];
  let total = 0;

  datos.forEach((fila, indice) => {
    // Las filas en blanco del final son basura de Excel, no errores: quien
    // selecciona hasta la fila 5.000 arrastra cuatro mil vacias.
    if (fila.every((celda) => celda.trim() === '')) return;

    total += 1;
    const numero = indice + PRIMERA_FILA_DE_DATOS;
    const encontrados = descriptor.validar(fila, cabecera);

    if (encontrados.length === 0) {
      validas.push({ fila: numero, valores: descriptor.extraer(fila, cabecera) });
      return;
    }

    for (const problema of encontrados) {
      problemas.push({ fila: numero, ...problema });
    }
  });

  return {
    tipo: descriptor.tipo,
    total,
    validas,
    problemas,
    columnasIgnoradas: cabecera.ignoradas,
  };
}

/** ¿El análisis se pudo hacer, o faltaban columnas? */
export function esAnalisis(
  resultado: Analisis | ProblemaDeCabecera,
): resultado is Analisis {
  return 'tipo' in resultado;
}
