/**
 * Sustituye el contenido de los comentarios por espacios, conservando la
 * longitud y los saltos de linea.
 *
 * POR QUE EXISTE. Casi todas las reglas de `audit:forbidden` son sobre CODIGO,
 * y la prosa que explica una regla contiene por necesidad lo que la regla
 * prohibe: el comentario que documenta por que no se usan literales decimales
 * escribe literales decimales. Sin esto, el escaner se acusa a si mismo, y la
 * reaccion natural seria debilitar la regla o dejar de comentar. Las dos son
 * peores que el problema.
 *
 * Se sustituye en vez de borrar para que los numeros de linea y de columna del
 * informe sigan apuntando al sitio correcto.
 *
 * Las reglas de DIRECTIVAS (`@ts-ignore`, `eslint-disable`, `@ts-expect-error`)
 * son la excepcion: viven en comentarios por definicion, y se declaran con
 * `analiza: 'todo'` para saltarse este paso.
 *
 * Las cadenas y los template literals NO se tocan: hay reglas que buscan
 * precisamente dentro de ellos (SQL interpolado).
 */

const BARRA = 47; //  /
const ASTERISCO = 42; //  *
const COMILLA_SIMPLE = 39; //  '
const COMILLA_DOBLE = 34; //  "
const ACENTO_GRAVE = 96; //  `
const CONTRABARRA = 92; //  \
const SALTO = 10; //  \n
const GUION = 45; //  -

/** @param {string} texto @param {number} desde @param {number} hasta */
function enmascarar(texto, desde, hasta) {
  let mascara = '';
  for (let i = desde; i < hasta; i += 1) {
    mascara += texto.charCodeAt(i) === SALTO ? '\n' : ' ';
  }
  return mascara;
}

/**
 * Recorre el texto con un automata minimo: codigo, comentario de linea,
 * comentario de bloque y las tres formas de cadena.
 *
 * @param {string} texto
 * @param {{lineaCon: number[], bloque: boolean, cadenas: 'conservar' | 'enmascarar'}} sintaxis
 * @returns {string}
 */
function despojar(texto, sintaxis) {
  let salida = '';
  let i = 0;

  while (i < texto.length) {
    const tramo = leerTramo(texto, i, sintaxis);
    salida += tramo.salida;
    i = tramo.fin;
  }

  return salida;
}

/** @typedef {{salida: string, fin: number}} Tramo */

/**
 * Clasifica lo que empieza en `i` y devuelve su transformacion y donde acaba.
 *
 * @param {string} texto
 * @param {number} i
 * @param {{lineaCon: number[], bloque: boolean, cadenas: 'conservar' | 'enmascarar'}} sintaxis
 * @returns {Tramo}
 */
function leerTramo(texto, i, sintaxis) {
  const actual = texto.charCodeAt(i);
  const siguiente = texto.charCodeAt(i + 1);

  if (abreComentarioDeLinea(actual, siguiente, sintaxis)) {
    return enmascararHasta(texto, i, indiceOFinal(texto.indexOf('\n', i), texto));
  }

  if (abreComentarioDeBloque(actual, siguiente, sintaxis)) {
    const cierre = texto.indexOf('*/', i + 2);
    return enmascararHasta(texto, i, cierre === -1 ? texto.length : cierre + 2);
  }

  if (abreCadena(actual)) {
    return leerCadena(texto, i, { delimitador: actual, modo: sintaxis.cadenas });
  }

  return { salida: texto.charAt(i), fin: i + 1 };
}

/** @param {number} indice @param {string} texto */
function indiceOFinal(indice, texto) {
  return indice === -1 ? texto.length : indice;
}

/**
 * @param {number} actual
 * @param {number} siguiente
 * @param {{lineaCon: number[]}} sintaxis
 */
function abreComentarioDeLinea(actual, siguiente, sintaxis) {
  return sintaxis.lineaCon.includes(actual) && siguiente === actual;
}

/**
 * @param {number} actual
 * @param {number} siguiente
 * @param {{bloque: boolean}} sintaxis
 */
function abreComentarioDeBloque(actual, siguiente, sintaxis) {
  return sintaxis.bloque && actual === BARRA && siguiente === ASTERISCO;
}

/** @param {number} codigo */
function abreCadena(codigo) {
  return codigo === COMILLA_SIMPLE || codigo === COMILLA_DOBLE || codigo === ACENTO_GRAVE;
}

/**
 * @param {string} texto
 * @param {number} i
 * @param {number} fin
 * @returns {Tramo}
 */
function enmascararHasta(texto, i, fin) {
  return { salida: enmascarar(texto, i, fin), fin };
}

/**
 * Se conserva el contenido de la cadena salvo que se pida lo contrario: hay
 * reglas que buscan precisamente dentro de una (SQL interpolado). Pero para
 * "sin literales decimales en domain" hay que enmascararla: un decimal dentro
 * de una cadena es exactamente la forma PRESCRITA de escribirlo.
 *
 * @param {string} texto
 * @param {number} i
 * @param {{delimitador: number, modo: 'conservar' | 'enmascarar'}} opciones
 * @returns {Tramo}
 */
function leerCadena(texto, i, opciones) {
  const fin = finDeCadena(texto, i, opciones.delimitador);
  if (opciones.modo !== 'enmascarar') return { salida: texto.slice(i, fin), fin };
  return { salida: texto.charAt(i) + enmascarar(texto, i + 1, fin), fin };
}

/**
 * @param {string} texto
 * @param {number} inicio indice de la comilla de apertura
 * @param {number} delimitador
 * @returns {number} indice justo despues de la comilla de cierre
 */
function finDeCadena(texto, inicio, delimitador) {
  let i = inicio + 1;
  while (i < texto.length) {
    const codigo = texto.charCodeAt(i);
    if (codigo === CONTRABARRA) {
      i += 2;
      continue;
    }
    if (codigo === delimitador) return i + 1;
    // Una cadena con comillas rectas no cruza lineas; el template si.
    if (codigo === SALTO && delimitador !== ACENTO_GRAVE) return i;
    i += 1;
  }
  return texto.length;
}

const ES_JS = /\.(ts|tsx|mts|cts|js|mjs|cjs)$/;
const ES_SQL = /\.sql$/;

/**
 * Elige el despojador segun la extension. Un formato desconocido se devuelve
 * intacto: es preferible un falso positivo, que se ve, a un falso negativo.
 *
 * @param {string} ruta
 * @param {string} contenido
 * @param {'conservar' | 'enmascarar'} [cadenas]
 */
function limpiar(ruta, contenido, cadenas = 'conservar') {
  if (ES_JS.test(ruta)) return despojar(contenido, { lineaCon: [BARRA], bloque: true, cadenas });
  if (ES_SQL.test(ruta)) return despojar(contenido, { lineaCon: [GUION], bloque: true, cadenas });
  return contenido;
}

/**
 * Enmascara solo los comentarios.
 * @param {string} ruta
 * @param {string} contenido
 */
export function sinComentarios(ruta, contenido) {
  return limpiar(ruta, contenido, 'conservar');
}

/**
 * Enmascara comentarios y ademas el contenido de las cadenas.
 * @param {string} ruta
 * @param {string} contenido
 */
export function sinComentariosNiCadenas(ruta, contenido) {
  return limpiar(ruta, contenido, 'enmascarar');
}
