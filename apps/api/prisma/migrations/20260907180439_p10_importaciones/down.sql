-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "import_job_app" ON "import_job";
DROP POLICY IF EXISTS "import_job_migrator" ON "import_job";
DROP POLICY IF EXISTS "import_job_status_lectura" ON "import_job_status";
DROP POLICY IF EXISTS "import_job_status_migrator" ON "import_job_status";

ALTER TABLE "import_job" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_job" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "import_job_status" DISABLE ROW LEVEL SECURITY;

-- La capacidad de P10. `permission` y `role_permission` son de P1 y sobreviven;
-- a `permission` solo la referencia `role_permission`, que se vacia en la
-- sentencia de al lado — que es lo que M10 comprueba.
DELETE FROM "role_permission" WHERE "permission_code" = 'import.write';
DELETE FROM "permission" WHERE "code" = 'import.write';

-- LOS TIPOS DE EVENTO QUE P10 SEMBRO **NO SE BORRAN**: `audit_log` los
-- referencia con ON DELETE RESTRICT y es append-only, asi que nunca puede
-- vaciarse. Mismo caso que P8. Ver INC-011 y la comprobacion M10.
--
-- Las filas de `import_job_status` tampoco se borran a mano: se van con la
-- tabla, que el bloque de Prisma suelta unas lineas mas abajo.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."import_job" DROP CONSTRAINT "import_job_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."import_job" DROP CONSTRAINT "import_job_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."import_job" DROP CONSTRAINT "import_job_status_fkey";

-- DropTable
DROP TABLE "public"."import_job_status";

-- DropTable
DROP TABLE "public"."import_job";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260907180439_p10_importaciones';
