/**
 * Compila `apps/api` y ejecuta uno de sus binarios de `dist/`.
 *
 * EJECUTA `dist/*.js`, NUNCA EL FUENTE, y no es una preferencia: `apps/api` es
 * `"type": "commonjs"` con imports sin extension, y Node, para correr
 * TypeScript, lo trata como ESM — que exige extension explicita. Es INC-017, la
 * misma razon por la que `npm run dev` no funciono durante diez paquetes.
 *
 * COMPILA SIEMPRE ANTES. Un `dist/` viejo correria con las reglas de ayer, y
 * en estos dos binarios eso no se arregla despues: el importador escribe en un
 * libro append-only, y el back office podria arrancar sin el registro de
 * acceso. `tsc --build` es incremental: cuando no hay cambios, no cuesta nada.
 *
 * VIVE AQUI PORQUE LO USAN DOS LANZADORES —`importar` y `backoffice`— y la
 * tercera copia la habria cazado `audit:duplication` de todos modos.
 */

import { APP } from './entorno.mjs';
import { correrCli } from './proceso.mjs';

/**
 * @param {string} binario ruta relativa dentro de `apps/api`, p. ej. `dist/cli.js`
 * @param {readonly string[]} argumentos los del usuario, tal cual
 * @returns {never}
 */
export function compilarYCorrer(binario, argumentos) {
  const compilacion = correrCli('typescript', ['--build', 'tsconfig.build.json'], {
    cwd: APP,
    stdio: 'inherit',
    ejecutable: 'tsc',
  });

  if (compilacion.status !== 0) {
    process.exit(compilacion.status ?? 1);
  }

  // Los argumentos van tal cual: quien valida es el esquema del propio binario,
  // que es donde tiene que estar (CLAUDE.md §3, INC-008).
  const ejecucion = correrCli('node', [binario, ...argumentos], {
    cwd: APP,
    stdio: 'inherit',
  });

  process.exit(ejecucion.status ?? 1);
}
