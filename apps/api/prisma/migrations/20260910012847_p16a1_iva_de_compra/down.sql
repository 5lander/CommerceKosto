-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de una columna antes de quitar la columna.
--
-- LA SEMILLA `audit_event_type` NO SE BORRA (INC-011 / M10): un `audit_log`
-- que ya la referencie la haria irrevertible sobre una base con datos.
--
-- Y UNA ADVERTENCIA SOBRE LOS DATOS: soltar `purchase_article.iva_tarifa`
-- pierde las tarifas corregidas a mano; al volver a subir, todo articulo
-- reaparece con la semilla 0.15. Es lo que «semilla, no verdad» significa
-- tambien para el down. Las COMPRA con desglose pierden `total_bruto`,
-- `iva_tarifa_aplicada` e `iva_recuperable_aplicado` y conservan `total_cost`
-- (el neto), que es el importe con el que ya se costeo el mes.
ALTER TABLE "inventory_movement"
  DROP CONSTRAINT IF EXISTS "inventory_movement_desglose_en_rango",
  DROP CONSTRAINT IF EXISTS "inventory_movement_desglose_coherente";
ALTER TABLE "item_group"
  DROP CONSTRAINT IF EXISTS "item_group_iva_tarifa_es_fraccion";
ALTER TABLE "purchase_article"
  DROP CONSTRAINT IF EXISTS "purchase_article_iva_tarifa_es_fraccion";
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- AlterTable
ALTER TABLE "public"."item_group" DROP COLUMN "iva_tarifa";

-- AlterTable
ALTER TABLE "public"."purchase_article" DROP COLUMN "iva_tarifa";

-- AlterTable
ALTER TABLE "public"."inventory_movement" DROP COLUMN "desglose_conocido",
DROP COLUMN "iva_recuperable_aplicado",
DROP COLUMN "iva_tarifa_aplicada",
DROP COLUMN "total_bruto";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910012847_p16a1_iva_de_compra';
