#!/usr/bin/env node
/**
 * `npm run migrate:new -- --name <slug>` — crea una migracion REVERSIBLE.
 *
 * Prisma Migrate no genera migraciones de bajada, y `AUDITORIA.md` D1 las
 * exige. Este script construye el mecanismo de ADR-004.
 *
 * EL ORDEN ES LO QUE IMPORTA, y es donde casi todo el mundo se equivoca:
 *
 *   1. verificar que no hay migraciones pendientes
 *   2. generar el down.sql  <- ANTES de crear la migracion de subida
 *   3. crear la migracion con --create-only
 *   4. mover el down.sql a su carpeta
 *   5. insertar los marcadores de bloque manual
 *   6. anadir el DELETE de la fila del historial
 *
 * Si el paso 2 se hace DESPUES del 3, el estado de origen y el de destino ya
 * son identicos y el diff sale, correctamente, VACIO. Esa es la variante
 * silenciosa del problema: la migracion se commitea con un `down` que no
 * deshace nada y no se descubre hasta que alguien intenta revertir en
 * produccion. Ver docs/incidencias/INC-004.
 *
 * Se usa `--to-migrations` (el directorio) y no `--to-config-datasource` (la
 * base de desarrollo) a proposito: asi el down.sql no depende del estado de la
 * maquina de nadie y se reproduce igual en CI. Es la diferencia entre un
 * artefacto revisable y uno que depende de que tenia cada quien en su Docker.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP, MIGRACIONES, TEMPORAL } from './lib/entorno.mjs';
import { correrCli } from './lib/proceso.mjs';

const MARCADOR_MANUAL = [
  '',
  '-- ===== MANUAL: BEGIN =====',
  '-- Lo que Prisma no sabe declarar y este proyecto exige:',
  '--   ALTER TABLE ... ENABLE ROW LEVEL SECURITY;',
  '--   ALTER TABLE ... FORCE  ROW LEVEL SECURITY;',
  '--   CREATE POLICY ...;',
  '--   GRANT / REVOKE, CHECK, triggers.',
  '-- audit:migrations M6 falla si una tabla nueva no trae ENABLE + FORCE + POLICY.',
  '-- ===== MANUAL: END =====',
  '',
].join('\n');

/** Lo que Prisma produce como nombre de carpeta: 14 digitos y un slug. */
const NOMBRE_DE_MIGRACION = /^\d{14}_[a-z][a-z0-9_]*$/;

/**
 * Genera la sentencia que borra la fila del historial.
 *
 * El nombre se VALIDA contra un patron cerrado antes de incrustarlo. No es un
 * parametro porque el resultado es un archivo `.sql` que se lee y se revisa,
 * no una consulta que se ejecute con valores de usuario — pero validar cuesta
 * una linea y quita la duda.
 *
 * @param {string} carpeta
 */
function borradoDelHistorial(carpeta) {
  if (!NOMBRE_DE_MIGRACION.test(carpeta)) {
    throw new Error(`Nombre de migracion inesperado: "${carpeta}".`);
  }
  const sentencia = 'DELETE FROM "_prisma_migrations" WHERE "migration_name" = ';
  return `${sentencia}'${carpeta}';`;
}

/** @param {string} nombre */
function argumento(nombre) {
  const indice = process.argv.indexOf(`--${nombre}`);
  if (indice === -1) return undefined;
  return process.argv[indice + 1];
}

/** @param {readonly string[]} args */
function prisma(args) {
  return correrCli('prisma', args, { cwd: APP, encoding: 'utf8', stdio: 'pipe' });
}

const nombre = argumento('name');
if (nombre === undefined || !/^[a-z][a-z0-9_]*$/.test(nombre)) {
  console.error('Uso: npm run migrate:new -- --name <slug_en_minusculas>');
  process.exit(1);
}

// --- 1. No debe haber migraciones pendientes ------------------------------
const estado = prisma(['migrate', 'status']);
const salidaEstado = typeof estado.stdout === 'string' ? estado.stdout : '';
if (/following migrations? have not yet been applied|Following migration/i.test(salidaEstado)) {
  console.error('\nHay migraciones sin aplicar. Aplicalas antes de crear una nueva:');
  console.error('  npm run migrate:deploy\n');
  process.exit(1);
}

// --- 2. El down.sql, ANTES de crear la migracion de subida -----------------
mkdirSync(TEMPORAL, { recursive: true });
const downTemporal = join(TEMPORAL, 'down.sql');

/**
 * La PRIMERA migracion no tiene estado anterior al que volver: el directorio
 * `prisma/migrations` todavia no existe y `--to-migrations` falla con
 * "missing migration_lock.toml". Su reverso es el vacio.
 */
const hayMigracionesPrevias = existsSync(join(MIGRACIONES, 'migration_lock.toml'));
const destino = hayMigracionesPrevias
  ? ['--to-migrations', 'prisma/migrations']
  : ['--to-empty'];

console.log(
  hayMigracionesPrevias
    ? '[migrate:new] generando down.sql (esquema nuevo -> estado de las migraciones actuales)'
    : '[migrate:new] primera migracion: generando down.sql (esquema nuevo -> vacio)',
);

const diff = prisma([
  'migrate', 'diff',
  '--from-schema', 'prisma/schema.prisma',
  ...destino,
  '--script',
  '--output', downTemporal,
]);

if (diff.status !== 0) {
  console.error(diff.stderr ?? diff.stdout ?? '');
  console.error('\n[migrate:new] `migrate diff` fallo. Ver docs/incidencias/INC-004.');
  process.exit(1);
}

// --- 3. Crear la migracion de subida ---------------------------------------
console.log(`[migrate:new] creando la migracion "${nombre}"`);
const creada = prisma(['migrate', 'dev', '--name', nombre, '--create-only']);
if (creada.status !== 0) {
  console.error(creada.stderr ?? creada.stdout ?? '');
  process.exit(1);
}

const carpetas = readdirSync(MIGRACIONES).filter((d) => d.endsWith(`_${nombre}`)).sort();
const carpeta = carpetas.at(-1);
if (carpeta === undefined) {
  console.error('[migrate:new] no se encontro la carpeta de la migracion recien creada.');
  process.exit(1);
}

// --- 4, 5 y 6 ---------------------------------------------------------------
const destinoDown = join(MIGRACIONES, carpeta, 'down.sql');
renameSync(downTemporal, destinoDown);

const rutaUp = join(MIGRACIONES, carpeta, 'migration.sql');
writeFileSync(rutaUp, `${readFileSync(rutaUp, 'utf8').trimEnd()}\n${MARCADOR_MANUAL}`);

const down = readFileSync(destinoDown, 'utf8').trimEnd();
writeFileSync(
  destinoDown,
  [
    '-- ===== MANUAL-REVERSE: BEGIN =====',
    '-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que',
    '-- cuelga de una tabla antes de quitar la tabla.',
    '-- ===== MANUAL-REVERSE: END =====',
    '',
    '-- ===== PRISMA (migrate diff) =====',
    down,
    '',
    '-- ===== HISTORIAL =====',
    '-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta',
    '-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la',
    '-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.',
    borradoDelHistorial(carpeta),
    '',
  ].join('\n'),
);

console.log(`\n[migrate:new] listo: prisma/migrations/${carpeta}/`);
console.log('  1. edita migration.sql   -> el bloque MANUAL (RLS, GRANT, triggers)');
console.log('  2. edita down.sql        -> el bloque MANUAL-REVERSE, en espejo');
console.log('  3. npm run audit:migrations');
console.log('  4. npm run migrate:deploy');
console.log('  5. npm run migrate:verify\n');

if (!existsSync(destinoDown)) process.exit(1);
