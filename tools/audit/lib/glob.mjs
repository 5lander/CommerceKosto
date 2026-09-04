/**
 * Conversion minima de glob a expresion regular.
 *
 * Se escribe a mano en vez de traer `minimatch` porque hacen falta cuatro
 * comodines y nada mas (CLAUDE.md §3: no traer una dependencia para 10 lineas).
 *
 * Soporta:
 *   **     cualquier numero de segmentos, incluido ninguno
 *   *      cualquier cosa dentro de un segmento
 *   ?      un caracter dentro de un segmento
 *   {a,b}  alternativa
 *
 * TODA ruta se normaliza a separadores `/` antes de comparar. En Windows,
 * comparar con `\` hace que ningun patron case y las reglas pasen en verde sin
 * haber examinado un solo archivo: un fallo silencioso, el peor de todos.
 */

const SPECIAL = /[.+^$()|[\]]/g;

/** @typedef {{fuente: string, consumido: number}} Token */

/** @param {string} filePath */
export function normalizePath(filePath) {
  return filePath.split('\\').join('/');
}

/** @param {string} texto */
function escapar(texto) {
  return texto.replace(SPECIAL, '\\$&');
}

/**
 * `{a,b,c}` -> `(?:a|b|c)`. Devuelve null si la llave no se cierra, en cuyo
 * caso la llave se trata como un caracter literal.
 * @param {string} pattern
 * @param {number} index
 * @returns {Token | null}
 */
function leerAlternativa(pattern, index) {
  const fin = pattern.indexOf('}', index);
  if (fin === -1) return null;

  const opciones = pattern.slice(index + 1, fin).split(',').map(escapar);
  return { fuente: `(?:${opciones.join('|')})`, consumido: fin + 1 - index };
}

/**
 * `**` y `*`. El caso `a/**{@literal /}b` debe casar tambien `a/b`, asi que se
 * consume la barra siguiente y se hace opcional el grupo entero.
 * @param {string} pattern
 * @param {number} index
 * @returns {Token}
 */
function leerAsterisco(pattern, index) {
  const esGlobstar = pattern[index + 1] === '*';
  if (!esGlobstar) return { fuente: '[^/]*', consumido: 1 };
  if (pattern[index + 2] === '/') return { fuente: '(?:.*/)?', consumido: 3 };
  return { fuente: '.*', consumido: 2 };
}

/**
 * @param {string} pattern
 * @param {number} index
 * @returns {Token}
 */
function leerToken(pattern, index) {
  const char = pattern[index];
  if (char === undefined) return { fuente: '', consumido: 1 };
  if (char === '{') return leerAlternativa(pattern, index) ?? { fuente: '\\{', consumido: 1 };
  if (char === '*') return leerAsterisco(pattern, index);
  if (char === '?') return { fuente: '[^/]', consumido: 1 };
  return { fuente: escapar(char), consumido: 1 };
}

/** @param {string} pattern */
function globToRegExpSource(pattern) {
  let source = '';
  let index = 0;

  while (index < pattern.length) {
    const { fuente, consumido } = leerToken(pattern, index);
    source += fuente;
    index += consumido;
  }

  return source;
}

/** @param {string} pattern */
export function globToRegExp(pattern) {
  return new RegExp(`^${globToRegExpSource(pattern)}$`);
}

/**
 * @param {string} filePath
 * @param {readonly string[]} patterns
 */
export function matchesAny(filePath, patterns) {
  const normalized = normalizePath(filePath);
  return patterns.some((pattern) => globToRegExp(pattern).test(normalized));
}
