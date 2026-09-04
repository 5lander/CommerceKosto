-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "reference_price_app" ON "reference_price";
DROP POLICY IF EXISTS "reference_price_migrator" ON "reference_price";
DROP POLICY IF EXISTS "reference_price_origin_lectura" ON "reference_price_origin";
DROP POLICY IF EXISTS "reference_price_origin_migrator" ON "reference_price_origin";
DROP POLICY IF EXISTS "reference_price_status_lectura" ON "reference_price_status";
DROP POLICY IF EXISTS "reference_price_status_migrator" ON "reference_price_status";

ALTER TABLE "reference_price" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reference_price" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_origin" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_origin" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_status" DISABLE ROW LEVEL SECURITY;

-- Los triggers y sus funciones. `company` y `company_settings` son tablas de P1
-- que SOBREVIVEN a este down: si el trigger no se quitara aqui, seguiria
-- sembrando ajustes con una columna —`iva_compra`— que el down elimina, y la
-- siguiente alta de company fallaria con un error que no menciona ninguna
-- migracion.
DROP TRIGGER IF EXISTS "company_nace_con_ajustes" ON "company";
DROP FUNCTION IF EXISTS sembrar_ajustes_de_company();

DROP TRIGGER IF EXISTS "reference_price_solo_cambia_de_estado" ON "reference_price";
DROP FUNCTION IF EXISTS exigir_precio_inmutable();
DROP TRIGGER IF EXISTS "reference_price_articulo_segun_tipo" ON "reference_price";
DROP FUNCTION IF EXISTS exigir_articulo_segun_tipo();

ALTER TABLE "company_settings"
  DROP CONSTRAINT IF EXISTS "company_settings_ratios_son_fracciones",
  DROP CONSTRAINT IF EXISTS "company_settings_umbrales_ordenados",
  DROP CONSTRAINT IF EXISTS "company_settings_dias_positivos";

-- Las capacidades de P3. `permission` y `role_permission` son de P1 y
-- sobreviven; sus filas hay que retirarlas. A `permission` solo la referencia
-- `role_permission`, que se vacia en la sentencia de al lado — que es lo que M10
-- comprueba antes de dejar pasar este borrado.
DELETE FROM "role_permission" WHERE "permission_code" IN (
  'pricing.read', 'pricing.suggest', 'pricing.confirm', 'settings.read', 'settings.update');
DELETE FROM "permission" WHERE "code" IN (
  'pricing.read', 'pricing.suggest', 'pricing.confirm', 'settings.read', 'settings.update');

-- LOS TIPOS DE EVENTO QUE P3 SEMBRO **NO SE BORRAN**, por la misma razon que en
-- P1 y P2: `audit_log` los referencia con `ON DELETE RESTRICT` y es append-only,
-- asi que nunca puede vaciarse. Borrar el tipo de un evento ya registrado
-- dejaria la fila de auditoria sin significado. Ver INC-011 y la comprobacion
-- M10, que es la que no deja escribir aqui el DELETE.

-- Los ajustes sembrados NO se borran: `company_settings` es de P1 y la fila
-- pertenece a la company, no a esta migracion. Lo que si desaparece es la
-- columna `iva_compra`, que la parte generada del down se lleva.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_item_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_origin_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."reference_price" DROP CONSTRAINT "reference_price_purchase_article_id_item_id_fkey";

-- DropIndex
DROP INDEX "public"."purchase_article_id_item_id_key";

-- AlterTable
ALTER TABLE "public"."company_settings" DROP COLUMN "iva_compra";

-- DropTable
DROP TABLE "public"."reference_price_origin";

-- DropTable
DROP TABLE "public"."reference_price_status";

-- DropTable
DROP TABLE "public"."reference_price";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904171128_p3_precios';
