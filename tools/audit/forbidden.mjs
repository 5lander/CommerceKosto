#!/usr/bin/env node
/**
 * `audit:forbidden` — el escaner de reglas propias de este proyecto.
 *
 * Lo que ESLint no puede expresar: prohibiciones que cruzan lenguajes (SQL en
 * migraciones, YAML de Docker, manifiestos de npm) y reglas sobre el estado del
 * repositorio, no sobre un archivo.
 *
 * Dos vistas:
 *   contenido  una expresion regular contra el texto de cada archivo incluido
 *   repositorio  una funcion que mira el conjunto (archivos versionados, diff)
 *
 * Las reglas viven en `tools/audit/rules/*.rules.mjs` como DATOS. Un paquete
 * nuevo anade la suya ahi sin tocar este archivo.
 *
 * Uso:
 *   node tools/audit/forbidden.mjs            todo el arbol de trabajo
 *   node tools/audit/forbidden.mjs --staged   solo lo que esta en el indice
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { sinComentarios, sinComentariosNiCadenas } from './lib/comentarios.mjs';
import { matchesAny, normalizePath } from './lib/glob.mjs';
import { coreRules } from './rules/core.rules.mjs';
import { appendOnlyRules } from './rules/append-only.rules.mjs';
import { tenantRules } from './rules/tenant.rules.mjs';
import { repoRules } from './rules/repo.rules.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOLO_INDICE = process.argv.includes('--staged');

/**
 * @typedef {object} ReglaDeContenido
 * @property {string} id
 * @property {string} descripcion
 * @property {string} porQue
 * @property {RegExp} patron
 * @property {readonly string[]} incluye
 * @property {readonly string[]} [excluye]
 * @property {'codigo' | 'codigo-sin-cadenas' | 'todo'} [analiza]
 *   'codigo' (por defecto) enmascara los comentarios antes de buscar;
 *   'codigo-sin-cadenas' enmascara ademas el contenido de las cadenas;
 *   'todo' no enmascara nada, para las reglas de directivas, que viven en
 *   comentarios por definicion.
 * @property {string} desde
 * @property {string} referencia
 */

/**
 * @typedef {object} Hallazgo
 * @property {string} ruta
 * @property {number} linea
 * @property {string} extracto
 */

/**
 * @typedef {object} ReglaDeRepositorio
 * @property {string} id
 * @property {string} descripcion
 * @property {string} porQue
 * @property {string} desde
 * @property {string} referencia
 * @property {(contexto: {archivos: readonly string[], leer: (ruta: string) => string, raiz: string}) => Hallazgo[]} revisar
 */

/** @typedef {Hallazgo & {regla: ReglaDeContenido | ReglaDeRepositorio}} Infraccion */

/** @type {ReglaDeContenido[]} */
const reglasDeContenido = [...coreRules, ...appendOnlyRules, ...tenantRules];

/** Archivos versionados o nuevos, nunca los ignorados. */
function listarArchivos() {
  const args = SOLO_INDICE
    ? ['diff', '--cached', '--name-only', '--diff-filter=ACMR']
    : ['ls-files', '--cached', '--others', '--exclude-standard'];

  const salida = execFileSync('git', args, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

  return salida
    .split('\n')
    .map((linea) => normalizePath(linea.trim()))
    .filter(Boolean)
    .filter((ruta) => {
      const absoluta = join(RAIZ, ruta);
      return existsSync(absoluta) && statSync(absoluta).isFile();
    });
}

const cache = new Map();

/** @param {string} ruta */
function leer(ruta) {
  if (!cache.has(ruta)) {
    cache.set(ruta, readFileSync(join(RAIZ, ruta), 'utf8'));
  }
  return cache.get(ruta);
}

/**
 * @param {string} contenido
 * @param {number} indice
 */
function numeroDeLinea(contenido, indice) {
  let linea = 1;
  for (let i = 0; i < indice; i += 1) {
    if (contenido.charCodeAt(i) === 10) linea += 1;
  }
  return linea;
}

/**
 * @param {string} contenido
 * @param {number} indice
 */
function extracto(contenido, indice) {
  const inicio = contenido.lastIndexOf('\n', indice) + 1;
  let fin = contenido.indexOf('\n', indice);
  if (fin === -1) fin = contenido.length;
  return contenido.slice(inicio, fin).trim().slice(0, 160);
}

/**
 * @param {'codigo' | 'codigo-sin-cadenas' | 'todo'} modo
 * @param {string} ruta
 * @param {string} original
 */
function enmascararSegun(modo, ruta, original) {
  if (modo === 'todo') return original;
  if (modo === 'codigo-sin-cadenas') return sinComentariosNiCadenas(ruta, original);
  return sinComentarios(ruta, original);
}

/**
 * Aplica una regla a un archivo. Se aisla en su propia funcion para que el
 * bucle de coincidencias no anide un cuarto nivel dentro de `revisarContenido`.
 * @param {ReglaDeContenido} regla
 * @param {string} ruta
 * @returns {Infraccion[]}
 */
function aplicarRegla(regla, ruta) {
  const original = leer(ruta);
  // Las reglas de codigo no miran comentarios: la prosa que EXPLICA una regla
  // contiene por necesidad lo que la regla prohibe. Ver lib/comentarios.mjs.
  const contenido = enmascararSegun(regla.analiza ?? 'codigo', ruta, original);
  // Instancia propia del patron: `lastIndex` es estado mutable y compartirlo
  // entre archivos hace que se salten coincidencias.
  const patron = new RegExp(regla.patron.source, regla.patron.flags);

  /** @type {Infraccion[]} */
  const infracciones = [];
  let coincidencia = patron.exec(contenido);

  while (coincidencia !== null) {
    infracciones.push({
      regla,
      ruta,
      linea: numeroDeLinea(contenido, coincidencia.index),
      extracto: extracto(contenido, coincidencia.index),
    });
    if (coincidencia[0].length === 0) patron.lastIndex += 1;
    coincidencia = patron.exec(contenido);
  }

  return infracciones;
}

/**
 * @param {readonly string[]} archivos
 * @param {ReglaDeContenido} regla
 */
function archivosDeLaRegla(archivos, regla) {
  return archivos
    .filter((ruta) => matchesAny(ruta, regla.incluye))
    .filter((ruta) => !matchesAny(ruta, regla.excluye ?? []));
}

/**
 * @param {readonly string[]} archivos
 * @returns {Infraccion[]}
 */
function revisarContenido(archivos) {
  return reglasDeContenido.flatMap((regla) =>
    archivosDeLaRegla(archivos, regla).flatMap((ruta) => aplicarRegla(regla, ruta)),
  );
}

/**
 * Cuantos archivos EXAMINA de verdad alguna regla de contenido.
 *
 * No es lo mismo que "archivos del repositorio": los `.md`, los `.txt` de
 * evidencia y las imagenes no los mira ninguna regla. Informar el total daria
 * una cifra mas grande y mas tranquilizadora que la real, que es exactamente el
 * tipo de verde enganoso que este proyecto persigue.
 *
 * @param {readonly string[]} archivos
 * @returns {number}
 */
function archivosExaminados(archivos) {
  const vistos = new Set();
  for (const regla of reglasDeContenido) {
    for (const ruta of archivosDeLaRegla(archivos, regla)) {
      vistos.add(ruta);
    }
  }
  return vistos.size;
}

/**
 * @param {readonly string[]} archivos
 * @returns {Infraccion[]}
 */
function revisarRepositorio(archivos) {
  const contexto = { archivos, leer, raiz: RAIZ };
  return /** @type {ReglaDeRepositorio[]} */ (repoRules).flatMap((regla) =>
    regla.revisar(contexto).map((hallazgo) => ({ regla, ...hallazgo })),
  );
}

const MAXIMO_EJEMPLOS = 12;

/**
 * @param {readonly Infraccion[]} infracciones
 * @returns {Map<string, Infraccion[]>}
 */
function agruparPorRegla(infracciones) {
  /** @type {Map<string, Infraccion[]>} */
  const porRegla = new Map();
  for (const infraccion of infracciones) {
    const lista = porRegla.get(infraccion.regla.id) ?? [];
    lista.push(infraccion);
    porRegla.set(infraccion.regla.id, lista);
  }
  return porRegla;
}

/**
 * El informe dice QUE se prohibe, POR QUE, y donde esta escrita la norma. Sin
 * el "por que", la reaccion natural ante un check que estorba es desactivarlo.
 * @param {string} id
 * @param {readonly Infraccion[]} lista
 */
function imprimirRegla(id, lista) {
  const primera = lista[0];
  if (primera === undefined) return;

  const { descripcion, porQue, referencia } = primera.regla;
  console.error(`  [${id}]  ${descripcion}`);
  console.error(`     por que: ${porQue}`);
  console.error(`     norma:   ${referencia}`);

  for (const infraccion of lista.slice(0, MAXIMO_EJEMPLOS)) {
    const posicion = infraccion.linea > 0 ? `:${infraccion.linea}` : '';
    console.error(`     ${infraccion.ruta}${posicion}  ${infraccion.extracto}`);
  }
  if (lista.length > MAXIMO_EJEMPLOS) {
    console.error(`     ... y ${lista.length - MAXIMO_EJEMPLOS} mas`);
  }
  console.error('');
}

/**
 * @param {readonly Infraccion[]} infracciones
 * @param {number} totalArchivos
 * @returns {number} codigo de salida
 */
function informar(infracciones, totalArchivos) {
  if (infracciones.length === 0) {
    const reglas = reglasDeContenido.length + repoRules.length;
    console.log(`audit:forbidden  OK — ${reglas} reglas sobre ${totalArchivos} archivos`);
    return 0;
  }

  console.error(`\naudit:forbidden  FALLO — ${infracciones.length} infraccion(es)\n`);
  for (const [id, lista] of agruparPorRegla(infracciones)) {
    imprimirRegla(id, lista);
  }
  return 1;
}

const archivos = listarArchivos();
const infracciones = [...revisarContenido(archivos), ...revisarRepositorio(archivos)];
process.exit(informar(infracciones, archivosExaminados(archivos)));
