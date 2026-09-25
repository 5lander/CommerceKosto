/**
 * `npm run rol:despachador` — crea `costeo_despachador` en un cluster que YA existe.
 *
 * Es el rol del proceso que entrega los correos de `email_outbox` (P16-A1,
 * ADR-025). A diferencia del back office NO puentea RLS: lo que ve —la cola y
 * los contadores del limite de tasa— lo ve por una politica permisiva sobre
 * exactamente dos tablas, y sobre el resto no tiene ni SELECT. Dos conexiones
 * bastan: una pasada es una transaccion corta con `FOR UPDATE SKIP LOCKED`.
 *
 * El ritual compartido esta en `scripts/lib/rol-de-base.mjs`. El bloque
 * `CREATE ROLE` es el mismo que el de `roles.sql`: si uno cambia, cambia el otro.
 */

import { crearRolSiFalta, ejecutar } from './lib/rol-de-base.mjs';

const SQL_CREAR = [
  "CREATE ROLE costeo_despachador LOGIN PASSWORD :'clave'",
  '  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;',
  "ALTER ROLE costeo_despachador SET statement_timeout                   = '30s';",
  "ALTER ROLE costeo_despachador SET idle_in_transaction_session_timeout = '10s';",
  "ALTER ROLE costeo_despachador SET lock_timeout                        = '3s';",
  "ALTER ROLE costeo_despachador SET search_path                         = 'public';",
  'ALTER ROLE costeo_despachador CONNECTION LIMIT 2;',
].join('\n');

ejecutar(() =>
  crearRolSiFalta({
    rol: 'costeo_despachador',
    variableDeClave: 'COSTEO_DESPACHADOR_PASSWORD',
    sqlCrear: SQL_CREAR,
    notaAlCrear: 'NOBYPASSRLS: solo ve email_outbox y rate_limit_hit (ADR-025).',
    notaFinal: 'Los privilegios de tabla los concede la migracion de P16-A1.',
  }),
);
