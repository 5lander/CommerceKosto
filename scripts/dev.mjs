#!/usr/bin/env node
/**
 * `npm run dev` — compila en vigilancia y ejecuta la API recargándola sola.
 *
 * POR QUE NO ES `node --watch --experimental-transform-types src/main.ts`.
 * Porque eso **no funciona**, y llevaba sin funcionar desde P0 sin que nadie lo
 * notara: todo se ejecuta por Vitest, que transpila por su cuenta, o por Docker,
 * que corre `dist/main.js`. El comando fallaba antes de cargar nada:
 *
 *   Warning: Failed to load the ES module: ... src/main.ts.
 *            Make sure to set "type": "module" ...
 *   SyntaxError: Cannot use import statement outside a module
 *
 * La causa no es un flag que falte. `apps/api` es `"type": "commonjs"` y sus
 * imports no llevan extension; Node, para ejecutar TypeScript, lo trata como
 * ESM, y ESM **exige extension explicita** en los especificadores relativos. Se
 * comprobo con un caso minimo: `import './a'` falla, `import './a.ts'` funciona.
 * Arreglarlo de raiz seria pasar el paquete entero a ESM con extensiones, que es
 * un cambio de otro paquete (NestJS 12 sera ESM; ver ADR-001).
 *
 * Asi que dev hace lo que hace produccion, en vigilancia: `tsc --watch` deja
 * `dist/` al dia y `node --watch dist/main.js` reinicia cuando cambia.
 *
 * SIN DEPENDENCIAS. Nada de `concurrently` ni `nodemon`: dos procesos hijo y un
 * apagado ordenado caben aqui, y es la misma linea que P0 siguio con husky,
 * dotenv y cross-env.
 */

import { APP } from './lib/entorno.mjs';
import { correrCliAsincrono } from './lib/proceso.mjs';

/** Lo que se espera a que `tsc` escriba antes de arrancar la aplicacion. */
const SALIDA = 'dist/main.js';

/** @type {import('node:child_process').ChildProcess[]} */
const hijos = [];

/**
 * Apaga los dos hijos antes de irse, para no dejar procesos sueltos.
 *
 * @param {number} codigo
 */
function apagar(codigo) {
  for (const hijo of hijos) hijo.kill();
  process.exit(codigo);
}

process.on('SIGINT', () => {
  apagar(0);
});
process.on('SIGTERM', () => {
  apagar(0);
});

const compilador = correrCliAsincrono('typescript', ['--build', 'tsconfig.build.json', '--watch'], {
  cwd: APP,
  stdio: 'inherit',
  ejecutable: 'tsc',
});
hijos.push(compilador);

// SE ESPERA A LA PRIMERA COMPILACION. Arrancar `node --watch` sobre un `dist/`
// que todavia no existe imprime un error de modulo no encontrado que parece el
// problema y no lo es.
const { existsSync } = await import('node:fs');
const { join } = await import('node:path');
const { setTimeout: esperar } = await import('node:timers/promises');

const destino = join(APP, SALIDA);
while (!existsSync(destino)) {
  await esperar(200);
}

// `--watch-path=dist` y no `--watch` a secas: sin acotarlo, Node vigila TODO
// lo que se requiere —`node_modules` incluido— y la aplicacion se reinicia
// varias veces por cada compilacion. Se vio en la primera prueba.
const aplicacion = correrCliAsincrono('node', ['--watch-path=dist', SALIDA], {
  cwd: APP,
  stdio: 'inherit',
});
hijos.push(aplicacion);
