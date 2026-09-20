/**
 * Ejecucion de procesos hijo SIN `shell: true`.
 *
 * POR QUE IMPORTA. En Windows, `spawnSync(cmd, args, { shell: true })` no pasa
 * los argumentos: los CONCATENA en una linea de comandos, sin comillas. Un
 * argumento con espacios —una consulta SQL, una ruta con espacios— se parte en
 * varios y el comando recibe basura:
 *
 *   psql -c "DROP DATABASE IF EXISTS x;"
 *     ->  psql -c DROP DATABASE IF EXISTS x;
 *     ->  "ERROR: syntax error at end of input / LINE 1: DROP"
 *
 * Node avisa de esto (DEP0190), pero el aviso es facil de ignorar hasta que
 * algo se rompe de una forma que no se parece a su causa.
 *
 * LA TENTACION Y POR QUE NO FUNCIONA. Se llega a `shell: true` porque en
 * Windows `npx` y `npm` son `npx.cmd` y `npm.cmd`, y sin shell dan ENOENT. Pero
 * apuntar directamente al `.cmd` tampoco sirve: desde la mitigacion de
 * CVE-2024-27980, Node se niega a lanzar `.cmd` y `.bat` sin shell y responde
 * EINVAL. No hay forma segura de ejecutar un envoltorio `.cmd` sin shell.
 *
 * LA SALIDA. No ejecutar el envoltorio. Todo CLI de npm es, por debajo, un
 * archivo JavaScript declarado en el campo `bin` de su `package.json`:
 * `binarioDe('prisma')` lo resuelve y se lanza con `node`, que es un ejecutable
 * de verdad. Sin shell, sin problemas de comillas y sin depender de la
 * plataforma.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** Raiz del repositorio: dos niveles por encima de scripts/lib/. */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Ruta absoluta del punto de entrada JavaScript de un CLI de npm.
 *
 * @param {string} paquete nombre del paquete, p. ej. 'prisma'
 * @param {string} [ejecutable] clave dentro de `bin` si no coincide con el paquete
 * @returns {string}
 */
export function binarioDe(paquete, ejecutable = paquete) {
  const manifiesto = rutaDelManifiesto(paquete);
  /** @type {{bin?: string | Record<string, string>}} */
  const { bin } = require(manifiesto);

  const relativo = typeof bin === 'string' ? bin : bin?.[ejecutable];
  if (relativo === undefined) {
    throw new Error(`El paquete "${paquete}" no declara un ejecutable "${ejecutable}".`);
  }

  return resolve(dirname(manifiesto), relativo);
}

/**
 * Localiza el `package.json` de un paquete.
 *
 * La via directa (`require.resolve('x/package.json')`) falla con
 * ERR_PACKAGE_PATH_NOT_EXPORTED en los paquetes que declaran `exports` sin
 * incluir `./package.json` — dependency-cruiser es uno. En ese caso se resuelve
 * el punto de entrada y se sube por el arbol hasta encontrarlo.
 *
 * @param {string} paquete
 * @returns {string}
 */
function rutaDelManifiesto(paquete) {
  for (const intento of [
    () => require.resolve(`${paquete}/package.json`),
    () => join(dirname(require.resolve(paquete)), 'package.json'),
    () => join(RAIZ, 'node_modules', paquete, 'package.json'),
  ]) {
    try {
      const candidato = intento();
      if (existsSync(candidato)) return candidato;
    } catch {
      // Siguiente via.
    }
  }

  throw new Error(
    `No se encontro el package.json de "${paquete}". ` +
      'Algunos paquetes declaran `exports` sin exponerlo; se busca tambien en node_modules directamente.',
  );
}

/**
 * @param {string} comando ejecutable real (`node`, `docker`, `git`, `psql`)
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opciones]
 */
export function correr(comando, args, opciones = {}) {
  return spawnSync(comando, args, { ...opciones, shell: false });
}

/**
 * Ejecuta un CLI de npm a traves de `node`, evitando el envoltorio `.cmd`.
 *
 * @param {string} paquete
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnSyncOptions & {ejecutable?: string}} [opciones]
 */
export function correrCli(paquete, args, opciones = {}) {
  const { ejecutable, ...resto } = opciones;
  // `node` significa el propio Node, no un paquete que resolver. Su hermana
  // asincrona ya lo trataba asi; que aqui no lo hiciera era una asimetria entre
  // dos funciones que se leen como equivalentes, y de esas salen los fallos que
  // cuestan media tarde.
  const argumentos =
    paquete === 'node' ? [...args] : [binarioDe(paquete, ejecutable ?? paquete), ...args];

  return correr(process.execPath, argumentos, resto);
}

/**
 * Como `correrCli`, pero SIN esperar: devuelve el proceso hijo.
 *
 * Hace falta para los comandos que no terminan —un compilador en vigilancia, un
 * servidor— donde `spawnSync` bloquearia para siempre. Pasa por `node` con la
 * ruta del binario por la misma razon que la version sincrona: en Windows, un
 * `.cmd` no se lanza sin shell desde la mitigacion de CVE-2024-27980
 * (docs/incidencias/INC-006).
 *
 * @param {string} paquete  `node` para el propio Node; si no, el paquete npm.
 * @param {readonly string[]} args
 * @param {import('node:child_process').SpawnOptions & {ejecutable?: string}} [opciones]
 */
export function correrCliAsincrono(paquete, args, opciones = {}) {
  const { ejecutable, ...resto } = opciones;
  const argumentos =
    paquete === 'node' ? args : [binarioDe(paquete, ejecutable ?? paquete), ...args];

  return spawn(process.execPath, argumentos, { ...resto, shell: false });
}

/**
 * Un argumento de la linea de ordenes, en sus DOS formas: `--nombre=valor` y
 * `--nombre valor`. `undefined` si no esta.
 *
 * Los scripts operados los leen asi —no hay `commander` ni nada que instalar—,
 * y tres de ellos tenian su propia copia.
 *
 * LAS DOS FORMAS, Y NO UNA, PORQUE LAS DOS ESTABAN EN USO. Al juntar las copias
 * en P16-G se conservo solo la del `=`, y eso rompio en silencio la sintaxis que
 * `migrate:new` documenta en su propio mensaje de uso (`--name <slug>`): el
 * script decia «falta --name» con el `--name` delante. Una utilidad compartida
 * que estrecha el contrato de quien la usa no es una simplificacion: es un
 * cambio de comportamiento escondido en un refactor.
 *
 * @param {string} nombre @returns {string | undefined}
 */
export function argumento(nombre) {
  const conIgual = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  if (conIgual !== undefined) return conIgual.slice(`--${nombre}=`.length);

  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice === -1) return undefined;

  const siguiente = process.argv[indice + 1];
  return siguiente === undefined || siguiente.startsWith('--') ? undefined : siguiente;
}
