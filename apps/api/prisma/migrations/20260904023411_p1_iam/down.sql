-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.
--
-- Las politicas de las tablas que este down elimina desapareceran solas con el
-- DROP TABLE. Se retiran igual, una a una, por dos razones: `audit:migrations`
-- M3 exige la simetria explicita, y el dia que una de estas tablas SOBREVIVA a
-- un down —como le pasa aqui a `audit_log`— el olvido dejaria una politica
-- huerfana apuntando a una funcion que ya no existe.

-- La politica que P1 anadio a `audit_log`, que NO desaparece con este down
-- porque la tabla es de P0 y se queda.
DROP POLICY IF EXISTS "audit_log_app_inserta_tenant" ON "audit_log";

-- Las politicas de las tablas de P1.
DROP POLICY IF EXISTS "company_app" ON "company";
DROP POLICY IF EXISTS "company_migrator" ON "company";
DROP POLICY IF EXISTS "company_settings_app" ON "company_settings";
DROP POLICY IF EXISTS "company_settings_migrator" ON "company_settings";
DROP POLICY IF EXISTS "location_app" ON "location";
DROP POLICY IF EXISTS "location_migrator" ON "location";
DROP POLICY IF EXISTS "app_user_app" ON "app_user";
DROP POLICY IF EXISTS "app_user_migrator" ON "app_user";
DROP POLICY IF EXISTS "user_role_app" ON "user_role";
DROP POLICY IF EXISTS "user_role_migrator" ON "user_role";
DROP POLICY IF EXISTS "session_app" ON "session";
DROP POLICY IF EXISTS "session_migrator" ON "session";
DROP POLICY IF EXISTS "login_attempt_app" ON "login_attempt";
DROP POLICY IF EXISTS "login_attempt_migrator" ON "login_attempt";
DROP POLICY IF EXISTS "company_status_lectura" ON "company_status";
DROP POLICY IF EXISTS "company_status_migrator" ON "company_status";
DROP POLICY IF EXISTS "location_type_lectura" ON "location_type";
DROP POLICY IF EXISTS "location_type_migrator" ON "location_type";
DROP POLICY IF EXISTS "location_status_lectura" ON "location_status";
DROP POLICY IF EXISTS "location_status_migrator" ON "location_status";
DROP POLICY IF EXISTS "user_status_lectura" ON "user_status";
DROP POLICY IF EXISTS "user_status_migrator" ON "user_status";
DROP POLICY IF EXISTS "role_lectura" ON "role";
DROP POLICY IF EXISTS "role_migrator" ON "role";
DROP POLICY IF EXISTS "permission_lectura" ON "permission";
DROP POLICY IF EXISTS "permission_migrator" ON "permission";
DROP POLICY IF EXISTS "role_permission_lectura" ON "role_permission";
DROP POLICY IF EXISTS "role_permission_migrator" ON "role_permission";

-- RLS: se desactiva en espejo. Sin esto, una tabla que el down NO elimine
-- quedaria con RLS activo y sin ninguna politica, es decir, invisible para todo
-- el mundo — un "deny by default" sin puerta.
ALTER TABLE "company" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "company" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "location" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "location" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_user" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_role" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_role" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "session" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "session" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempt" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "login_attempt" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "company_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "company_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "location_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "location_type" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "location_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "location_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "user_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "user_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "role" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "permission" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "permission" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permission" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "role_permission" DISABLE ROW LEVEL SECURITY;

-- LOS TIPOS DE EVENTO QUE P1 SEMBRO **NO SE BORRAN**, y esta es la parte de
-- este archivo que costo una tarde entenderla.
--
-- El primer intento los borraba. Fallo sobre la base de desarrollo con
-- "violates RESTRICT setting of foreign key constraint": ya habia eventos de
-- login registrados apuntando a esos tipos, y la clave foranea de `audit_log`
-- es `ON DELETE RESTRICT` a proposito — borrar el tipo de un evento registrado
-- dejaria la fila de auditoria sin significado.
--
-- El segundo intento anadio `AND NOT EXISTS (SELECT 1 FROM audit_log ...)` para
-- borrar solo los que nadie usa. Fallo IGUAL, y por una razon que conviene
-- tener presente en todo el proyecto: `costeo_migrator` no tiene politica de
-- SELECT sobre `audit_log` —solo de INSERT—, asi que con `FORCE ROW LEVEL
-- SECURITY` la subconsulta ve CERO filas siempre y el `NOT EXISTS` es cierto
-- siempre. La comprobacion parecia existir y no comprobaba nada; la clave
-- foranea, que la evalua el motor y no pasa por RLS, si vio las filas.
--
--   UNA GUARDA `NOT EXISTS` VALE LO QUE VALGA EL ACCESO DE LECTURA DEL ROL QUE
--   LA EJECUTA. Bajo RLS, "no hay filas" y "no puedo verlas" son la misma
--   respuesta.
--
-- Se descarto darle SELECT al migrator: SEGURIDAD.md §10 reserva la lectura del
-- log al back office, y ampliar el acceso para que funcione una migracion de
-- vuelta es exactamente el atajo que este proyecto no toma.
--
-- La decision: el catalogo que sostiene evidencia de auditoria es append-only,
-- igual que la evidencia. Quedan quince filas de datos de referencia sin usar,
-- que no molestan a nadie, y el rastro intacto. El `ON CONFLICT DO NOTHING` del
-- up cierra el circulo: `up -> down -> up` funciona con datos dentro, no solo
-- en vacio. Ver docs/incidencias/INC-011.

-- El indice unico parcial del OWNER. Se elimina con la tabla, pero vale la
-- misma razon que para las politicas: explicito y en espejo.
DROP INDEX IF EXISTS "user_role_owner_unico_por_company";
DROP INDEX IF EXISTS "user_role_unico_sin_ubicacion";

-- Las funciones NO cuelgan de ninguna tabla: si no se quitan aqui, sobreviven
-- al down y el siguiente up falla con "function already exists".
DROP FUNCTION IF EXISTS invitation_lookup(text);
DROP FUNCTION IF EXISTS session_lookup(text);
DROP FUNCTION IF EXISTS auth_lookup(text);
DROP FUNCTION IF EXISTS current_company();
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."company" DROP CONSTRAINT "company_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."company_settings" DROP CONSTRAINT "company_settings_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."location" DROP CONSTRAINT "location_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."location" DROP CONSTRAINT "location_type_fkey";

-- DropForeignKey
ALTER TABLE "public"."location" DROP CONSTRAINT "location_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_user" DROP CONSTRAINT "app_user_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."app_user" DROP CONSTRAINT "app_user_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."role_permission" DROP CONSTRAINT "role_permission_role_code_fkey";

-- DropForeignKey
ALTER TABLE "public"."role_permission" DROP CONSTRAINT "role_permission_permission_code_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_role" DROP CONSTRAINT "user_role_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_role" DROP CONSTRAINT "user_role_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_role" DROP CONSTRAINT "user_role_role_code_has_location_fkey";

-- DropForeignKey
ALTER TABLE "public"."user_role" DROP CONSTRAINT "user_role_location_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."session" DROP CONSTRAINT "session_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."session" DROP CONSTRAINT "session_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."login_attempt" DROP CONSTRAINT "login_attempt_outcome_fkey";

-- DropTable
DROP TABLE "public"."company";

-- DropTable
DROP TABLE "public"."company_status";

-- DropTable
DROP TABLE "public"."company_settings";

-- DropTable
DROP TABLE "public"."location";

-- DropTable
DROP TABLE "public"."location_type";

-- DropTable
DROP TABLE "public"."location_status";

-- DropTable
DROP TABLE "public"."app_user";

-- DropTable
DROP TABLE "public"."user_status";

-- DropTable
DROP TABLE "public"."role";

-- DropTable
DROP TABLE "public"."permission";

-- DropTable
DROP TABLE "public"."role_permission";

-- DropTable
DROP TABLE "public"."user_role";

-- DropTable
DROP TABLE "public"."session";

-- DropTable
DROP TABLE "public"."login_attempt";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904023411_p1_iam';
