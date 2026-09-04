#!/usr/bin/env node
/**
 * Activa los hooks de git versionados en .githooks/.
 *
 * Se usa `core.hooksPath` en vez de husky: son dos lineas de configuracion
 * contra una dependencia con su propio ciclo de vida, y CLAUDE.md §3 prohibe
 * traer una dependencia para lo que se resuelve a mano. Ver ADR-005.
 *
 * Corre desde el script `prepare` de npm, es decir en cada `npm install`.
 * Es idempotente y nunca falla el install: si git no esta disponible (por
 * ejemplo en una imagen de CI sin repositorio) avisa y sale con exito.
 */
import { execFileSync } from 'node:child_process';

const HOOKS_PATH = '.githooks';

/** @param {readonly string[]} args */
function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

try {
  git(['rev-parse', '--git-dir']);
} catch {
  console.log('[hooks] No es un repositorio git; no hay hooks que activar.');
  process.exit(0);
}

let current = '';
try {
  current = git(['config', '--get', 'core.hooksPath']);
} catch {
  // git config sale con codigo 1 cuando la clave no existe. No es un error.
}

if (current === HOOKS_PATH) {
  console.log(`[hooks] core.hooksPath ya apunta a ${HOOKS_PATH}.`);
  process.exit(0);
}

try {
  git(['config', 'core.hooksPath', HOOKS_PATH]);
  console.log(`[hooks] core.hooksPath -> ${HOOKS_PATH}`);
} catch (error) {
  const detalle = error instanceof Error ? error.message : String(error);
  console.error(`[hooks] No se pudo activar core.hooksPath: ${detalle}`);
  console.error('[hooks] Actívalo a mano con: git config core.hooksPath .githooks');
  process.exit(0);
}
