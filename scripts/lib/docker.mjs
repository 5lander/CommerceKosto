/**
 * Como se llama a una herramienta de PostgreSQL CUANDO NO HAY CLIENTE NATIVO.
 *
 * `psql.mjs` y `pgdump.mjs` armaban la misma invocacion de `docker compose exec`
 * cada uno por su lado, y al ganar las dos el paso de entorno se volvieron el
 * mismo bloque: `audit:duplication` lo marco. Vive aqui una vez.
 *
 * EL ENTORNO VIAJA EN LA INVOCACION, no heredado: `docker compose exec` no pasa
 * el entorno del proceso de Node, asi que cada variable necesita su `-e`.
 */

/** El servicio de compose donde vive PostgreSQL. */
export const SERVICIO_DOCKER = 'db';

/**
 * @param {{
 *   herramienta: string,
 *   contrasena: string,
 *   entorno?: Readonly<Record<string, string>>,
 *   resto: readonly string[],
 * }} peticion
 * @returns {string[]} los argumentos de `docker`
 */
export function argumentosDeDocker({ herramienta, contrasena, entorno = {}, resto }) {
  const extras = Object.entries(entorno).flatMap(([clave, valor]) => ['-e', `${clave}=${valor}`]);

  return [
    'compose', 'exec', '-T',
    '-e', `PGPASSWORD=${contrasena}`,
    ...extras,
    SERVICIO_DOCKER, herramienta,
    ...resto,
  ];
}
