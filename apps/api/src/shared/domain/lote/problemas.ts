/**
 * Lo que cuatro módulos necesitan decir igual cuando validan un LOTE.
 *
 * `catalog`, `pricing`, `recipes` e `inventory` reciben lotes desde P10 y los
 * cuatro tienen que responder lo mismo: en qué posición está el problema, cómo
 * se compara un nombre con otro, y cómo se resume una lista de problemas en un
 * mensaje que quepa en una terminal. Escrito cuatro veces sería cuatro clones
 * que `audit:duplication` para, y —peor— cuatro sitios donde la posición podría
 * empezar a contarse distinto.
 *
 * NO ES UNA ABSTRACCIÓN ESPECULATIVA (OPTIMIZACION.md §1): son cuatro usos
 * reales en el mismo paquete, no uno con la esperanza de un segundo.
 *
 * ES DOMINIO PURO.
 */

/** La posición que se le enseña a una persona empieza en 1, no en 0. */
export const PRIMERA_POSICION = 1;

/** Cuántos problemas caben en el mensaje antes de resumir el resto. */
const PROBLEMAS_EN_EL_MENSAJE = 10;

export interface ProblemaDelLote {
  /** Posición dentro del lote, empezando en 1. */
  readonly posicion: number;
  readonly motivo: string;
}

/**
 * La clave con la que se comparan dos nombres dentro de un mismo lote.
 *
 * **Más estricta que el índice único de la base**, que compara byte a byte.
 * «Tomate» y «tomate » son la misma cosa escrita dos veces, y dejarlas pasar
 * crea dos filas que luego nadie sabe cuál usar. Es el mismo razonamiento —y a
 * propósito, la misma forma— que `exigirCostosValidos` en `analytics`.
 */
export function clavePorNombre(nombre: string): string {
  return nombre.trim().toLocaleLowerCase();
}

export function mensajeDeRepetido(nombre: string, posicion: number): string {
  return `«${nombre.trim()}» ya aparece en la posición ${String(posicion)} de este mismo archivo.`;
}

/**
 * Resume los problemas en un mensaje.
 *
 * **Se enseñan los diez primeros y se cuenta el resto.** Un archivo recién
 * exportado puede traer doscientos problemas de la misma clase —una columna mal
 * mapeada los produce todos—, y volcarlos enteros en un `Error` no ayuda a
 * nadie: los diez primeros ya dicen cuál es el patrón. El detalle completo vive
 * en el análisis, que es donde se puede leer con calma.
 */
export function mensajeDeProblemas(problemas: readonly ProblemaDelLote[]): string {
  const visibles = problemas
    .slice(0, PROBLEMAS_EN_EL_MENSAJE)
    .map((p) => `fila ${String(p.posicion)}: ${p.motivo}`);

  const ocultos = problemas.length - visibles.length;
  const resto = ocultos > 0 ? [`y ${String(ocultos)} problema(s) más`] : [];

  return [`El archivo tiene ${String(problemas.length)} problema(s):`, ...visibles, ...resto].join(
    '\n  ',
  );
}

/** Los nombres, sin repetir y sin espacios de sobra, en el orden en que llegaron. */
export function nombresUnicos(nombres: readonly string[]): readonly string[] {
  return [...new Set(nombres.map((n) => n.trim()))];
}

/**
 * Los nombres del lote que YA existen, comparados con `clavePorNombre`.
 *
 * Lo usan los repositorios para poder decir CUALES chocan. Dejar que lo
 * descubra el indice unico daria un `P2002` que solo nombra la restriccion, y
 * quien migra doscientas filas necesita la lista.
 */
export function nombresQueChocan(
  entrantes: readonly string[],
  existentes: readonly string[],
): readonly string[] {
  const ya = new Set(existentes.map(clavePorNombre));
  return nombresUnicos(entrantes.filter((nombre) => ya.has(clavePorNombre(nombre))));
}
