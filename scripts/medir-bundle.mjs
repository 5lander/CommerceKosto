#!/usr/bin/env node
/**
 * `npm run medir-bundle` — cuanto JavaScript carga el navegador por pantalla.
 *
 * POR QUE SE MIDE. La app cliente se usa de pie, en una cocina o una bodega,
 * con la conexion que haya (CLAUDE.md §10). Cada kilobyte que el navegador
 * tiene que bajar antes de pintar la primera pantalla es tiempo en el que el
 * bodeguero mira un rectangulo blanco. Y un presupuesto que nadie mide se
 * incumple sin que nadie se entere: es lo que le paso al p95 de §5 entre P9 y
 * P15 (AUDITORIA.md I8).
 *
 * QUE SE MIDE, EXACTAMENTE. Lo que el navegador baja para pintar una pantalla
 * por primera vez, en dos cifras:
 *
 *   piso      los chunks que TODAS las pantallas comparten (`rootMainFiles`
 *             del manifiesto de build: React, el runtime de Next y el de
 *             Turbopack). Es el precio de entrada de la aplicacion entera.
 *   pantalla  el piso mas los chunks propios de esa ruta, leidos del
 *             `page_client-reference-manifest.js` que Next escribe por ruta.
 *             Es el mismo conjunto que el HTML prerenderizado referencia en
 *             sus `<script>`; se lee del manifiesto y no del HTML porque una
 *             ruta dinamica (`/insumos/[id]`) no tiene HTML y si manifiesto.
 *
 * EN GZIP, PORQUE ES LO QUE VIAJA. El servidor autocontenido de Next comprime
 * por defecto (`compress: true`); Caddy solo reenvia. El piso en bruto son
 * ~430 KB y comprimido ~130: el numero sin comprimir describe el disco, no la
 * conexion. Se imprimen los dos, y el presupuesto se exige sobre el segundo.
 *
 * NO INCLUYE el polyfill (`noModule`: solo lo baja un navegador antiguo), ni
 * la hoja de estilos, ni las tipografias: son un solo archivo cada una y no
 * crecen con las pantallas. Lo que crece con las pantallas es el JavaScript.
 *
 * MIDE EL ULTIMO BUILD, NO EL CODIGO. Hay que construir antes:
 *
 *   npm run build --workspace @costeo/web && npm run medir-bundle
 *
 * Imprime el `BUILD_ID` y la hora del manifiesto para que un build viejo no
 * pase por reciente. Falla con codigo 1 si algun presupuesto se pasa; cuando
 * eso ocurra, el check tiene razon y lo que se arregla es la pantalla, no el
 * umbral.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import { RAIZ } from './lib/entorno.mjs';

const SALIDA = join(RAIZ, 'apps', 'web', '.next');
const KIB = 1024;

/**
 * Presupuesto en KiB comprimidos. El piso medido al fijarlo era 127 KiB y la
 * pantalla mas cara 139 KiB (P16, commit 0): el margen es para el armazon y
 * el kit de componentes, no para una dependencia nueva.
 */
const PRESUPUESTO_KIB = { piso: 200, pantalla: 350 };

/** Rutas que Next genera solo y no son pantallas del producto. */
const RUTAS_DE_NEXT = new Set(['/_global-error', '/_not-found']);

const CHUNK_DE_JAVASCRIPT = /static\/chunks\/[\w-]+\.js/g;

/** @typedef {{bruto: number, gzip: number}} Tamano */

/**
 * @param {string} relativa ruta dentro de `.next`
 * @returns {string}
 */
function leerTexto(relativa) {
  const ruta = join(SALIDA, relativa);
  if (!existsSync(ruta)) {
    throw new Error(
      `No existe ${ruta}.\n  Construye primero:  npm run build --workspace @costeo/web`,
    );
  }
  return readFileSync(ruta, 'utf8');
}

/** @returns {Map<string, string>} clave de ruta -> ruta publica */
function pantallas() {
  /** @type {Record<string, string>} */
  const manifiesto = JSON.parse(leerTexto('app-path-routes-manifest.json'));
  const resultado = new Map();
  for (const [clave, ruta] of Object.entries(manifiesto)) {
    if (!RUTAS_DE_NEXT.has(ruta)) resultado.set(clave, ruta);
  }
  return resultado;
}

/** @returns {Set<string>} */
function chunksDelPiso() {
  /** @type {{rootMainFiles: string[]}} */
  const manifiesto = JSON.parse(leerTexto('build-manifest.json'));
  return new Set(manifiesto.rootMainFiles);
}

/**
 * @param {string} clave p. ej. `/costeo/page`
 * @param {Set<string>} piso
 * @returns {Set<string>}
 */
function chunksDePantalla(clave, piso) {
  const texto = leerTexto(join('server', 'app', `${clave}_client-reference-manifest.js`));
  const chunks = new Set(piso);
  for (const chunk of texto.match(CHUNK_DE_JAVASCRIPT) ?? []) {
    chunks.add(chunk);
  }
  return chunks;
}

/**
 * @param {Iterable<string>} chunks
 * @returns {Tamano}
 */
function tamanoDe(chunks) {
  let bruto = 0;
  let gzip = 0;
  for (const chunk of chunks) {
    const contenido = readFileSync(join(SALIDA, chunk));
    bruto += contenido.length;
    gzip += gzipSync(contenido).length;
  }
  return { bruto, gzip };
}

/** @param {number} bytes */
function enKib(bytes) {
  return (bytes / KIB).toFixed(1).padStart(7);
}

/**
 * @param {string} nombre
 * @param {Tamano} tamano
 * @param {number} presupuestoKib
 * @returns {boolean} si cabe en el presupuesto
 */
function informar(nombre, tamano, presupuestoKib) {
  const cabe = tamano.gzip <= presupuestoKib * KIB;
  const estado = cabe ? 'ok   ' : 'PASA ';
  console.log(`  ${estado} ${enKib(tamano.gzip)} KiB gzip  ${enKib(tamano.bruto)} KiB bruto  ${nombre}`);
  return cabe;
}

function encabezado() {
  const construido = statSync(join(SALIDA, 'build-manifest.json')).mtime.toISOString();
  console.log(`medir-bundle  build ${leerTexto('BUILD_ID').trim()} del ${construido}`);
  console.log(`  presupuesto: piso ${PRESUPUESTO_KIB.piso} KiB · pantalla ${PRESUPUESTO_KIB.pantalla} KiB, en gzip\n`);
}

function medir() {
  encabezado();
  const piso = chunksDelPiso();
  let todoCabe = informar('(piso, comun a todas)', tamanoDe(piso), PRESUPUESTO_KIB.piso);

  for (const [clave, ruta] of pantallas()) {
    const cabe = informar(ruta, tamanoDe(chunksDePantalla(clave, piso)), PRESUPUESTO_KIB.pantalla);
    todoCabe = todoCabe && cabe;
  }

  console.log(todoCabe ? '\nmedir-bundle  OK' : '\nmedir-bundle  FALLO — alguna pantalla se pasa del presupuesto');
  return todoCabe ? 0 : 1;
}

process.exit(medir());
