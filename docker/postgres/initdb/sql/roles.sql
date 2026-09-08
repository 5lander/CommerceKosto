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

-- Rol del BACK OFFICE (P11, ADR-017). ES EL UNICO ROL QUE PUENTEA RLS, y esa
-- frase es toda la razon por la que este bloque lleva tanto comentario.
--
-- BYPASSRLS significa que ninguna politica se le aplica: un `SELECT` suyo ve
-- todos los tenants a la vez. SPEC 1 lo eligio a sabiendas, por encima de la
-- alternativa —una cuenta de usuario dentro de cada tenant— y con tres
-- condiciones que NO son recomendaciones:
--
--   1. La conexion vive SOLO en el proceso del back office. `audit:forbidden` y
--      `audit:arch` impiden que la app cliente la importe, y una prueba de
--      integracion lo comprueba sobre el contenedor de Nest ya construido.
--   2. Pool separado del de la app cliente. Son dos procesos distintos.
--   3. Todo acceso cross-tenant en un log append-only con MOTIVO OBLIGATORIO,
--      que la base exige con un CHECK de longitud.
--
-- Lo que NO tiene, y es tan importante como lo que tiene: no es superusuario,
-- no es dueno de ninguna tabla, no puede crear roles ni bases, no hereda de
-- nadie, y sus GRANT son tabla por tabla —concedidos en la migracion de P11—,
-- nunca por DEFAULT PRIVILEGES. No tiene DELETE en ninguna tabla del sistema.
CREATE ROLE costeo_backoffice
  LOGIN PASSWORD :'backoffice_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS NOINHERIT;

-- Limites mas duros que los de la aplicacion, a proposito: el back office lo
-- usa una persona a mano, no una pantalla con miles de peticiones. Un rol que
-- lo ve todo no necesita cuarenta conexiones ni consultas largas.
ALTER ROLE costeo_backoffice SET statement_timeout                  = '30s';
ALTER ROLE costeo_backoffice SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE costeo_backoffice SET lock_timeout                        = '3s';
ALTER ROLE costeo_backoffice SET search_path                         = 'public';
ALTER ROLE costeo_backoffice CONNECTION LIMIT 4;
