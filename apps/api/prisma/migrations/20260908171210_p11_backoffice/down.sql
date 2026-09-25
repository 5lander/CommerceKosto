-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.
--
-- Y EL LIMITE VUELVE A LA COMPANY ANTES DE SOLTAR EL PLAN, en espejo exacto de
-- lo que hizo el up. Un `down` que restaure `max_locations` con su DEFAULT
-- dejaria a una company de plan CADENA con diez ubicaciones permitidas y ciento
-- una creadas: la base quedaria en un estado que ninguna migracion produjo.
-- INC-011 es justo esto — lo que pasa cuando el down solo se prueba vacio.

DROP POLICY IF EXISTS "backoffice_access_log_migrator"  ON "backoffice_access_log";
DROP POLICY IF EXISTS "backoffice_access_log_app_no_ve" ON "backoffice_access_log";
DROP POLICY IF EXISTS "backoffice_session_migrator"     ON "backoffice_session";
DROP POLICY IF EXISTS "backoffice_session_app_no_ve"    ON "backoffice_session";
DROP POLICY IF EXISTS "backoffice_user_migrator"        ON "backoffice_user";
DROP POLICY IF EXISTS "backoffice_user_app_no_ve"       ON "backoffice_user";
DROP POLICY IF EXISTS "plan_migrator"                   ON "plan";
DROP POLICY IF EXISTS "plan_app_lee"                    ON "plan";

ALTER TABLE "backoffice_access_log" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_access_log" DISABLE  ROW LEVEL SECURITY;
ALTER TABLE "backoffice_session"    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_session"    DISABLE  ROW LEVEL SECURITY;
ALTER TABLE "backoffice_user"       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_user"       DISABLE  ROW LEVEL SECURITY;
ALTER TABLE "plan"                  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "plan"                  DISABLE  ROW LEVEL SECURITY;

-- Los privilegios del back office. Se quita lo que el up concedio, incluido el
-- SELECT sobre `audit_log`: el pendiente estructural vuelve a estar pendiente,
-- que es lo que «revertir P11» significa.
REVOKE ALL ON TABLE "audit_log"             FROM costeo_backoffice;
REVOKE ALL ON TABLE "company"               FROM costeo_backoffice;
REVOKE ALL ON TABLE "company_settings"      FROM costeo_backoffice;
REVOKE ALL ON TABLE "company_status"        FROM costeo_backoffice;
REVOKE ALL ON TABLE "location"              FROM costeo_backoffice;
REVOKE ALL ON TABLE "location_type"         FROM costeo_backoffice;
REVOKE ALL ON TABLE "location_status"       FROM costeo_backoffice;
REVOKE ALL ON TABLE "app_user"              FROM costeo_backoffice;
REVOKE ALL ON TABLE "user_status"           FROM costeo_backoffice;
REVOKE ALL ON TABLE "user_role"             FROM costeo_backoffice;
REVOKE ALL ON TABLE "role"                  FROM costeo_backoffice;
REVOKE ALL ON TABLE "item"                  FROM costeo_backoffice;
REVOKE ALL ON TABLE "product"               FROM costeo_backoffice;
REVOKE USAGE ON SCHEMA public               FROM costeo_backoffice;

-- El limite vuelve a la company, tomado del plan que tenia. Con `DEFAULT 10`
-- para las filas nuevas, que es lo que habia antes de esta migracion.
ALTER TABLE "company" ADD COLUMN "max_locations" INTEGER NOT NULL DEFAULT 10;

UPDATE "company" c
   SET "max_locations" = p."max_locations"
  FROM "plan" p
 WHERE p."code" = c."plan_code";

ALTER TABLE "company"
  ADD CONSTRAINT "company_max_locations_positivo" CHECK ("max_locations" >= 1);

ALTER TABLE "company" DROP CONSTRAINT "company_plan_code_fkey";
ALTER TABLE "company" DROP COLUMN "plan_code";

-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."backoffice_session" DROP CONSTRAINT "backoffice_session_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."backoffice_access_log" DROP CONSTRAINT "backoffice_access_log_operator_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."backoffice_access_log" DROP CONSTRAINT "backoffice_access_log_company_id_fkey";

-- DropTable
DROP TABLE "public"."plan";

-- DropTable
DROP TABLE "public"."backoffice_user";

-- DropTable
DROP TABLE "public"."backoffice_session";

-- DropTable
DROP TABLE "public"."backoffice_access_log";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260908171210_p11_backoffice';
