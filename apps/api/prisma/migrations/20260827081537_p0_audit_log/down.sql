-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El espejo del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.
--
-- Un `DROP TABLE` arrastraria por si solo las politicas, los triggers, las
-- restricciones y las ACLs, asi que buena parte de esto es tecnicamente
-- redundante en ESTA migracion. Se escribe igual, por convencion sin
-- excepciones: a partir de P1 la mayoria de las migraciones son `ALTER` y no
-- `CREATE`, y ahi si es imprescindible. Una regla con excepciones no se puede
-- automatizar, y `audit:migrations` M3 y M4 la verifican.

DROP POLICY IF EXISTS "audit_actor_type_migrator" ON "audit_actor_type";
DROP POLICY IF EXISTS "audit_actor_type_lectura"  ON "audit_actor_type";
ALTER TABLE "audit_actor_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_actor_type" DISABLE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_outcome_migrator" ON "audit_outcome";
DROP POLICY IF EXISTS "audit_outcome_lectura"  ON "audit_outcome";
ALTER TABLE "audit_outcome" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_outcome" DISABLE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_event_type_migrator" ON "audit_event_type";
DROP POLICY IF EXISTS "audit_event_type_lectura"  ON "audit_event_type";
ALTER TABLE "audit_event_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_event_type" DISABLE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_migrator_inserta"   ON "audit_log";
DROP POLICY IF EXISTS "audit_log_app_no_lee"         ON "audit_log";
DROP POLICY IF EXISTS "audit_log_app_inserta_sistema" ON "audit_log";
ALTER TABLE "audit_log" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" DISABLE  ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS "audit_log_sin_truncado" ON "audit_log";
DROP TRIGGER IF EXISTS "audit_log_sin_mutacion" ON "audit_log";
DROP FUNCTION IF EXISTS rechazar_mutacion();

-- Las restricciones y los privilegios se van con el DROP TABLE de abajo.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."audit_log" DROP CONSTRAINT "audit_log_event_type_fkey";

-- DropForeignKey
ALTER TABLE "public"."audit_log" DROP CONSTRAINT "audit_log_outcome_fkey";

-- DropForeignKey
ALTER TABLE "public"."audit_log" DROP CONSTRAINT "audit_log_actor_type_fkey";

-- DropTable
DROP TABLE "public"."audit_log";

-- DropTable
DROP TABLE "public"."audit_event_type";

-- DropTable
DROP TABLE "public"."audit_outcome";

-- DropTable
DROP TABLE "public"."audit_actor_type";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260827081537_p0_audit_log';
