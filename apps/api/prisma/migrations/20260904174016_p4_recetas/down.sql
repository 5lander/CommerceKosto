-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "product_app" ON "product";
DROP POLICY IF EXISTS "product_migrator" ON "product";
DROP POLICY IF EXISTS "product_location_app" ON "product_location";
DROP POLICY IF EXISTS "product_location_migrator" ON "product_location";
DROP POLICY IF EXISTS "combo_component_app" ON "combo_component";
DROP POLICY IF EXISTS "combo_component_migrator" ON "combo_component";
DROP POLICY IF EXISTS "recipe_app" ON "recipe";
DROP POLICY IF EXISTS "recipe_migrator" ON "recipe";
DROP POLICY IF EXISTS "recipe_line_app" ON "recipe_line";
DROP POLICY IF EXISTS "recipe_line_migrator" ON "recipe_line";
DROP POLICY IF EXISTS "recipe_propagation_app" ON "recipe_propagation";
DROP POLICY IF EXISTS "recipe_propagation_migrator" ON "recipe_propagation";
DROP POLICY IF EXISTS "recipe_propagation_target_app" ON "recipe_propagation_target";
DROP POLICY IF EXISTS "recipe_propagation_target_migrator" ON "recipe_propagation_target";
DROP POLICY IF EXISTS "product_type_lectura" ON "product_type";
DROP POLICY IF EXISTS "product_type_migrator" ON "product_type";
DROP POLICY IF EXISTS "product_status_lectura" ON "product_status";
DROP POLICY IF EXISTS "product_status_migrator" ON "product_status";
DROP POLICY IF EXISTS "recipe_line_base_lectura" ON "recipe_line_base";
DROP POLICY IF EXISTS "recipe_line_base_migrator" ON "recipe_line_base";
DROP POLICY IF EXISTS "recipe_line_status_lectura" ON "recipe_line_status";
DROP POLICY IF EXISTS "recipe_line_status_migrator" ON "recipe_line_status";
DROP POLICY IF EXISTS "recipe_status_lectura" ON "recipe_status";
DROP POLICY IF EXISTS "recipe_status_migrator" ON "recipe_status";

ALTER TABLE "product" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "product_location" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_location" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "combo_component" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "combo_component" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation_target" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation_target" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "product_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_type" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "product_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "product_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_base" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_base" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "recipe_status" DISABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS "recipe_no_se_edita" ON "recipe";
DROP FUNCTION IF EXISTS exigir_receta_inmutable();

-- Las capacidades de P4. `permission` y `role_permission` son de P1 y
-- sobreviven; a `permission` solo la referencia `role_permission`, que se vacia
-- en la sentencia de al lado — que es lo que M10 comprueba.
DELETE FROM "role_permission" WHERE "permission_code" IN (
  'product.read', 'product.write', 'recipe.read', 'recipe.write', 'recipe.propagate');
DELETE FROM "permission" WHERE "code" IN (
  'product.read', 'product.write', 'recipe.read', 'recipe.write', 'recipe.propagate');

-- LOS TIPOS DE EVENTO QUE P4 SEMBRO **NO SE BORRAN**: `audit_log` los
-- referencia con `ON DELETE RESTRICT` y es append-only, asi que nunca puede
-- vaciarse. Ver INC-011 y la comprobacion M10.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."product" DROP CONSTRAINT "product_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product" DROP CONSTRAINT "product_type_fkey";

-- DropForeignKey
ALTER TABLE "public"."product" DROP CONSTRAINT "product_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_location" DROP CONSTRAINT "product_location_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_location" DROP CONSTRAINT "product_location_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."product_location" DROP CONSTRAINT "product_location_location_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."combo_component" DROP CONSTRAINT "combo_component_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."combo_component" DROP CONSTRAINT "combo_component_combo_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."combo_component" DROP CONSTRAINT "combo_component_component_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe" DROP CONSTRAINT "recipe_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe" DROP CONSTRAINT "recipe_location_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe" DROP CONSTRAINT "recipe_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe" DROP CONSTRAINT "recipe_item_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe" DROP CONSTRAINT "recipe_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_line" DROP CONSTRAINT "recipe_line_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_line" DROP CONSTRAINT "recipe_line_recipe_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_line" DROP CONSTRAINT "recipe_line_item_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_line" DROP CONSTRAINT "recipe_line_base_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_line" DROP CONSTRAINT "recipe_line_estado_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation" DROP CONSTRAINT "recipe_propagation_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation" DROP CONSTRAINT "recipe_propagation_product_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation_target" DROP CONSTRAINT "recipe_propagation_target_propagation_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation_target" DROP CONSTRAINT "recipe_propagation_target_location_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation_target" DROP CONSTRAINT "recipe_propagation_target_previous_recipe_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."recipe_propagation_target" DROP CONSTRAINT "recipe_propagation_target_created_recipe_id_fkey";

-- DropIndex
DROP INDEX "public"."item_id_company_id_key";

-- DropTable
DROP TABLE "public"."product_type";

-- DropTable
DROP TABLE "public"."product_status";

-- DropTable
DROP TABLE "public"."recipe_line_base";

-- DropTable
DROP TABLE "public"."recipe_line_status";

-- DropTable
DROP TABLE "public"."recipe_status";

-- DropTable
DROP TABLE "public"."product";

-- DropTable
DROP TABLE "public"."product_location";

-- DropTable
DROP TABLE "public"."combo_component";

-- DropTable
DROP TABLE "public"."recipe";

-- DropTable
DROP TABLE "public"."recipe_line";

-- DropTable
DROP TABLE "public"."recipe_propagation";

-- DropTable
DROP TABLE "public"."recipe_propagation_target";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904174016_p4_recetas';
