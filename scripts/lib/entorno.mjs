/**
 * Entorno compartido por los scripts de migracion.
 *
 * Carga el `.env` de la raiz con `process.loadEnvFile` (nativo desde Node 20.6)
 * en vez de traer `dotenv`: cuatro lineas frente a una dependencia.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const APP = resolve(RAIZ, 'apps', 'api');
export const MIGRACIONES = resolve(APP, 'prisma', 'migrations');
export const TEMPORAL = resolve(RAIZ, '.tmp');

const ARCHIVO_ENV = resolve(RAIZ, '.env');

if (existsSync(ARCHIVO_ENV)) {
  process.loadEnvFile(ARCHIVO_ENV);
}

/**
 * Lee una variable obligatoria. Falla con un mensaje que dice que hacer, en vez
 * de propagar un `undefined` que reventara tres llamadas mas abajo.
 * @param {string} nombre
 * @returns {string}
 */
export function exigir(nombre) {
  const valor = process.env[nombre];
  if (valor === undefined || valor === '') {
    throw new Error(
      `Falta la variable de entorno ${nombre}.\n` +
        `  Copia .env.example a .env y rellenala:  cp .env.example .env`,
    );
  }
  return valor;
}

/** @param {string} nombre @param {string} porDefecto */
export function opcional(nombre, porDefecto) {
  const valor = process.env[nombre];
  return valor === undefined || valor === '' ? porDefecto : valor;
}

/**
 * Desmonta una cadena de conexion de PostgreSQL en lo que necesita `psql`.
 * @param {string} cadena
 */
export function partesDeConexion(cadena) {
  const url = new URL(cadena);
  return {
    usuario: decodeURIComponent(url.username),
    contrasena: decodeURIComponent(url.password),
    host: url.hostname,
    puerto: url.port === '' ? '5432' : url.port,
    base: url.pathname.replace(/^\//, ''),
  };
}

/**
 * La conexion de SUPERUSUARIO, apuntando a `postgres`.
 *
 * VIVE AQUI PORQUE LA NECESITAN TRES SCRIPTS —respaldo, restauracion y bench— y
 * tenerla copiada tres veces significa que el dia que cambie el nombre de la
 * variable, dos de las tres se enteran tarde. `audit:duplication` lo caza a la
 * tercera copia, que es justo para lo que esta.
 *
 * ES LA UNICA CONEXION QUE PUENTEA RLS del proyecto, y por eso no se usa nunca
 * desde la aplicacion: solo desde scripts operados a mano.
 *
 * @returns {string}
 */
export function conexionDeSuperusuario() {
  const usuario = opcional('POSTGRES_SUPERUSER', 'postgres');
  const contrasena = exigir('POSTGRES_SUPERUSER_PASSWORD');
  const credencial = `${encodeURIComponent(usuario)}:${encodeURIComponent(contrasena)}`;
  const host = opcional('POSTGRES_HOST', 'localhost');
  const puerto = opcional('POSTGRES_PORT', '5432');
  return `postgresql://${credencial}@${host}:${puerto}/postgres`;
}
