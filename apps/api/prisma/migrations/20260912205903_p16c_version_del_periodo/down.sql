-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO.
--
-- LA SEMILLA `location.updated` DE `audit_event_type` NO SE BORRA (M10,
-- INC-011): un `audit_log` que ya la referencie haria el down irrevertible
-- sobre una base con datos, y el libro de auditoria no se toca.
ALTER TABLE "period" DROP CONSTRAINT "period_version_positiva";
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- AlterTable
ALTER TABLE "public"."period" DROP COLUMN "version";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260912205903_p16c_version_del_periodo';
