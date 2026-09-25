-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO.
ALTER TABLE "item"    DROP CONSTRAINT "item_version_positiva";
ALTER TABLE "product" DROP CONSTRAINT "product_version_positiva";

ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_ratios_son_fracciones";

-- LA COLUMNA VUELVE CON 0.15, que era la semilla de D3 para toda company. El
-- valor que cada company tuviera antes de P16-B no se puede recuperar —se solto
-- con la columna—, y P16-A1 ya habia dejado de leerlo (D-16.43): no hay ningun
-- costo que dependa de el. Se anade con DEFAULT para las filas que ya existen y
-- se quita el DEFAULT despues, porque la columna original no lo tenia.
ALTER TABLE "public"."company_settings" ADD COLUMN "iva_compra" DECIMAL(24,12) NOT NULL DEFAULT 0.15;
ALTER TABLE "public"."company_settings" ALTER COLUMN "iva_compra" DROP DEFAULT;

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_ratios_son_fracciones" CHECK (
        "iva_venta"              BETWEEN 0 AND 1
    AND "iva_compra"             BETWEEN 0 AND 1
    AND "provision_merma"        BETWEEN 0 AND 1
    AND "food_cost_objetivo"     BETWEEN 0 AND 1
    AND "food_cost_maximo"       BETWEEN 0 AND 1
    AND "food_cost_umbral_verde" BETWEEN 0 AND 1
    AND "prime_cost_maximo"      BETWEEN 0 AND 1
    AND "regla_popularidad"      BETWEEN 0 AND 1);

CREATE OR REPLACE FUNCTION sembrar_ajustes_de_company() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO "company_settings" (
    "company_id", "iva_venta", "iva_compra", "iva_compra_recuperable",
    "provision_merma", "food_cost_objetivo", "food_cost_maximo",
    "food_cost_umbral_verde", "prime_cost_maximo", "regla_popularidad",
    "dias_operativos_mes", "dias_cobertura")
  VALUES (NEW."id", 0.15, 0.15, true, 0.02, 0.25, 0.32, 0.28, 0.65, 0.70, 22, 7)
  ON CONFLICT ("company_id") DO NOTHING;

  RETURN NEW;
END;
$$;
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- (La columna `iva_compra` la devuelve el bloque de arriba, con su valor: el
-- `ADD COLUMN ... NOT NULL` sin DEFAULT que genera `migrate diff` falla sobre
-- una tabla con filas, que es la de cualquier base que no este vacia.)

-- AlterTable
ALTER TABLE "public"."item" DROP COLUMN "version";

-- AlterTable
ALTER TABLE "public"."product" DROP COLUMN "version";

-- DropIndex
DROP INDEX "public"."reference_price_company_id_status_id_idx";

-- CreateIndex
CREATE INDEX "reference_price_company_id_status_idx" ON "public"."reference_price"("company_id" ASC, "status" ASC);

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260912191330_p16b_versiones_y_ajustes';
