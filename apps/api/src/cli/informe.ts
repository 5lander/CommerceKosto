/**
 * Lo que el operador ve en su terminal.
 *
 * **NO SE USA `console`**: la regla `no-console` de este proyecto vale también
 * aquí, y no por dogma — la aplicación registra por el logger estructurado. La
 * salida de un comando es otra cosa: es su interfaz, y va por `stdout` a pelo,
 * sin que ningún formateador decida por medio.
 *
 * **LOS PROBLEMAS SE ENSEÑAN CON SU FILA Y SU COLUMNA.** Es la diferencia entre
 * un informe que sirve y uno que obliga a abrir el archivo y contar líneas.
 */

import type { Analisis } from '../modules/imports/domain/analisis';

/** Cuántas filas con problema se listan antes de resumir el resto. */
const PROBLEMAS_VISIBLES = 25;

export function escribir(linea: string): void {
  process.stdout.write(`${linea}\n`);
}

export function imprimirAnalisis(analisis: Analisis, nombre: string): void {
  escribir('');
  escribir(`Archivo:  ${nombre}`);
  escribir(`Tipo:     ${analisis.tipo}`);
  escribir(`Filas:    ${String(analisis.total)}  ·  válidas ${String(analisis.validas.length)}  ·  con problema ${String(analisis.problemas.length)}`);

  if (analisis.columnasIgnoradas.length > 0) {
    escribir(`Columnas ignoradas: ${analisis.columnasIgnoradas.join(', ')}`);
  }

  imprimirProblemas(analisis);
}

function imprimirProblemas(analisis: Analisis): void {
  if (analisis.problemas.length === 0) return;

  escribir('');
  escribir('Problemas:');

  for (const problema of analisis.problemas.slice(0, PROBLEMAS_VISIBLES)) {
    const donde = problema.columna === null ? '' : ` [${problema.columna}]`;
    escribir(`  fila ${String(problema.fila)}${donde}: ${problema.motivo}`);
  }

  const ocultos = analisis.problemas.length - PROBLEMAS_VISIBLES;
  if (ocultos > 0) escribir(`  … y ${String(ocultos)} más.`);
}

export function imprimirDesenlace(filasEscritas: number | null): void {
  escribir('');

  if (filasEscritas === null) {
    escribir('No se escribió nada. Añade --confirmar cuando el informe te cuadre.');
    return;
  }
  escribir(`Escritas ${String(filasEscritas)} fila(s).`);
}
