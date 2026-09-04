-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "inventory_movement_app" ON "inventory_movement";
DROP POLICY IF EXISTS "inventory_movement_migrator" ON "inventory_movement";
DROP POLICY IF EXISTS "inventory_transfer_app" ON "inventory_transfer";
DROP POLICY IF EXISTS "inventory_transfer_migrator" ON "inventory_transfer";
DROP POLICY IF EXISTS "inventory_production_app" ON "inventory_production";
DROP POLICY IF EXISTS "inventory_production_migrator" ON "inventory_production";
DROP POLICY IF EXISTS "inventory_movement_type_lectura" ON "inventory_movement_type";
DROP POLICY IF EXISTS "inventory_movement_type_migrator" ON "inventory_movement_type";

ALTER TABLE "inventory_movement" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transfer" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transfer" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_production" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_production" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement_type" DISABLE ROW LEVEL SECURITY;

-- Los triggers de append-only. `rechazar_mutacion()` NO se borra: es de P0 y la
-- sigue usando `audit_log`.
DROP TRIGGER IF EXISTS "inventory_movement_sin_truncado" ON "inventory_movement";
DROP TRIGGER IF EXISTS "inventory_movement_sin_mutacion" ON "inventory_movement";
DROP TRIGGER IF EXISTS "inventory_transfer_sin_mutacion" ON "inventory_transfer";
DROP TRIGGER IF EXISTS "inventory_production_sin_mutacion" ON "inventory_production";

-- Las capacidades de P6. `permission` y `role_permission` son de P1 y
-- sobreviven; a `permission` solo la referencia `role_permission`, que se vacia
-- en la sentencia de al lado — que es lo que M10 comprueba.
DELETE FROM "role_permission" WHERE "permission_code" IN (
  'inventory.read', 'inventory.write', 'inventory.transfer', 'inventory.produce');
DELETE FROM "permission" WHERE "code" IN (
  'inventory.read', 'inventory.write', 'inventory.transfer', 'inventory.produce');

-- LOS TIPOS DE EVENTO QUE P6 SEMBRO **NO SE BORRAN**: `audit_log` los
-- referencia con `ON DELETE RESTRICT` y es append-only, asi que nunca puede
-- vaciarse. Ver INC-011 y la comprobacion M10.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_location_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_item_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_type_direction_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_purchase_article_id_item_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_transfer_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_production_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_reverses_movement_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_movement" DROP CONSTRAINT "inventory_movement_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_transfer" DROP CONSTRAINT "inventory_transfer_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_transfer" DROP CONSTRAINT "inventory_transfer_from_location_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_transfer" DROP CONSTRAINT "inventory_transfer_to_location_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_transfer" DROP CONSTRAINT "inventory_transfer_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_production" DROP CONSTRAINT "inventory_production_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_production" DROP CONSTRAINT "inventory_production_location_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_production" DROP CONSTRAINT "inventory_production_item_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."inventory_production" DROP CONSTRAINT "inventory_production_created_by_fkey";

-- DropIndex
DROP INDEX "public"."location_id_company_id_key";

-- DropTable
DROP TABLE "public"."inventory_movement_type";

-- DropTable
DROP TABLE "public"."inventory_movement";

-- DropTable
DROP TABLE "public"."inventory_transfer";

-- DropTable
DROP TABLE "public"."inventory_production";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904203551_p6_inventario';
