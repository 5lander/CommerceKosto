/**
 * El hash de una contrasena, calculado con el `Argon2Hasher` REAL.
 *
 * VIVE AQUI PORQUE LO NECESITAN DOS SCRIPTS —`bench` y el alta de operadores—
 * y `audit:duplication` caza la segunda copia. Pero la razon de fondo es otra y
 * es mas importante: **los parametros de Argon2id viven en un solo sitio**. Una
 * segunda implementacion acabaria siendo la debil, y la debil es siempre la que
 * protege lo que menos se mira.
 *
 * POR QUE UN PROCESO HIJO Y NO UN `import`. Estos scripts son `.mjs` sueltos, y
 * `Argon2Hasher` es TypeScript compilado a CommonJS dentro de `apps/api`.
 * Importarlo desde aqui obligaria a resolver rutas de `dist` a mano y a
 * mantener vivo ese acoplamiento; `dist/hashear.js` ya es un binario con una
 * entrada y una salida — contrasena por stdin, hash por stdout.
 */

import { resolve } from 'node:path';

import { RAIZ } from './entorno.mjs';
import { correr } from './proceso.mjs';

const RUTA_HASHEADOR = resolve(RAIZ, 'apps', 'api', 'dist', 'hashear.js');

/**
 * @param {string} contrasena
 * @returns {string} el hash codificado, con sus parametros dentro.
 */
export function hashDe(contrasena) {
  const resultado = correr(process.execPath, [RUTA_HASHEADOR], {
    cwd: RAIZ,
    encoding: 'utf8',
    input: contrasena,
  });

  if (resultado.status !== 0) {
    throw new Error(
      `No se pudo calcular el hash: ${resultado.stderr ?? ''}\n` +
        '¿Está compilado? `npm run build`.',
    );
  }
  return String(resultado.stdout).trim();
}
