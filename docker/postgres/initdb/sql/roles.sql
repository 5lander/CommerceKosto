-- Roles de base de datos — Barrera 1 de CLAUDE.md §4.1.
--
-- La separacion de roles es la unica defensa que NO depende de la disciplina de
-- desarrollo. Las otras dos barreras (el envoltorio de transaccion-con-tenant y
-- el origen del tenant) las puede saltar alguien que se equivoque; esta no.
--
-- Y tiene un requisito que la vuelve decorativa si se incumple: la aplicacion
-- NO puede conectarse como superusuario ni como duena de las tablas, porque un
-- superusuario ignora RLS por diseno. `test/integracion/roles-de-base-de-datos`
-- lo verifica en cada corrida.

\set ON_ERROR_STOP on

-- Rol de MIGRACIONES: dueno del esquema y de las tablas. No superusuario.
CREATE ROLE costeo_migrator
  LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

-- Rol de la APLICACION: sujeto a RLS, sin DDL, sin propiedad, sin membresias.
CREATE ROLE costeo_app
  LOGIN PASSWORD :'app_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;

-- costeo_app NO es miembro de costeo_migrator ni de ningun rol pg_*.
-- Sin membresias no hereda privilegios por la puerta de atras.

-- Limites de sesion en la propia base (AUDITORIA C25, SEGURIDAD.md §7).
-- Puestos en el ROL y no en la cadena de conexion: asi valen aunque alguien
-- se conecte con otro cliente.
ALTER ROLE costeo_app SET statement_timeout                  = '15s';
ALTER ROLE costeo_app SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE costeo_app SET lock_timeout                        = '3s';
ALTER ROLE costeo_app SET search_path                         = 'public';
ALTER ROLE costeo_app CONNECTION LIMIT 40;

-- Las migraciones necesitan mas margen: un indice sobre una tabla grande tarda.
ALTER ROLE costeo_migrator SET statement_timeout = '10min';
ALTER ROLE costeo_migrator SET lock_timeout      = '10s';
ALTER ROLE costeo_migrator SET search_path       = 'public';
ALTER ROLE costeo_migrator CONNECTION LIMIT 4;

-- `costeo_backoffice` (docs/sistema/seguridad.md) NO se crea aqui. Un rol con
-- login y contrasena que nadie usa es superficie de ataque sin contrapartida:
-- se crea en P11, con su propio ADR. El nombre queda reservado.
