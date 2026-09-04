/**
 * Configuracion del CLI de Prisma (Prisma 7 — ver ADR-001).
 *
 * AQUI ES DONDE SE CLAVA LA SEPARACION DE ROLES, y es lo mas importante de este
 * archivo. El CLI —`migrate dev`, `migrate deploy`, `migrate diff`, `db pull`—
 * usa SIEMPRE `MIGRATION_DATABASE_URL`, es decir el rol `costeo_migrator`, que
 * es el dueno de las tablas.
 *
 * El RUNTIME nunca pasa por aqui: recibe su cadena explicitamente en
 * `createPrismaClient(databaseUrl)` y se conecta como `costeo_app`, que no es
 * superusuario, no es dueno de nada y esta sujeto a RLS. El cliente generado no
 * lleva ningun nombre de variable de entorno embebido, asi que no hay forma de
 * que el proceso de la aplicacion acabe migrando por accidente.
 *
 * Esa separacion es la Barrera 1 de CLAUDE.md §4.1, y es la unica que no
 * depende de que nadie se equivoque.
 */

import { resolve } from 'node:path';

import { defineConfig } from 'prisma/config';

/**
 * Carga el `.env` de la RAIZ del monorepo, que es donde vive.
 *
 * Se usa `process.loadEnvFile` de Node en vez de `dotenv`: es nativo desde Node
 * 20.6 y ahorra una dependencia para cuatro lineas (CLAUDE.md §3). Prisma 7 ya
 * no carga `.env` por su cuenta, asi que hay que hacerlo explicitamente.
 *
 * Si el archivo no existe no es un error: en CI y en produccion las variables
 * vienen del entorno o del gestor de secretos, nunca de un archivo.
 */
try {
  process.loadEnvFile(resolve(import.meta.dirname, '..', '..', '.env'));
} catch {
  // Sin .env: se usan las variables que ya esten en el entorno.
}

/**
 * POR QUE UN MARCADOR Y NO EL `env()` DE PRISMA.
 *
 * `env('X')` resuelve al CARGAR la configuracion y lanza si la variable falta,
 * lo que rompe TODOS los comandos del CLI por igual — incluido `prisma
 * generate`, que no se conecta a ninguna base. Consecuencia practica: un clon
 * recien hecho, sin `.env` todavia, no puede ni generar el cliente, y el
 * `npm install` falla con un error que habla de una variable de conexion.
 *
 * El marcador conserva lo unico que importaba de aquel comportamiento —que
 * nadie se conecte por accidente a una base equivocada— y ademas DICE cual es
 * el problema: cualquier intento real de conectar falla contra un host llamado
 * `falta-MIGRATION-DATABASE-URL`, que es su propio diagnostico. Los comandos
 * que no necesitan conexion siguen funcionando.
 */
function exigida(variable: 'MIGRATION_DATABASE_URL' | 'SHADOW_DATABASE_URL'): string {
  const nombreComoHost = variable.toLowerCase().replaceAll('_', '-');
  return process.env[variable] ?? `postgresql://revisa-tu-env@falta-${nombreComoHost}:1/ninguna`;
}

export default defineConfig({
  schema: 'prisma/schema.prisma',

  migrations: {
    path: 'prisma/migrations',
  },

  datasource: {
    // El CLI, y solo el CLI, es costeo_migrator.
    url: exigida('MIGRATION_DATABASE_URL'),

    // Base sombra que `migrate dev` y `migrate diff --to-migrations` necesitan.
    // La crea el script de inicializacion del contenedor: `costeo_migrator` es
    // NOCREATEDB y no puede crearla al vuelo. Ver docs/incidencias/INC-004.
    shadowDatabaseUrl: exigida('SHADOW_DATABASE_URL'),
  },
});
