/**
 * `npm run rol:backoffice` — crea `costeo_backoffice` en un cluster que YA existe.
 *
 * El ritual —comprobar, crear sin rotar la contrasena, conceder CONNECT— vive
 * en `scripts/lib/rol-de-base.mjs`, compartido con `rol:despachador`. Aqui
 * queda lo que es de ESTE rol: el bloque `CREATE ROLE`, que es el mismo que el
 * de `roles.sql` (si uno cambia, cambia el otro), y lo que se le dice a quien
 * lo ejecuta.
 */

import { crearRolSiFalta, ejecutar } from './lib/rol-de-base.mjs';

const SQL_CREAR = [
  "CREATE ROLE costeo_backoffice LOGIN PASSWORD :'clave'",
  '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;',
  "ALTER ROLE costeo_backoffice SET statement_timeout                   = '30s';",
  "ALTER ROLE costeo_backoffice SET idle_in_transaction_session_timeout = '10s';",
  "ALTER ROLE costeo_backoffice SET lock_timeout                        = '3s';",
  "ALTER ROLE costeo_backoffice SET search_path                         = 'public';",
  'ALTER ROLE costeo_backoffice CONNECTION LIMIT 4;',
].join('\n');

ejecutar(() =>
  crearRolSiFalta({
    rol: 'costeo_backoffice',
    variableDeClave: 'COSTEO_BACKOFFICE_PASSWORD',
    sqlCrear: SQL_CREAR,
    notaAlCrear: 'BYPASSRLS: ve todos los tenants (ADR-017).',
    notaFinal: 'Los privilegios de tabla los concede la migracion de P11.',
  }),
);
