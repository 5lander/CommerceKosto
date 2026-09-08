/**
 * `pg_dump` y `pg_restore` en formato personalizado, alla donde esten.
 *
 * Misma cascada que `psql.mjs` y por la misma razon (INC-002): la maquina de
 * desarrollo tipica de este proyecto no tiene el cliente de PostgreSQL en el
 * PATH, y suponer que si lo tiene falla justo el dia que hay que restaurar.
 *
 * FORMATO PERSONALIZADO (`-Fc`) Y NO SQL PLANO, por tres cosas que un `.sql` no
 * da y que importan cuando lo que se restaura es el libro de un cliente:
 *
 *   comprimido        un volcado de texto de una base con dos anos de
 *                     movimientos ocupa varias veces mas, y el respaldo viaja
 *   `pg_restore -l`   se puede LISTAR el contenido sin restaurarlo, que es la
 *                     comprobacion barata de que el archivo no esta truncado
 *   restauracion
 *   selectiva         se puede sacar una sola tabla sin tocar el resto
 *
 * NO SE USA `--no-owner` NI `--no-privileges`, al contrario que en el volcado de
 * esquema de `psql.mjs`. Alli se comparan esquemas y el dueno es ruido; aqui se
 * restaura de verdad, y los GRANT y el dueno de cada tabla **son la Barrera 1**.
 * Un respaldo que restaura las tablas con otro dueno deja `costeo_app` pudiendo
 * hacer lo que no debe, y nadie se entera hasta que hay una fuga.
 */

import { correr } from './proceso.mjs';
import { RAIZ, partesDeConexion } from './entorno.mjs';
import { via } from './psql.mjs';

const SERVICIO_DOCKER = 'db';

/** El volcado de una base con dos anos de movimientos no cabe en el buffer por defecto. */
const BUFFER_MAXIMO = 512 * 1024 * 1024;

/**
 * Arma la invocacion de una herramienta de PostgreSQL segun la via disponible.
 *
 * @param {{herramienta: string, partes: ReturnType<typeof partesDeConexion>, args: readonly string[]}} peticion
 * @returns {{comando: string, args: string[], entorno: NodeJS.ProcessEnv}}
 */
function invocacion({ herramienta, partes, args }) {
  const modo = via();
  if (modo === 'ninguno') {
    throw new Error(
      `No hay forma de ejecutar ${herramienta}: no esta en el PATH y Docker no responde.\n` +
        'Levanta la base con `npm run db:up`, o instala el cliente de PostgreSQL.\n' +
        'Ver docs/incidencias/INC-002.',
    );
  }

  if (modo === 'nativo') {
    return {
      comando: herramienta,
      args: ['-h', partes.host, '-p', partes.puerto, '-U', partes.usuario, ...args],
      entorno: { ...process.env, PGPASSWORD: partes.contrasena },
    };
  }

  return {
    comando: 'docker',
    args: [
      'compose', 'exec', '-T',
      '-e', `PGPASSWORD=${partes.contrasena}`,
      SERVICIO_DOCKER, herramienta,
      '-U', partes.usuario, ...args,
    ],
    entorno: process.env,
  };
}

/**
 * Vuelca la base entera a un Buffer, en formato personalizado.
 *
 * Se vuelca **como superusuario**, y no como el migrator, a proposito: RLS con
 * `FORCE` aplica tambien al dueno de la tabla, asi que un volcado hecho por
 * `costeo_migrator` saldria filtrado por sus politicas. Sus politicas hoy dicen
 * `USING (true)` y no filtrarian nada — pero eso es una coincidencia afortunada,
 * no una garantia, y un respaldo silenciosamente incompleto es la peor clase de
 * respaldo que existe.
 *
 * @param {{conexion: string}} peticion
 * @returns {Buffer}
 */
export function volcar({ conexion }) {
  const partes = partesDeConexion(conexion);
  const { comando, args, entorno } = invocacion({
    herramienta: 'pg_dump',
    partes,
    args: ['-d', partes.base, '--format=custom', '--compress=9'],
  });

  const resultado = correr(comando, args, {
    cwd: RAIZ,
    env: entorno,
    maxBuffer: BUFFER_MAXIMO,
    // Sin `encoding`: la salida es BINARIA. Pedirla como utf8 la corrompe en
    // silencio y el archivo resultante no se puede restaurar — que es un fallo
    // que solo se descubre el dia que hace falta.
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (resultado.status !== 0) {
    const detalle = resultado.stderr instanceof Buffer ? resultado.stderr.toString('utf8') : '';
    throw new Error(`pg_dump fallo sobre "${partes.base}": ${detalle}`);
  }

  return Buffer.isBuffer(resultado.stdout) ? resultado.stdout : Buffer.from('');
}

/**
 * Ejecuta `pg_restore` sobre un volcado que llega por stdin.
 *
 * Lo comparten `listar` y `restaurar`: se diferencian en los argumentos y en el
 * mensaje del fallo, no en como se lanza el proceso. Escribirlo dos veces era el
 * clon que `audit:duplication` paro.
 *
 * @param {{volcado: Buffer, conexion: string, args: readonly string[], queFallo: string}} peticion
 * @returns {string}
 */
function conPgRestore({ volcado, conexion, args, queFallo }) {
  const partes = partesDeConexion(conexion);
  const invocado = invocacion({ herramienta: 'pg_restore', partes, args });

  const resultado = correr(invocado.comando, invocado.args, {
    cwd: RAIZ,
    env: invocado.entorno,
    input: volcado,
    encoding: 'utf8',
    maxBuffer: BUFFER_MAXIMO,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (resultado.status !== 0) {
    throw new Error(`${queFallo}: ${String(resultado.stderr ?? '')}`);
  }

  return typeof resultado.stdout === 'string' ? resultado.stdout : '';
}

/**
 * Lista el contenido de un volcado SIN restaurarlo.
 *
 * Es la comprobacion barata: si el archivo esta truncado o corrupto,
 * `pg_restore -l` falla aqui, en segundos, en vez de a mitad de una
 * restauracion de verdad.
 *
 * @param {{volcado: Buffer, conexion: string}} peticion
 * @returns {string}
 */
export function listar({ volcado, conexion }) {
  return conPgRestore({
    volcado,
    conexion,
    args: ['--list'],
    queFallo: 'El volcado no se puede leer',
  });
}

/**
 * Restaura un volcado sobre una base que ya existe.
 *
 * `--exit-on-error` es obligatorio y no es una preferencia: sin el,
 * `pg_restore` sigue adelante tras un error y termina con codigo 0, dejando una
 * base a la que le faltan tablas y un script que cree que todo fue bien. Es
 * exactamente la forma de fallo de INC-007, aplicada a lo que menos perdona.
 *
 * @param {{volcado: Buffer, conexion: string, base: string}} peticion
 */
export function restaurar({ volcado, conexion, base }) {
  conPgRestore({
    volcado,
    conexion,
    args: ['-d', base, '--exit-on-error', '--no-comments'],
    queFallo: `La restauracion sobre "${base}" fallo`,
  });
}
