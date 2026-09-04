-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

-- El orden importa: `role_permission` referencia `permission` con RESTRICT.
DELETE FROM "role_permission" WHERE "permission_code" = 'costing.read';
DELETE FROM "permission"      WHERE "code" = 'costing.read';

-- El COMMENT se va con la columna, que la borra el bloque de Prisma de abajo.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropIndex
DROP INDEX "public"."recipe_por_ubicacion_y_vigencia";

-- DropForeignKey
ALTER TABLE "public"."product" DROP CONSTRAINT "product_packaging_item_id_company_id_fkey";

-- AlterTable
ALTER TABLE "public"."product" DROP COLUMN "packaging_item_id";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904190131_p5_costeo';
