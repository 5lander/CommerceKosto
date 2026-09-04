#!/usr/bin/env node
/**
 * `npm run migrate:verify` — demuestra que las migraciones SON reversibles.
 *
 * `audit:migrations` comprueba la forma de los archivos: que exista `down.sql`,
 * que cada `CREATE POLICY` tenga su `DROP`, que el historial se borre. Eso
 * atrapa el olvido, pero no el error.
 *
 * Esto comprueba el COMPORTAMIENTO, contra bases reales, con tres pruebas:
 *
 *   1. IDA        base limpia -> todas las migraciones        = esquema A
 *   2. ESCALERA   base limpia -> todas -> down de todas       = base limpia
 *                 (si el down no deshace de verdad, aqui se ve)
 *   3. REPETICION todas -> down -> todas                      = esquema A
 *                 (atrapa el down "casi correcto": suelta la tabla pero al
 *                  volver a subir se olvida de recrear un indice)
 *
 * Y una cuarta, barata: `migrate diff --exit-code` contra `schema.prisma`, que
 * detecta la migracion editada a mano que se desincronizo del esquema.
 *
 * Las bases se crean con los MISMOS roles y privilegios que produccion
 * (`grants.sql`): comparar esquemas con privilegios distintos no probaria nada
 * sobre la Barrera 1.
 */

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { APP, RAIZ, TEMPORAL, exigir } from './lib/entorno.mjs';
import { correr, correrCli } from './lib/proceso.mjs';
import { consultar, volcarEsquema } from './lib/psql.mjs';

const BASE_IDA = 'costeo_verif_ida';
const BASE_ESCALERA = 'costeo_verif_escalera';

const conexionMigrator = exigir('MIGRATION_DATABASE_URL');

/** @param {string} base */
function conexionA(base) {
  const url = new URL(conexionMigrator);
  url.pathname = `/${base}`;
  return url.toString();
}

/** @param {readonly string[]} args @param {Record<string,string>} entorno */
function prisma(args, entorno) {
  return correrCli('prisma', args, {
    cwd: APP,
    encoding: 'utf8',
    env: { ...process.env, ...entorno },
  });
}

/**
 * Crear y borrar bases no es cosa del migrator: es NOCREATEDB a proposito.
 * Y `grants.sql` registra extensiones, que tambien exigen superusuario — igual
 * que cuando lo aplica el script de inicializacion del contenedor.
 *
 * @param {{base?: string, sql?: string, archivo?: string, variables?: Record<string, string>}} peticion
 */
function comoSuperusuario({ base = 'postgres', sql, archivo, variables = {} }) {
  const desdeArchivo = archivo !== undefined;
  const entrada = desdeArchivo ? readFileSync(archivo, 'utf8') : `${sql ?? ''}
`;
  const sustituciones = Object.entries(variables).flatMap(([clave, valor]) => ['-v', `${clave}=${valor}`]);

  // EL SQL ENTRA SIEMPRE POR STDIN CON `-f -`, NUNCA POR `-c`.
  //
  // `-c` exige una cadena "completamente parseable por el servidor, sin
  // caracteristicas propias de psql", y `:"base"` es exactamente una de ellas:
  // psql la deja tal cual y el servidor recibe `DROP DATABASE IF EXISTS :"base"`,
  // que falla con un error de sintaxis que apunta a los dos puntos. Por stdin si
  // se sustituye.
  //
  // `--single-transaction` solo para el archivo de privilegios: `DROP DATABASE`
  // y `CREATE DATABASE` no pueden ejecutarse dentro de un bloque de transaccion.
  const argumentos = [
    'compose', 'exec', '-T', 'db',
    'psql', '-v', 'ON_ERROR_STOP=1', ...sustituciones, '-U', 'postgres', '-d', base,
    ...(desdeArchivo ? ['--single-transaction'] : []),
    '-f', '-',
  ];

  const resultado = correr('docker', argumentos, { cwd: RAIZ, encoding: 'utf8', input: entrada });

  if (resultado.status !== 0) {
    throw new Error(`SQL de superusuario fallido sobre "${base}": ${String(resultado.stderr ?? '')}`);
  }
}

const GRANTS = join(RAIZ, 'docker', 'postgres', 'initdb', 'sql', 'grants.sql');

/**
 * Base limpia con EXACTAMENTE los mismos privilegios que produccion. Comparar
 * esquemas con privilegios distintos no probaria nada sobre la Barrera 1.
 *
 * El nombre de la base NO se interpola en el SQL. PostgreSQL no admite un
 * parametro donde va un identificador (`DROP DATABASE $1` es invalido), asi que
 * se usa la sustitucion de psql con `:"nombre"`, que lo entrecomilla COMO
 * IDENTIFICADOR. Es la unica forma segura, y ademas mantiene el codigo dentro
 * de la regla `no-sql-interpolado` de audit:forbidden en vez de pedirle una
 * excepcion.
 *
 * @param {string} base
 */
function recrear(base) {
  comoSuperusuario({ sql: 'DROP DATABASE IF EXISTS :"base" WITH (FORCE);', variables: { base } });
  comoSuperusuario({ sql: 'CREATE DATABASE :"base" OWNER costeo_migrator;', variables: { base } });
  comoSuperusuario({ base, archivo: GRANTS });
}

/** @param {string} base */
function eliminar(base) {
  comoSuperusuario({ sql: 'DROP DATABASE IF EXISTS :"base" WITH (FORCE);', variables: { base } });
}

/** @param {string} base */
function desplegar(base) {
  const resultado = prisma(['migrate', 'deploy'], { MIGRATION_DATABASE_URL: conexionA(base) });
  if (resultado.status !== 0) {
    throw new Error(`migrate deploy fallo sobre ${base}: ${resultado.stderr ?? resultado.stdout ?? ''}`);
  }
}

/** @param {string} base */
function revertirTodo(base) {
  const resultado = correr('node', [join(RAIZ, 'scripts', 'migrate-down.mjs'), '--all'], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, MIGRATION_DATABASE_URL: conexionA(base), NODE_ENV: 'test' },
  });
  if (resultado.status !== 0) {
    throw new Error(`migrate:down fallo sobre ${base}: ${resultado.stderr ?? resultado.stdout ?? ''}`);
  }
}

/** @param {string} base @param {string} etiqueta */
function volcar(base, etiqueta) {
  const contenido = volcarEsquema({ base, conexion: conexionA(base) });
  mkdirSync(TEMPORAL, { recursive: true });
  writeFileSync(join(TEMPORAL, `${etiqueta}.sql`), contenido);
  return contenido;
}

/**
 * @param {{titulo: string, esperado: string, obtenido: string, pista: string}} comparacion
 */
function exigirIguales({ titulo, esperado, obtenido, pista }) {
  if (esperado === obtenido) {
    console.log(`  OK  ${titulo}`);
    return;
  }

  const izquierda = esperado.split('\n');
  const derecha = obtenido.split('\n');
  const soloEsperado = izquierda.filter((linea) => !derecha.includes(linea));
  const soloObtenido = derecha.filter((linea) => !izquierda.includes(linea));

  console.error(`\n  FALLO  ${titulo}`);
  console.error(`  ${pista}\n`);
  for (const linea of soloEsperado.slice(0, 15)) console.error(`   - ${linea}`);
  for (const linea of soloObtenido.slice(0, 15)) console.error(`   + ${linea}`);
  console.error('\n  Los volcados completos estan en .tmp/ para compararlos con calma.');
  process.exit(1);
}

console.log('[migrate:verify] preparando bases limpias');
recrear(BASE_IDA);
recrear(BASE_ESCALERA);

const linaBase = volcar(BASE_ESCALERA, 'base-limpia');

console.log('[migrate:verify] 1/4  ida completa');
desplegar(BASE_IDA);
const esquemaIda = volcar(BASE_IDA, 'ida');

console.log('[migrate:verify] 2/4  escalera: ida y vuelta entera');
desplegar(BASE_ESCALERA);
revertirTodo(BASE_ESCALERA);
const trasRevertir = volcar(BASE_ESCALERA, 'tras-revertir');

exigirIguales({
  titulo: 'el down deshace exactamente lo que hizo el up',
  esperado: linaBase,
  obtenido: trasRevertir,
  pista: 'La base tras revertirlo todo deberia ser identica a una base recien inicializada.',
});

console.log('[migrate:verify] 3/4  repeticion: up -> down -> up');
desplegar(BASE_ESCALERA);
const trasRepetir = volcar(BASE_ESCALERA, 'tras-repetir');

exigirIguales({
  titulo: 'up -> down -> up es idempotente',
  esperado: esquemaIda,
  obtenido: trasRepetir,
  pista: 'Un down "casi correcto" suelta la tabla pero al volver a subir pierde algo: un indice, una politica, un privilegio.',
});

console.log('[migrate:verify] 4/4  sin deriva entre las migraciones y schema.prisma');
const deriva = prisma(
  ['migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'],
  { MIGRATION_DATABASE_URL: conexionA(BASE_ESCALERA) },
);

const CODIGO_HAY_DIFERENCIA = 2;
if (deriva.status === CODIGO_HAY_DIFERENCIA) {
  console.error('\n  FALLO  el esquema aplicado no coincide con schema.prisma');
  console.error('  Alguien edito una migracion a mano, o cambio el esquema sin generar la migracion.');
  console.error(deriva.stdout ?? '');
  process.exit(1);
}
if (deriva.status !== 0) {
  console.error(deriva.stderr ?? deriva.stdout ?? '');
  process.exit(1);
}
console.log('  OK  el esquema aplicado coincide con schema.prisma');

// Comprobacion de catalogo: no depende del formato de pg_dump, que cambia entre
// versiones. Es el respaldo de las tres comparaciones de arriba.
const sinRls = consultar({
  conexion: conexionA(BASE_ESCALERA),
  sql:
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
    "WHERE n.nspname = 'public' AND c.relkind = 'r' " +
    "AND c.relname <> '_prisma_migrations' " +
    'AND NOT (c.relrowsecurity AND c.relforcerowsecurity);',
});

if (sinRls !== '') {
  console.error(`\n  FALLO  hay tablas sin RLS forzado: ${sinRls.replaceAll('\n', ', ')}`);
  process.exit(1);
}
console.log('  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY');

eliminar(BASE_IDA);
eliminar(BASE_ESCALERA);

console.log('\n[migrate:verify] las migraciones son reversibles, verificado contra bases reales.');
