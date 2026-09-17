/**
 * Ejecuta SQL con `psql`, alla donde este.
 *
 * POR QUE `psql` Y NO `prisma db execute`. Tres razones que no son negociables
 * cuando lo que se esta aplicando es la reversion de una migracion:
 *
 *   --single-transaction   el DDL del `down.sql` y el borrado de la fila de
 *                          `_prisma_migrations` son atomicos: o se revierte
 *                          todo, o no se revierte nada
 *   -v ON_ERROR_STOP=1     para en el primer error. Sin esto, un `down` a
 *                          medias deja la base en un estado que no es ni el de
 *                          antes ni el de despues
 *   -U <rol>               las migraciones corren como costeo_migrator, no
 *                          como el rol de la aplicacion
 *
 * `prisma db execute` no ofrece ninguna de las tres.
 *
 * POR QUE LA CASCADA. La maquina de desarrollo tipica de este proyecto (Windows
 * + Docker) NO tiene el cliente de PostgreSQL en el PATH. Suponer que si lo
 * tiene es un supuesto de entorno no declarado, y ademas falla justo cuando
 * alguien esta intentando deshacer algo. Ver docs/incidencias/INC-002.
 */

import { correr } from './proceso.mjs';
import { argumentosDeDocker, SERVICIO_DOCKER } from './docker.mjs';
import { RAIZ, partesDeConexion } from './entorno.mjs';

/** @type {'nativo' | 'docker' | 'ninguno' | null} */
let viaDetectada = null;

/** @param {string} comando @param {readonly string[]} args */
function hay(comando, args) {
  const resultado = correr(comando, args, { stdio: 'ignore' });
  return resultado.error === undefined && resultado.status === 0;
}

/** @returns {'nativo' | 'docker' | 'ninguno'} */
export function via() {
  if (viaDetectada !== null) return viaDetectada;
  if (hay('psql', ['--version'])) viaDetectada = 'nativo';
  else if (hay('docker', ['compose', 'version'])) viaDetectada = 'docker';
  else viaDetectada = 'ninguno';
  return viaDetectada;
}

function noHayPsql() {
  return new Error(
    [
      'No hay forma de ejecutar psql.',
      '',
      'Los scripts de migracion necesitan psql para aplicar SQL de forma atomica.',
      'Se busco de dos maneras y ninguna funciono:',
      '',
      '  1. `psql` en el PATH               -> no esta',
      '  2. `docker compose exec -T db psql` -> Docker no responde',
      '',
      'Levanta la base:  npm run db:up',
      'Ver docs/incidencias/INC-002.',
    ].join('\n'),
  );
}

/**
 * @param {{conexion: string, argumentos: readonly string[], entrada?: string, silencioso?: boolean, entorno?: Readonly<Record<string, string>>}} peticion
 * @returns {{estado: number, salida: string, error: string}}
 */
function ejecutar({ conexion, argumentos, entrada, silencioso = false, entorno = {} }) {
  const partes = partesDeConexion(conexion);
  const { comando, args } = invocacion(partes, argumentos, entorno);

  const resultado = correr(comando, args, {
    cwd: RAIZ,
    encoding: 'utf8',
    input: entrada,
    env: via() === 'nativo' ? { ...process.env, PGPASSWORD: partes.contrasena, ...entorno } : process.env,
    stdio: entrada === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  });

  const salida = typeof resultado.stdout === 'string' ? resultado.stdout : '';
  const error = typeof resultado.stderr === 'string' ? resultado.stderr : '';
  if (!silencioso && error.trim() !== '') process.stderr.write(error);

  return { estado: resultado.status ?? 1, salida, error };
}

/**
 * Arma la llamada segun la via disponible.
 *
 * `-T` es obligatorio en la variante de Docker: sin el, `docker compose exec`
 * intenta asignar un TTY y la entrada por stdin no funciona en un script no
 * interactivo.
 *
 * @param {ReturnType<typeof partesDeConexion>} partes
 * @param {readonly string[]} argumentos
 * @returns {{comando: string, args: string[]}}
 */
function invocacion(partes, argumentos, entorno = {}) {
  const modo = via();
  if (modo === 'ninguno') throw noHayPsql();

  const comunes = ['-v', 'ON_ERROR_STOP=1', '-U', partes.usuario, '-d', partes.base, ...argumentos];

  if (modo === 'nativo') {
    return { comando: 'psql', args: ['-h', partes.host, '-p', partes.puerto, ...comunes] };
  }

  return {
    comando: 'docker',
    args: argumentosDeDocker({
      herramienta: 'psql',
      contrasena: partes.contrasena,
      entorno,
      resto: comunes,
    }),
  };
}

/**
 * Aplica un archivo SQL completo en UNA transaccion.
 * @param {{conexion: string, sql: string, descripcion: string, entorno?: Readonly<Record<string, string>>}} peticion
 */
export function aplicarSql({ conexion, sql, descripcion, entorno = {} }) {
  const { estado } = ejecutar({
    conexion,
    argumentos: ['--single-transaction', '-f', '-'],
    entrada: sql,
    entorno,
  });

  if (estado !== 0) {
    throw new Error(`Fallo al aplicar ${descripcion}. La transaccion se revirtio entera.`);
  }
}

/**
 * Consulta que devuelve texto plano, sin cabeceras ni alineacion.
 *
 * `variables` es la forma SEGURA de meter un valor en el SQL, y es la misma que
 * `docker/postgres/initdb/sql/roles.sql` usa desde P0: se pasan con `-v` y se
 * referencian como `:'nombre'`, y **psql las entrecomilla y las escapa**. No es
 * escapar a mano: es delegarlo en quien sabe hacerlo.
 *
 * POR QUE ESTO Y NO INTERPOLAR EN LA CADENA. Interpolar es inyeccion SQL, y la
 * regla `no-sql-interpolado` de `audit:forbidden` lo caza. Un identificador
 * —nombre de tabla o de base— no se puede pasar asi, y la respuesta del
 * proyecto a eso es no tenerlos dinamicos, no abrir una exencion.
 *
 * OJO: las variables solo se sustituyen cuando el SQL entra por **stdin**, no
 * con `-c`. Es INC-009, y por eso esta funcion usa `-f -`.
 *
 * @param {{conexion: string, sql: string, variables?: Readonly<Record<string, string>>, entorno?: Readonly<Record<string, string>>}} peticion
 * @returns {string}
 */
export function consultar({ conexion, sql, variables = {}, entorno = {} }) {
  const declaraciones = Object.entries(variables).flatMap(([clave, valor]) => [
    '-v',
    `${clave}=${valor}`,
  ]);

  const { estado, salida, error } = ejecutar({
    conexion,
    argumentos: [...declaraciones, '-t', '-A', '-f', '-'],
    entrada: sql,
    silencioso: true,
    entorno,
  });

  if (estado !== 0) throw new Error(`Consulta fallida: ${error.trim()}`);
  return salida.trim();
}

/**
 * Vuelca el esquema de una base, normalizado para poder compararlo.
 *
 * Se conservan los privilegios a proposito (NO se pasa `--no-privileges`):
 * los GRANT y REVOKE son parte de la Barrera 1 y una migracion que los cambie
 * tiene que notarse en el diff.
 *
 * @param {{base: string, conexion: string}} peticion
 * @returns {string}
 */
export function volcarEsquema({ base, conexion }) {
  const { usuario, contrasena, host, puerto } = partesDeConexion(conexion);
  const modo = via();
  if (modo === 'ninguno') throw noHayPsql();

  const comunes = [
    '-U', usuario,
    '-d', base,
    '--schema-only',
    '--no-owner',
    '--exclude-table=public._prisma_migrations',
  ];

  const [comando, args] =
    modo === 'nativo'
      ? ['pg_dump', ['-h', host, '-p', puerto, ...comunes]]
      : ['docker', ['compose', 'exec', '-T', '-e', `PGPASSWORD=${contrasena}`, SERVICIO_DOCKER, 'pg_dump', ...comunes]];

  const resultado = correr(comando, args, {
    cwd: RAIZ,
    encoding: 'utf8',
    env: modo === 'nativo' ? { ...process.env, PGPASSWORD: contrasena } : process.env,
    maxBuffer: 64 * 1024 * 1024,
  });

  if (resultado.status !== 0) {
    throw new Error(`pg_dump fallo sobre "${base}": ${resultado.stderr ?? ''}`);
  }

  return normalizarVolcado(typeof resultado.stdout === 'string' ? resultado.stdout : '');
}

/**
 * Quita del volcado lo que cambia entre ejecuciones sin que el esquema cambie.
 * Sin esto, dos volcados de la MISMA base salen distintos y la comparacion se
 * vuelve inservible.
 *
 *   comentarios y lineas vacias  ruido de formato, varia entre versiones
 *   \restrict / \unrestrict      pg_dump 18 los emite con un nonce ALEATORIO
 *                                en cada corrida, para que un volcado no se
 *                                pueda inyectar en otro contexto de psql
 *
 * @param {string} volcado
 */
function normalizarVolcado(volcado) {
  return volcado
    .split('\n')
    .filter((linea) => !linea.startsWith('--'))
    .filter((linea) => !linea.startsWith('\\restrict') && !linea.startsWith('\\unrestrict'))
    .filter((linea) => linea.trim() !== '')
    .join('\n');
}
