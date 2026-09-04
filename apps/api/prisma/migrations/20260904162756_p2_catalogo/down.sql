-- ===== MANUAL-REVERSE: BEGIN =====
--
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una tabla antes de quitar la tabla.
--
-- Las politicas de las tablas que este down elimina desapareceran solas con el
-- DROP TABLE. Se retiran igual, una a una, porque `audit:migrations` M3 exige
-- la simetria explicita y porque el dia que una de estas tablas SOBREVIVA a un
-- down el olvido dejaria una politica huerfana.

DROP POLICY IF EXISTS "item_group_app" ON "item_group";
DROP POLICY IF EXISTS "item_group_migrator" ON "item_group";
DROP POLICY IF EXISTS "item_app" ON "item";
DROP POLICY IF EXISTS "item_migrator" ON "item";
DROP POLICY IF EXISTS "purchase_article_app" ON "purchase_article";
DROP POLICY IF EXISTS "purchase_article_migrator" ON "purchase_article";
DROP POLICY IF EXISTS "unit_lectura" ON "unit";
DROP POLICY IF EXISTS "unit_migrator" ON "unit";
DROP POLICY IF EXISTS "unit_dimension_lectura" ON "unit_dimension";
DROP POLICY IF EXISTS "unit_dimension_migrator" ON "unit_dimension";
DROP POLICY IF EXISTS "item_type_lectura" ON "item_type";
DROP POLICY IF EXISTS "item_type_migrator" ON "item_type";
DROP POLICY IF EXISTS "item_status_lectura" ON "item_status";
DROP POLICY IF EXISTS "item_status_migrator" ON "item_status";
DROP POLICY IF EXISTS "price_confidence_lectura" ON "price_confidence";
DROP POLICY IF EXISTS "price_confidence_migrator" ON "price_confidence";

-- RLS: se desactiva en espejo. Sin esto, una tabla que el down NO elimine
-- quedaria con RLS activo y sin ninguna politica — un "deny by default" sin
-- puerta.
ALTER TABLE "item_group" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "item_group" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "item" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "item" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_article" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "purchase_article" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "unit" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "unit" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "unit_dimension" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "unit_dimension" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "item_type" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "item_type" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "item_status" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "item_status" DISABLE ROW LEVEL SECURITY;
ALTER TABLE "price_confidence" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "price_confidence" DISABLE ROW LEVEL SECURITY;

-- El indice de similitud. Se va con la tabla, pero explicito y en espejo.
DROP INDEX IF EXISTS "item_name_similitud";

-- Las capacidades de P2. `permission` y `role_permission` son tablas de P1 que
-- SOBREVIVEN a este down, asi que sus filas hay que retirarlas.
--
-- Aqui SI se borra, al contrario que con `audit_event_type`, y la diferencia es
-- exactamente la que describe M10: a estas filas no las referencia nadie salvo
-- `role_permission`, que se vacia en la sentencia de al lado. Un permiso
-- retirado no deja evidencia sin significado; un tipo de evento, si.
DELETE FROM "role_permission" WHERE "permission_code" IN ('catalog.read', 'catalog.create', 'catalog.update');
DELETE FROM "permission" WHERE "code" IN ('catalog.read', 'catalog.create', 'catalog.update');

-- LOS TIPOS DE EVENTO QUE P2 SEMBRO **NO SE BORRAN**, por la misma razon que
-- los de P1: `audit_event_type` es una tabla de P0 que sobrevive a este down, y
-- borrar el tipo de un evento ya registrado dejaria la fila de auditoria sin
-- significado. La clave foranea de `audit_log` es `ON DELETE RESTRICT` a
-- proposito. Ver docs/incidencias/INC-011 y la comprobacion M10.

-- La extension NO se elimina. `pg_trgm` la crea el aprovisionamiento de la base
-- (`grants.sql`) y puede tener otros usuarios; un down de una migracion no tiene
-- derecho a retirar una capacidad del servidor que no instalo en exclusiva.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- DropForeignKey
ALTER TABLE "public"."unit" DROP CONSTRAINT "unit_dimension_fkey";

-- DropForeignKey
ALTER TABLE "public"."item_group" DROP CONSTRAINT "item_group_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_type_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_unit_of_use_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_group_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_status_fkey";

-- DropForeignKey
ALTER TABLE "public"."item" DROP CONSTRAINT "item_price_confidence_fkey";

-- DropForeignKey
ALTER TABLE "public"."purchase_article" DROP CONSTRAINT "purchase_article_company_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."purchase_article" DROP CONSTRAINT "purchase_article_item_id_fkey";

-- DropForeignKey
ALTER TABLE "public"."purchase_article" DROP CONSTRAINT "purchase_article_presentation_unit_fkey";

-- DropForeignKey
ALTER TABLE "public"."purchase_article" DROP CONSTRAINT "purchase_article_status_fkey";

-- DropTable
DROP TABLE "public"."unit";

-- DropTable
DROP TABLE "public"."unit_dimension";

-- DropTable
DROP TABLE "public"."item_type";

-- DropTable
DROP TABLE "public"."item_status";

-- DropTable
DROP TABLE "public"."price_confidence";

-- DropTable
DROP TABLE "public"."item_group";

-- DropTable
DROP TABLE "public"."item";

-- DropTable
DROP TABLE "public"."purchase_article";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260904162756_p2_catalogo';
