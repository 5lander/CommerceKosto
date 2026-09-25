-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.
--
-- LAS SEMILLAS DE `audit_event_type` NO SE BORRAN (M10, INC-011): un
-- `audit_log` que ya las referencie haria el down irrevertible sobre una base
-- con datos.
--
-- Y UNA ADVERTENCIA SOBRE LOS DATOS: soltar `email_outbox` pierde la cola —los
-- correos `PENDIENTE` no saldran— y soltar `password_reset_token` invalida
-- todo enlace de restablecimiento en vuelo. Es lo que «revertir P16-A1»
-- significa; por eso el runbook pide respaldo antes de migrar.

DROP FUNCTION IF EXISTS password_reset_consume(text, timestamptz);
DROP FUNCTION IF EXISTS password_reset_request(text, text, timestamptz, jsonb);

DROP POLICY IF EXISTS "rate_limit_hit_migrator"        ON "rate_limit_hit";
DROP POLICY IF EXISTS "rate_limit_hit_despachador"     ON "rate_limit_hit";
DROP POLICY IF EXISTS "rate_limit_hit_app"             ON "rate_limit_hit";
DROP POLICY IF EXISTS "password_reset_token_migrator"  ON "password_reset_token";
DROP POLICY IF EXISTS "email_outbox_migrator"          ON "email_outbox";
DROP POLICY IF EXISTS "email_outbox_despachador"       ON "email_outbox";
DROP POLICY IF EXISTS "email_outbox_app"               ON "email_outbox";

ALTER TABLE "rate_limit_hit"       NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_hit"       DISABLE  ROW LEVEL SECURITY;
ALTER TABLE "password_reset_token" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_token" DISABLE  ROW LEVEL SECURITY;
ALTER TABLE "email_outbox"         NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "email_outbox"         DISABLE  ROW LEVEL SECURITY;

-- Los privilegios de los dos roles que esta migracion estreno sobre estas
-- tablas. Las tablas se sueltan abajo, pero el USAGE sobre el esquema no se
-- va con ellas: se retira aqui, en espejo exacto del up.
REVOKE ALL ON TABLE "email_outbox"   FROM costeo_backoffice;
REVOKE ALL ON TABLE "email_outbox"   FROM costeo_despachador;
REVOKE ALL ON TABLE "rate_limit_hit" FROM costeo_despachador;
REVOKE USAGE ON SCHEMA public        FROM costeo_despachador;

-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."email_outbox" DROP CONSTRAINT "email_outbox_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."email_outbox" DROP CONSTRAINT "email_outbox_user_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."password_reset_token" DROP CONSTRAINT "password_reset_token_user_id_fkey";

-- DropTable
DROP TABLE "public"."email_outbox";

-- DropTable
DROP TABLE "public"."password_reset_token";

-- DropTable
DROP TABLE "public"."rate_limit_hit";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910042649_p16a1_correo_y_limite_de_tasa';
