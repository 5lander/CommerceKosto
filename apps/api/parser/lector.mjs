/**
 * El lector de hojas de cálculo — **JavaScript plano, y a propósito.**
 *
 * POR QUE ESTE ARCHIVO NO ES TYPESCRIPT. Corre en un PROCESO APARTE
 * (SEGURIDAD.md §5.4), y un proceso aparte tiene que poder arrancar tanto desde
 * el fuente como desde `dist/`. El paquete es CommonJS con imports sin
 * extensión, y Node exige extensión explícita para ejecutar TypeScript como
 * ESM: `node hijo.ts` falla desde el fuente. Se comprobó.
 *
 * Las salidas eran tres: pasar todo el paquete a ESM (no es trabajo de P10),
 * exigir un `build` antes de las pruebas (un check que depende de un paso que
 * alguien olvidará), o escribir esta parte en JavaScript plano. Es lo tercero,
 * con `lector.d.mts` al lado para que quien lo use desde TypeScript siga
 * teniendo tipos. Ver ADR-013.
 *
 * VIVE FUERA DE `src/` para que `tsc` no intente compilarlo y para que la ruta
 * sea la misma en desarrollo y en producción — `dist/` refleja `src/`, así que
 * cualquier cosa dentro de `src` tendría que copiarse a mano al construir.
 *
 * NO IMPORTA NADA. Solo módulos de Node. Es el archivo que abre la entrada
 * hostil: cuanto menos cargue, menos hay que pueda salir mal.
 */

import { inflateRawSync } from 'node:zlib';

// --- lo que se admite -------------------------------------------------------

/** `PK` + 0x03 + 0x04, sin meter bytes de control en el codigo fuente. */
const FIRMA_ZIP = Buffer.from(`PK${String.fromCharCode(3, 4)}`, 'latin1');

/** El caracter de reemplazo que produce una secuencia UTF-8 invalida. */
const REEMPLAZO = String.fromCharCode(0xfffd);
const MUESTRA = 4096;

/**
 * Un error cuyo mensaje SE PUEDE ENSEÑAR AL USUARIO.
 *
 * La marca existe porque el padre no puede distinguir de otro modo un «tu
 * archivo se expande demasiado» —escrito para leerse— de un fallo interno, que
 * no se publica. Sin ella habria que enseñarlo todo o no enseñar nada.
 */
export class ErrorDeLectura extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeLectura';
    this.publico = true;
  }
}

// --- ZIP --------------------------------------------------------------------

const FIRMA_LOCAL = 0x04034b50;
const FIRMA_CENTRAL = 0x02014b50;
const FIRMA_FIN_CENTRAL = 0x06054b50;

const SIN_COMPRIMIR = 0;
const DEFLATE = 8;

const LARGO_FIN_CENTRAL = 22;
const COMENTARIO_MAXIMO = 0xffff;

const FIN = { entradas: 10, desplazamientoDelIndice: 16 };
const CENTRAL = {
  metodo: 10,
  tamanoComprimido: 20,
  tamanoDescomprimido: 24,
  largoNombre: 28,
  largoExtra: 30,
  largoComentario: 32,
  desplazamientoLocal: 42,
  cabecera: 46,
};
const LOCAL = { largoNombre: 26, largoExtra: 28, cabecera: 30 };

/**
 * Abre el ZIP y devuelve solo las entradas pedidas, ya descomprimidas.
 *
 * **EL TOPE ES LA IMPLEMENTACION, no un parche encima.** Un `.xlsx` subido por
 * un usuario es entrada hostil y el vector clasico es la zip bomb: doscientos
 * kilobytes que se expanden a cuatro gigas. Aqui cada entrada se inflama contra
 * un presupuesto, y `maxOutputLength` corta la expansion DENTRO de zlib — sin
 * el, la bomba reservaria los gigas antes de que nadie pudiera medirla.
 *
 * No admite ZIP64, cifrado ni volumenes partidos: un `.xlsx` normal no los usa.
 */
export function leerEntradas(bytes, queridas, limites) {
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const finCentral = buscarFinDelCentral(bytes, vista);

  const entradas = vista.getUint16(finCentral + FIN.entradas, true);
  if (entradas > limites.entradas) {
    throw new ErrorDeLectura(
      `El archivo trae ${entradas} entradas y el máximo es ${limites.entradas}.`,
    );
  }

  const buscadas = new Set(queridas);
  const resultado = new Map();
  let presupuesto = limites.bytesDescomprimidos;
  let cursor = vista.getUint32(finCentral + FIN.desplazamientoDelIndice, true);

  for (let i = 0; i < entradas; i += 1) {
    if (vista.getUint32(cursor, true) !== FIRMA_CENTRAL) {
      throw new ErrorDeLectura('El directorio del ZIP está corrupto.');
    }

    const cabecera = leerCabeceraCentral(bytes, vista, cursor);
    if (buscadas.has(cabecera.nombre)) {
      const contenido = extraer({ bytes, vista, cabecera, presupuesto });
      presupuesto -= contenido.byteLength;
      resultado.set(cabecera.nombre, contenido);
    }

    cursor = cabecera.siguiente;
  }

  return resultado;
}

function leerCabeceraCentral(bytes, vista, cursor) {
  const largoNombre = vista.getUint16(cursor + CENTRAL.largoNombre, true);
  const largoExtra = vista.getUint16(cursor + CENTRAL.largoExtra, true);
  const largoComentario = vista.getUint16(cursor + CENTRAL.largoComentario, true);
  const inicioNombre = cursor + CENTRAL.cabecera;

  return {
    // `latin1` y no `utf8`: los nombres que se buscan son ASCII puro, y
    // decodificar como UTF-8 un nombre con bytes arbitrarios produciria
    // reemplazos que ya no comparan igual.
    nombre: Buffer.from(bytes.subarray(inicioNombre, inicioNombre + largoNombre)).toString('latin1'),
    metodo: vista.getUint16(cursor + CENTRAL.metodo, true),
    tamanoComprimido: vista.getUint32(cursor + CENTRAL.tamanoComprimido, true),
    tamanoDescomprimido: vista.getUint32(cursor + CENTRAL.tamanoDescomprimido, true),
    desplazamientoLocal: vista.getUint32(cursor + CENTRAL.desplazamientoLocal, true),
    siguiente: inicioNombre + largoNombre + largoExtra + largoComentario,
  };
}

/**
 * **El tamaño declarado no se cree, se comprueba.** El directorio del ZIP dice
 * cuanto ocupa la entrada descomprimida, y una zip bomb miente ahi. Se usa como
 * primer filtro —barato, descarta lo obvio sin inflar nada— y despues se mide
 * lo que realmente salio.
 */
function extraer({ bytes, vista, cabecera, presupuesto }) {
  if (cabecera.tamanoDescomprimido > presupuesto) {
    throw new ErrorDeLectura(`"${cabecera.nombre}" declara más bytes de los permitidos.`);
  }

  const local = cabecera.desplazamientoLocal;
  if (vista.getUint32(local, true) !== FIRMA_LOCAL) {
    throw new ErrorDeLectura('El archivo no es un ZIP válido.');
  }

  const inicio =
    local +
    LOCAL.cabecera +
    vista.getUint16(local + LOCAL.largoNombre, true) +
    vista.getUint16(local + LOCAL.largoExtra, true);
  const crudo = bytes.subarray(inicio, inicio + cabecera.tamanoComprimido);
  const contenido = descomprimir(crudo, cabecera, presupuesto);

  if (contenido.byteLength > presupuesto) {
    throw new ErrorDeLectura(
      `"${cabecera.nombre}" se expande por encima del límite. Posible archivo malicioso.`,
    );
  }

  return contenido;
}

function descomprimir(crudo, cabecera, presupuesto) {
  if (cabecera.metodo === SIN_COMPRIMIR) return crudo;

  if (cabecera.metodo !== DEFLATE) {
    throw new ErrorDeLectura(
      `"${cabecera.nombre}" usa una compresión que este lector no admite. ` +
        'Guarda el archivo como .xlsx normal, sin cifrar.',
    );
  }

  return inflateRawSync(crudo, { maxOutputLength: presupuesto });
}

/**
 * El fin del directorio central va al FINAL del archivo, y puede llevar hasta
 * 64 KB de comentario detras. Por eso se busca hacia atras: no esta en una
 * posicion fija. Es la unica forma de leer un ZIP.
 */
function buscarFinDelCentral(bytes, vista) {
  const minimo = Math.max(0, bytes.byteLength - LARGO_FIN_CENTRAL - COMENTARIO_MAXIMO);

  for (let i = bytes.byteLength - LARGO_FIN_CENTRAL; i >= minimo; i -= 1) {
    if (vista.getUint32(i, true) === FIRMA_FIN_CENTRAL) return i;
  }

  throw new ErrorDeLectura('El archivo no es un .xlsx válido: no se encontró el índice ZIP.');
}

// --- xlsx -------------------------------------------------------------------

const CADENAS = 'xl/sharedStrings.xml';
const HOJA = 'xl/worksheets/sheet1.xml';

/** Las cinco entidades que XML define, y **solo** esas cinco. */
const ENTIDADES = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
]);

const LETRAS = 26;
const BASE_LETRA = 'A'.charCodeAt(0);

/**
 * Lee la primera hoja de un `.xlsx`. Todo sale como TEXTO.
 *
 * LO QUE NO SE HACE, y cada omision es deliberada:
 *
 *   - **No se evaluan formulas.** Se lee el valor cacheado, que es el numero
 *     que el usuario vio. Evaluar la formula de un archivo ajeno es ejecutar
 *     codigo de un desconocido.
 *   - **No se resuelven entidades XML** mas alla de las cinco de arriba: sin
 *     DOCTYPE, sin entidades externas, sin «billion laughs».
 *   - **No se leen macros ni objetos incrustados.** No se abre esa parte.
 *
 * Y todo es `string` porque el dinero de este sistema no pasa por punto
 * flotante (CLAUDE.md §3): devolver `number` metaria `2.0999999999999996` por
 * la puerta de atras, antes de que `Money` pudiera defenderse.
 */
export function leerXlsx(bytes, limites) {
  const partes = leerEntradas(bytes, [CADENAS, HOJA], limites);

  const hoja = partes.get(HOJA);
  if (hoja === undefined) {
    throw new ErrorDeLectura(
      'El archivo no trae una primera hoja legible. Guárdalo de nuevo como .xlsx.',
    );
  }

  const compartidas = leerCadenasCompartidas(partes.get(CADENAS));
  return leerFilas(Buffer.from(hoja).toString('utf8'), compartidas);
}

function leerCadenasCompartidas(bytes) {
  if (bytes === undefined) return [];

  const xml = Buffer.from(bytes).toString('utf8');
  const cadenas = [];

  // Cada `<si>` es una cadena, y puede venir partida en varios `<t>` cuando
  // lleva formato mezclado. Se concatenan.
  for (const si of entre(xml, '<si>', '</si>')) {
    cadenas.push(
      [...entre(si, '<t', '</t>')]
        .map((trozo) => desescapar(trozo.slice(trozo.indexOf('>') + 1)))
        .join(''),
    );
  }

  return cadenas;
}

function leerFilas(xml, compartidas) {
  const filas = [];
  for (const fila of entre(xml, '<row', '</row>')) filas.push(leerCeldas(fila, compartidas));

  return filas;
}

function leerCeldas(fila, compartidas) {
  const celdas = [];

  for (const celda of entre(fila, '<c ', '</c>')) {
    const columna = columnaDe(atributo(celda, 'r'));
    // LAS CELDAS VACIAS NO VIENEN EN EL XML. Excel se salta la B si esta
    // vacia, asi que sin colocar cada celda en SU columna la fila entera se
    // desplaza y el validador leeria el precio donde esperaba la unidad.
    while (celdas.length < columna) celdas.push('');
    celdas.push(valorDe(celda, compartidas));
  }

  return celdas;
}

function valorDe(celda, compartidas) {
  if (atributo(celda, 't') === 'inlineStr') {
    const trozo = [...entre(celda, '<t', '</t>')][0];
    return trozo === undefined ? '' : desescapar(trozo.slice(trozo.indexOf('>') + 1));
  }

  const valor = [...entre(celda, '<v>', '</v>')][0];
  if (valor === undefined) return '';

  const crudo = desescapar(valor.slice('<v>'.length));
  if (atributo(celda, 't') !== 's') return crudo;

  return compartidas[Number.parseInt(crudo, 10)] ?? '';
}

/** `BC12` → 54. La referencia trae letras de columna y numero de fila. */
function columnaDe(referencia) {
  if (referencia === null) return 0;

  let columna = 0;
  for (const caracter of referencia) {
    const codigo = caracter.charCodeAt(0) - BASE_LETRA;
    if (codigo < 0 || codigo >= LETRAS) break;
    columna = columna * LETRAS + codigo + 1;
  }

  return Math.max(0, columna - 1);
}

function atributo(etiqueta, nombre) {
  const marca = ` ${nombre}="`;
  const inicio = etiqueta.indexOf(marca);
  if (inicio === -1) return null;

  const desde = inicio + marca.length;
  const hasta = etiqueta.indexOf('"', desde);
  return hasta === -1 ? null : etiqueta.slice(desde, hasta);
}

/**
 * Los trozos entre dos marcas, sin construir un arbol.
 *
 * Un escaner y no un parser: el XML de una hoja es plano y regular, y no hace
 * falta —ni conviene— entenderlo entero para sacar sus celdas.
 */
function* entre(xml, abre, cierra) {
  let cursor = 0;

  for (;;) {
    const inicio = xml.indexOf(abre, cursor);
    if (inicio === -1) return;

    const fin = xml.indexOf(cierra, inicio);
    if (fin === -1) return;

    yield xml.slice(inicio, fin);
    cursor = fin + cierra.length;
  }
}

/**
 * Deshace las cinco entidades de XML y las referencias numericas.
 *
 * **Cualquier otra entidad se deja tal cual, a proposito.** Resolver `&foo;`
 * exigiria leer el DOCTYPE, y ahi viven las entidades externas y la expansion
 * exponencial. Un `&foo;` literal en un nombre de item es raro e inofensivo.
 */
function desescapar(texto) {
  return texto.replaceAll(/&(#x?[0-9a-f]+|[a-z]+);/giu, (completo, cuerpo) => {
    const conocida = ENTIDADES.get(cuerpo.toLowerCase());
    if (conocida !== undefined) return conocida;
    if (!cuerpo.startsWith('#')) return completo;

    const hex = cuerpo[1] === 'x' || cuerpo[1] === 'X';
    const codigo = Number.parseInt(cuerpo.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : completo;
  });
}

// --- CSV y TSV --------------------------------------------------------------

const COMILLA = '"';
const SALTO = '\n';
const RETORNO = '\r';
const CANDIDATOS = [',', ';', '\t'];
const LINEAS_DE_MUESTRA = 5;

/**
 * Lee un CSV o un TSV.
 *
 * Parece el facil de los dos y no lo es: el CSV real trae comillas, comas
 * dentro de las comillas, comillas escapadas doblandolas y —lo que rompe a los
 * ingenuos— **saltos de linea dentro de un campo entrecomillado**.
 */
export function leerDelimitado(bytes) {
  const texto = sinBom(Buffer.from(bytes).toString('utf8'));
  const delimitador = detectarDelimitador(texto);

  return { filas: separar(texto, delimitador), delimitador };
}

/**
 * Excel escribe un BOM al guardar como CSV UTF-8. Sin quitarlo, la PRIMERA
 * cabecera no coincide con ninguna esperada y el archivo se rechaza entero por
 * un caracter invisible — el fallo mas frustrante posible.
 */
function sinBom(texto) {
  return texto.charCodeAt(0) === 0xfeff ? texto.slice(1) : texto;
}

/**
 * Gana el candidato que parta todas las lineas en el mismo numero de trozos.
 *
 * Contar apariciones a secas se equivoca con un archivo de comas decimales:
 * `1,50;2,30` tiene mas comas que puntos y comas y el delimitador es el `;`.
 * Lo que distingue a un delimitador de verdad es la **regularidad**.
 */
function detectarDelimitador(texto) {
  const muestra = texto
    .split(SALTO)
    .slice(0, LINEAS_DE_MUESTRA)
    .filter((linea) => linea.trim() !== '');
  if (muestra.length === 0) return CANDIDATOS[0];

  let mejor = CANDIDATOS[0];
  let mejorPuntuacion = -1;

  for (const candidato of CANDIDATOS) {
    const columnas = muestra.map((linea) => linea.split(candidato).length);
    const primera = columnas[0] ?? 1;
    // Una sola columna no es una deteccion: es el delimitador que no aparece.
    const puntuacion = primera > 1 && columnas.every((n) => n === primera) ? primera : 0;

    if (puntuacion > mejorPuntuacion) {
      mejor = candidato;
      mejorPuntuacion = puntuacion;
    }
  }

  return mejor;
}

const INICIAL = { filas: [], fila: [], campo: '', entreComillas: false, saltar: 0 };

/**
 * Un caracter, un paso del automata.
 *
 * Escrito como una transicion y no como un bucle con banderas porque el CSV
 * **es** un automata de dos estados, y su unica sutileza —dos comillas seguidas
 * son una comilla literal— se lee de un vistazo aqui.
 */
function paso({ texto, posicion, delimitador, estado }) {
  const caracter = texto[posicion] ?? '';

  if (estado.entreComillas) {
    if (caracter !== COMILLA) return { ...estado, campo: estado.campo + caracter, saltar: 0 };
    if (texto[posicion + 1] === COMILLA) {
      return { ...estado, campo: estado.campo + COMILLA, saltar: 1 };
    }
    return { ...estado, entreComillas: false, saltar: 0 };
  }

  if (caracter === COMILLA) return { ...estado, entreComillas: true, saltar: 0 };
  if (caracter === delimitador) {
    return { ...estado, fila: [...estado.fila, estado.campo], campo: '', saltar: 0 };
  }
  if (caracter === SALTO) {
    return {
      ...estado,
      filas: [...estado.filas, [...estado.fila, estado.campo]],
      fila: [],
      campo: '',
      saltar: 0,
    };
  }
  if (caracter === RETORNO) return { ...estado, saltar: 0 };

  return { ...estado, campo: estado.campo + caracter, saltar: 0 };
}

function separar(texto, delimitador) {
  if (texto === '') return [];

  // SE GARANTIZA UN SALTO FINAL para que la ultima fila se cierre por el mismo
  // camino que las demas. Sin esto haria falta un caso especial al terminar, y
  // los casos especiales al terminar son donde se pierde el ultimo registro.
  const completo = texto.endsWith(SALTO) ? texto : texto + SALTO;
  let estado = INICIAL;

  for (let i = 0; i < completo.length; i += 1) {
    estado = paso({ texto: completo, posicion: i, delimitador, estado });
    i += estado.saltar;
  }

  return estado.filas;
}

// --- que es realmente el archivo -------------------------------------------

/**
 * Decide el formato por los BYTES — SEGURIDAD.md §5.2.
 *
 * Ni la extension ni el `Content-Type` deciden nada: los dos los escribe el
 * cliente, y un cliente hostil escribe lo que le conviene.
 *
 * Dos familias y dos criterios, porque solo una tiene firma. El `.xlsx` es un
 * ZIP y empieza por `PK`+0x03+0x04. El `.csv` y el `.tsv` son texto plano y no
 * tienen firma, asi que se comprueba lo que si distingue al texto de un
 * binario: que decodifique como UTF-8 sin reemplazos y que no traiga bytes
 * nulos. Un `.exe` renombrado a `.csv` falla las dos.
 */
export function formatoDe(bytes) {
  if (FIRMA_ZIP.every((esperado, i) => bytes[i] === esperado)) return 'XLSX';
  if (esTextoPlano(bytes)) return 'DELIMITADO';

  // NO SE DICE QUE SE DETECTO. Contestar «esto parece un PDF» le regala a quien
  // sondea un detector de tipos gratis.
  throw new ErrorDeLectura('Solo se admiten archivos .xlsx, .csv y .tsv.');
}

/**
 * El byte nulo es el que delata a un binario disfrazado —ningun texto legitimo
 * lo lleva— y ademas el que rompe a los consumidores en C, que tratan la cadena
 * como terminada ahi. Rechazarlo cierra las dos cosas a la vez.
 */
function esTextoPlano(bytes) {
  const muestra = bytes.subarray(0, MUESTRA);
  if (muestra.length === 0) return false;
  if (muestra.includes(0)) return false;

  // Se busca el reemplazo en vez de usar `fatal: true`: una muestra cortada a
  // 4 KB puede partir un caracter multibyte por la mitad, y con `fatal` eso
  // seria un rechazo por donde cae el corte, no por el contenido.
  const texto = new TextDecoder('utf-8').decode(muestra);
  const cortado = muestra.length === MUESTRA && texto.endsWith(REEMPLAZO);

  return !(cortado ? texto.slice(0, -1) : texto).includes(REEMPLAZO);
}

/**
 * La puerta unica: bytes dentro, matriz de celdas fuera.
 *
 * Es lo que el proceso hijo llama, y lo unico que hace falta exportar para
 * usarlo. El resto se exporta para poder probarlo pieza a pieza.
 */
export function leerHoja(bytes, limites) {
  const formato = formatoDe(bytes);
  const filas = formato === 'XLSX' ? leerXlsx(bytes, limites) : leerDelimitado(bytes).filas;

  return { formato, filas };
}
