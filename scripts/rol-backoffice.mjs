/**
 * `npm run rol:backoffice` — crea `costeo_backoffice` en un cluster que YA existe.
 *
 * POR QUE HACE FALTA UN SCRIPT Y NO BASTA `roles.sql`. Los roles de PostgreSQL
 * son del CLUSTER, no de la base, y `roles.sql` corre una sola vez: cuando el
 * volumen de datos esta vacio. Un cluster que ya estaba en pie —el de
 * desarrollo, y el del VPS en cuanto tenga un solo dato— no vuelve a
 * ejecutarlo nunca. Sin esto, el unico camino seria borrar el volumen.
 *
 * POR QUE NO LO CREA LA MIGRACION. `costeo_migrator` es `NOCREATEROLE`, y
 * ampliarlo seria dar capacidad de crear roles al dueno de todas las tablas
 * para ahorrarse un comando. La migracion de P11 comprueba que el rol existe y
 * **falla en alto** si no; este script es la respuesta a ese fallo.
 *
 * ES IDEMPOTENTE, y con un matiz que importa: si el rol ya existe, **no le
 * cambia la contrasena**. Un script de creacion que reescribe credenciales cada
 * vez que se ejecuta es un script que rompe produccion al correrlo por
 * costumbre. Para rotar la contrasena esta `docs/runbooks/rotacion-secretos.md`.
 *
 * La contrasena NO se genera aqui ni se imprime: sale de `COSTEO_BACKOFFICE_PASSWORD`,
 * igual que las otras dos, y viaja como variable de psql (`:'...'`), nunca
 * interpolada.
 */

import { resolve } from 'node:path';

import { RAIZ, conexionDeSuperusuario, exigir } from './lib/entorno.mjs';
import { consultar } from './lib/psql.mjs';

const SALIDA_CON_ERROR = 1;

const ROL = 'costeo_backoffice';

const SQL_EXISTE = "SELECT count(*) FROM pg_roles WHERE rolname = 'costeo_backoffice'";

/**
 * EL BLOQUE ES EL MISMO QUE `roles.sql`, y esa duplicacion es deliberada.
 *
 * La alternativa —leer `roles.sql` y ejecutarlo entero— volveria a crear
 * `costeo_migrator` y `costeo_app`, que ya existen, y fallaria. Partir el
 * archivo en tres para poder aplicar uno solo dejaria el bootstrap del
 * contenedor dependiendo de tres ficheros en orden. Aqui hay un rol y una
 * verdad, y `audit:duplication` no la ve porque son lenguajes distintos: por
 * eso este comentario dice en voz alta que si uno cambia, cambia el otro.
 */
const SQL_CREAR = [
  "CREATE ROLE costeo_backoffice LOGIN PASSWORD :'clave'",
  '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;',
  "ALTER ROLE costeo_backoffice SET statement_timeout                   = '30s';",
  "ALTER ROLE costeo_backoffice SET idle_in_transaction_session_timeout = '10s';",
  "ALTER ROLE costeo_backoffice SET lock_timeout                        = '3s';",
  "ALTER ROLE costeo_backoffice SET search_path                         = 'public';",
  'ALTER ROLE costeo_backoffice CONNECTION LIMIT 4;',
].join('\n');

/** Conectar a la base concede acceso a nada por si solo: los GRANT son de P11. */
const SQL_CONECTAR = 'GRANT CONNECT ON DATABASE :"base" TO costeo_backoffice';

function main() {
  process.loadEnvFile?.(resolve(RAIZ, '.env'));

  const clave = exigir('COSTEO_BACKOFFICE_PASSWORD');
  const base = exigir('POSTGRES_DB');
  const conexion = conexionDeSuperusuario();

  const yaEsta = consultar({ conexion, sql: SQL_EXISTE }).trim() !== '0';

  if (yaEsta) {
    process.stdout.write(`${ROL} ya existe. No se toca su contrasena.\n`);
  } else {
    consultar({ conexion, sql: SQL_CREAR, variables: { clave } });
    process.stdout.write(`${ROL} creado. BYPASSRLS: ve todos los tenants (ADR-017).\n`);
  }

  consultar({ conexion, sql: SQL_CONECTAR, variables: { base } });
  process.stdout.write(`CONNECT sobre ${base} concedido.\n`);
  process.stdout.write('Los privilegios de tabla los concede la migracion de P11.\n');
}

try {
  main();
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
}
