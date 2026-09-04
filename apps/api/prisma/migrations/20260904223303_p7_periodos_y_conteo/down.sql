-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.

DROP POLICY IF EXISTS "period_app" ON "period";
DROP POLICY IF EXISTS "period_migrator" ON "period";
DROP POLICY IF EXISTS "physical_count_app" ON "physical_count";
DROP POLICY IF EXISTS "physical_count_migrator" ON "physical_count";
DROP POLICY IF EXISTS "physical_count_line_app" ON "physical_count_line";
DROP POLICY IF EXISTS "physical_count_line_migrator" ON "physical_count_line";
DROP POLICY IF EXISTS "period_status_lectura" ON "period_status";
DROP POLICY IF EXISTS "period_status_migrator" ON "period_status";
DROP POLICY IF EXISTS "physical_count_status_lectura" ON "physical_count_status";
DROP POLICY IF EXISTS "physical_count_status_migrator" ON "physical_count_status";

ALTER TABLE "period" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "period" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "physical_count" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_line" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_line" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "period_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "period_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_status" DISABLE ROW LEVEL SECURITY;

-- EL TRIGGER SOBRE `inventory_movement` HAY QUE QUITARLO A MANO, y es el unico
-- de los tres que importa de verdad: su tabla NO se borra en este down. Si se
-- quedara puesto apuntando a una funcion que ya no existe, el libro dejaria de
-- admitir inserciones despues de revertir — y eso no se ve en una base limpia,
-- que es justo lo que INC-011 enseno.
DROP TRIGGER IF EXISTS "inventory_movement_respeta_periodo_cerrado" ON "inventory_movement";
DROP FUNCTION IF EXISTS rechazar_movimiento_en_periodo_cerrado();

-- Los otros dos caen con sus tablas... pero sus tablas se borran DESPUES, en
-- el bloque de Prisma, y una funcion no se puede soltar mientras un trigger
-- vivo la use. Hay que quitar los triggers aqui, en orden, o el down falla con
-- «cannot drop function ... because other objects depend on it».
DROP TRIGGER IF EXISTS "physical_count_confirmado_no_se_edita" ON "physical_count";
DROP TRIGGER IF EXISTS "physical_count_line_solo_en_borrador" ON "physical_count_line";
DROP FUNCTION IF EXISTS rechazar_edicion_de_conteo_confirmado();
DROP FUNCTION IF EXISTS rechazar_linea_de_conteo_confirmado();

-- Las capacidades de P7. `permission` y `role_permission` son de P1 y
-- sobreviven; a `permission` solo la referencia `role_permission`, que se vacia
-- en la sentencia de al lado — que es lo que M10 comprueba.
DELETE FROM "role_permission" WHERE "permission_code" IN (
  'period.read', 'period.close', 'period.reopen', 'count.write', 'count.read');
DELETE FROM "permission" WHERE "code" IN (
  'period.read', 'period.close', 'period.reopen', 'count.write', 'count.read');

-- LOS TIPOS DE EVENTO QUE P7 SEMBRO **NO SE BORRAN**: `audit_log` los
-- referencia con `ON DELETE RESTRICT` y es append-only, asi que nunca puede
-- vaciarse. Ver INC-011 y la comprobacion M10.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."period" DROP CONSTRAINT "period_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."period" DROP CONSTRAINT "period_location_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."period" DROP CONSTRAINT "period_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."period" DROP CONSTRAINT "period_closed_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."period" DROP CONSTRAINT "period_reopened_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count" DROP CONSTRAINT "physical_count_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count" DROP CONSTRAINT "physical_count_period_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count" DROP CONSTRAINT "physical_count_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count" DROP CONSTRAINT "physical_count_created_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count" DROP CONSTRAINT "physical_count_confirmed_by_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count_line" DROP CONSTRAINT "physical_count_line_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count_line" DROP CONSTRAINT "physical_count_line_count_id_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."physical_count_line" DROP CONSTRAINT "physical_count_line_item_id_company_id_fkey";

-- DropTable
DROP TABLE "public"."period_status";

-- DropTable
DROP TABLE "public"."period";

-- DropTable
DROP TABLE "public"."physical_count_status";

-- DropTable
DROP TABLE "public"."physical_count";

-- DropTable
DROP TABLE "public"."physical_count_line";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904223303_p7_periodos_y_conteo';
