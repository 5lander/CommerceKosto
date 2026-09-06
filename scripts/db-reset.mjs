#!/usr/bin/env node
/**
 * `npm run db:reset` — vacia la base de DESARROLLO y reaplica las migraciones.
 *
 * POR QUE HACE FALTA UN SCRIPT PARA ESTO, Y POR QUE NO PUEDE SER UN `DELETE`.
 *
 * Las pruebas de integracion siembran y no limpian. Las tres de rendimiento
 * —costeo, inventario y conteo— crean cientos de miles de filas en CADA
 * corrida, y la base local crece hasta que el interceptor de timeout de 2 s
 * empieza a tumbar peticiones de forma intermitente. Es INC-014.
 *
 * Y limpiar por company NO ES POSIBLE, ni siquiera con el rol dueno:
 *
 *     ERROR: La tabla inventory_movement es append-only: DELETE rechazado.
 *
 * Eso no es un obstaculo que sortear: es R3 haciendo su trabajo en las tres
 * capas (privilegio, trigger de SENTENCIA y `audit:forbidden`). El libro de
 * inventario y `audit_log` no se pueden vaciar por diseno, asi que la unica
 * limpieza posible es **tirar el esquema entero y reconstruirlo**.
 *
 * Efecto colateral util: cada reset vuelve a ejercitar la ida completa de las
 * nueve migraciones sobre una base vacia.
 *
 * POR QUE VACIA EL ESQUEMA EN VEZ DE TIRARLO.
 *
 * `DROP SCHEMA public CASCADE` es lo obvio y esta MAL por dos razones:
 *
 *   1. `costeo_migrator` es dueno del ESQUEMA, no de la base. No tiene
 *      `CREATE` sobre la base, asi que no puede volver a crear `public`.
 *      Eso es P0 haciendo su trabajo, no un permiso que falte.
 *   2. `pg_stat_statements` y `pg_trgm` viven EN `public`, y el primero lo
 *      crea `initdb` como SUPERUSUARIO. Tirar el esquema se lo lleva, y el
 *      migrator no puede recrearlo: la base se quedaria sin la observabilidad
 *      que CLAUDE.md §5 exige, y solo se recuperaria borrando el volumen.
 *
 * Asi que se borran las TABLAS y las RUTINAS propias, saltando todo lo que
 * pertenece a una extension (`pg_depend.deptype = 'e'`). Los indices, las
 * secuencias, los triggers y las politicas RLS se van con su tabla, y
 * `_prisma_migrations` cae en el mismo barrido, que es lo que hace que
 * `migrate deploy` reaplique las nueve desde cero.
 *
 * Efecto colateral util de conservar el esquema: los `DEFAULT PRIVILEGES` de
 * `grants.sql` cuelgan de el y sobreviven, asi que no hay que restaurarlos —
 * ni existe el riesgo de restaurarlos con valores que se hayan desviado.
 *
 * NO TOCA NADA SIN CONFIRMACION EXPLICITA. Exige `--si` en la linea de
 * comandos, y se niega si `NODE_ENV` es `production` o si la cadena de
 * conexion no apunta a localhost. Un script que vacia una base no puede
 * ejecutarse por autocompletado.
 */

import { APP, exigir, partesDeConexion } from './lib/entorno.mjs';
import { correrCli } from './lib/proceso.mjs';
import { aplicarSql, consultar } from './lib/psql.mjs';

const LOCALES = new Set(['localhost', '127.0.0.1', '::1']);

/** @param {string} conexion */
function exigirBaseLocal(conexion) {
  const { host } = partesDeConexion(conexion);

  if (process.env['NODE_ENV'] === 'production') {
    throw new Error('db:reset no se ejecuta con NODE_ENV=production.');
  }
  if (!LOCALES.has(host)) {
    throw new Error(
      `db:reset solo actua sobre una base local. La conexion apunta a "${host}".`,
    );
  }
}

function exigirConfirmacion() {
  if (!process.argv.includes('--si')) {
    console.error('db:reset BORRA TODOS LOS DATOS de la base de desarrollo.');
    console.error('Si es lo que quieres:  npm run db:reset -- --si');
    process.exit(1);
  }
}

const conexion = exigir('MIGRATION_DATABASE_URL');
exigirBaseLocal(conexion);
exigirConfirmacion();

const antes = consultar({
  conexion,
  sql: "SELECT pg_size_pretty(pg_database_size(current_database()))",
});
console.log(`[db:reset] tamano antes: ${antes.trim()}`);

// El filtro por `pg_depend.deptype = 'e'` es el que salva las extensiones: sin
// el, este barrido se lleva las funciones de `pg_trgm` y las vistas de
// `pg_stat_statements`, y ninguna se puede recrear sin superusuario.
//
// Las tablas van primero: al caer arrastran sus triggers, y solo entonces las
// funciones que esos triggers usaban quedan libres para el segundo bucle.
aplicarSql({
  conexion,
  sql: `
DO $$
DECLARE objeto text;
BEGIN
  FOR objeto IN
    SELECT format('%I.%I', n.nspname, c.relname)
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE 'DROP TABLE IF EXISTS ' || objeto || ' CASCADE';
  END LOOP;

  FOR objeto IN
    SELECT p.oid::regprocedure::text
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
       )
  LOOP
    EXECUTE 'DROP ROUTINE IF EXISTS ' || objeto || ' CASCADE';
  END LOOP;
END $$;
`,
  descripcion: 'vaciado del esquema public',
});

console.log('[db:reset] esquema vaciado; aplicando migraciones');
const migracion = correrCli('prisma', ['migrate', 'deploy'], { cwd: APP, stdio: 'inherit' });

// `correrCli` devuelve el resultado de `spawnSync`; no lanza. Sin esta
// comprobacion, un `migrate deploy` fallido dejaria la base VACIA y el script
// diciendo "listo", que es peor que el problema que viene a resolver.
if (migracion.status !== 0) {
  throw new Error('db:reset vacio el esquema pero `migrate deploy` fallo. La base esta vacia.');
}

const despues = consultar({
  conexion,
  sql: "SELECT pg_size_pretty(pg_database_size(current_database()))",
});
console.log(`[db:reset] listo. Tamano despues: ${despues.trim()}`);
