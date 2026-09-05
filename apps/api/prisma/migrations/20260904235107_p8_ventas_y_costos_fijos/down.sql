-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "product_sales_app" ON "product_sales";
DROP POLICY IF EXISTS "product_sales_migrator" ON "product_sales";
DROP POLICY IF EXISTS "fixed_cost_app" ON "fixed_cost";
DROP POLICY IF EXISTS "fixed_cost_migrator" ON "fixed_cost";
DROP POLICY IF EXISTS "fixed_cost_classification_lectura" ON "fixed_cost_classification";
DROP POLICY IF EXISTS "fixed_cost_classification_migrator" ON "fixed_cost_classification";

ALTER TABLE "product_sales" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_sales" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost_classification" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost_classification" DISABLE ROW LEVEL SECURITY;

-- Las capacidades de P8. `permission` y `role_permission` son de P1 y
-- sobreviven; a `permission` solo la referencia `role_permission`, que se vacia
-- en la sentencia de al lado — que es lo que M10 comprueba.
DELETE FROM "role_permission" WHERE "permission_code" IN (
  'sales.read', 'sales.write', 'cost.read', 'cost.write',
  'analytics.read', 'replenishment.read');
DELETE FROM "permission" WHERE "code" IN (
  'sales.read', 'sales.write', 'cost.read', 'cost.write',
  'analytics.read', 'replenishment.read');

-- LOS TIPOS DE EVENTO QUE P8 SEMBRO **NO SE BORRAN**: `audit_log` los
-- referencia con ON DELETE RESTRICT y es append-only, asi que nunca puede
-- vaciarse. Ver INC-011 y la comprobacion M10.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."product_sales" DROP CONSTRAINT "product_sales_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_sales" DROP CONSTRAINT "product_sales_period_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_sales" DROP CONSTRAINT "product_sales_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_sales" DROP CONSTRAINT "product_sales_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."fixed_cost" DROP CONSTRAINT "fixed_cost_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."fixed_cost" DROP CONSTRAINT "fixed_cost_period_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."fixed_cost" DROP CONSTRAINT "fixed_cost_classification_fkey";

-- DropForeignKey
ALTER TABLE "public"."fixed_cost" DROP CONSTRAINT "fixed_cost_created_by_fkey";

-- DropTable
DROP TABLE "public"."product_sales";

-- DropTable
DROP TABLE "public"."fixed_cost_classification";

-- DropTable
DROP TABLE "public"."fixed_cost";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904235107_p8_ventas_y_costos_fijos';
