#!/usr/bin/env node
/**
 * `npm run importar` — compila si hace falta y ejecuta el importador.
 *
 * EJECUTA `dist/cli.js`, NUNCA EL FUENTE, y no es una preferencia: `apps/api`
 * es `"type": "commonjs"` con imports sin extension, y Node, para correr
 * TypeScript, lo trata como ESM — que exige extension explicita. Es INC-017, la
 * misma razon por la que `npm run dev` no funciono durante diez paquetes y por
 * la que el parser acabo en `.mjs`.
 *
 * COMPILA SIEMPRE ANTES. Un `dist/` viejo importaria con las reglas de ayer, y
 * eso en una migracion de datos reales no se puede arreglar despues: el libro
 * de inventario es append-only y el catalogo ya tendria las filas dentro.
 * `tsc --build` es incremental, asi que cuando no hay cambios no cuesta nada.
 *
 * SIN DEPENDENCIAS NUEVAS, en la misma linea que `dev.mjs`.
 */

import { APP } from './lib/entorno.mjs';
import { correrCli } from './lib/proceso.mjs';

const SALIDA = 'dist/cli.js';

const compilacion = correrCli('typescript', ['--build', 'tsconfig.build.json'], {
  cwd: APP,
  stdio: 'inherit',
  ejecutable: 'tsc',
});

if (compilacion.status !== 0) {
  process.exit(compilacion.status ?? 1);
}

// Los argumentos del usuario van tal cual: quien valida es el esquema del CLI,
// que es donde tiene que estar (CLAUDE.md §3, INC-008).
const ejecucion = correrCli('node', [SALIDA, ...process.argv.slice(2)], {
  cwd: APP,
  stdio: 'inherit',
});

process.exit(ejecucion.status ?? 1);
