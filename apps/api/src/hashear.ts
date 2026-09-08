/**
 * `node dist/hashear.js` — lee una contraseña por la entrada estándar y escribe
 * su hash Argon2id por la salida.
 *
 * **EXISTE PARA QUE EL SEED DEL TENANT NO DUPLIQUE LOS PARÁMETROS DE ARGON2.**
 * `Argon2Hasher` los fija explícitamente y no usa los de la librería —64 MiB, 3
 * pasadas, 1 hilo—, con su razón escrita. Un script de operación que hasheara
 * por su cuenta tendría que copiarlos, y el día que uno de los dos cambiara
 * habría usuarios sembrados con un coste distinto al que el login espera:
 * `necesitaRehash` los marcaría a todos, y nadie sabría por qué.
 *
 * Así el hash lo produce **exactamente el mismo código** que después lo
 * verifica. No hay dos fuentes de verdad porque no hay dos.
 *
 * **LA CONTRASEÑA ENTRA POR STDIN Y NO POR ARGUMENTO**, a propósito: los
 * argumentos de un proceso son visibles en `ps` para cualquier usuario de la
 * máquina, y esto se ejecuta en el VPS de producción.
 *
 * Se ejecuta desde `dist/`, nunca desde el fuente (INC-017).
 */

import 'reflect-metadata';

import { Argon2Hasher } from './modules/iam/infrastructure/argon2-hasher';

const SALIDA_CON_ERROR = 1;

/**
 * Se acumula el texto y no los buffers: `process.stdin` entrega `Buffer<any>` y
 * concatenarlos obliga a un ensanchamiento de tipo que el linter rechaza, con
 * razón. Una contraseña es corta y cabe en memoria como cadena sin más.
 */
async function leerEntrada(): Promise<string> {
  process.stdin.setEncoding('utf8');

  let texto = '';
  for await (const trozo of process.stdin) texto += String(trozo);
  return texto.trim();
}

async function main(): Promise<void> {
  const contrasena = await leerEntrada();
  if (contrasena === '') throw new Error('No llegó ninguna contraseña por la entrada estándar.');

  process.stdout.write(`${await new Argon2Hasher().hash(contrasena)}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
});
