-- P16-B — versiones del producto y del item, y la retirada de
-- `company_settings.iva_compra`.
--
-- TRES COSAS SIN RELACION ENTRE SI EN UNA MIGRACION, porque las tres son del
-- mismo paquete y un paquete lleva una: la columna `version` de la concurrencia
-- optimista (D-16.100, ADR-023), la columna que D-16.43 dejo sin lector y
-- prometio retirar aqui (D-16.109), y el indice de la bandeja de precios
-- sugeridos, que el EXPLAIN de P16-B pidio (ver su bloque).
--
-- ORDEN: la funcion de la semilla se rehace ANTES de soltar la columna. PL/pgSQL
-- solo resuelve las columnas al ejecutar, asi que el orden no romperia esta
-- migracion; lo rompería la primera company que se diera de alta entre las dos
-- sentencias si no fueran la misma transaccion. Se escribe en el orden en que
-- se lee bien.

-- ===== MANUAL: BEGIN =====
-- La semilla de ajustes de toda company nueva, sin `iva_compra`. Mismos valores
-- de D3 que antes, con uno menos. `CREATE OR REPLACE` sirve: la firma y el
-- tipo de retorno no cambian (no es el caso de `session_lookup` en P15).
CREATE OR REPLACE FUNCTION sembrar_ajustes_de_company() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
BEGIN
  INSERT INTO "company_settings" (
    "company_id", "iva_venta", "iva_compra_recuperable",
    "provision_merma", "food_cost_objetivo", "food_cost_maximo",
    "food_cost_umbral_verde", "prime_cost_maximo", "regla_popularidad",
    "dias_operativos_mes", "dias_cobertura")
  VALUES (NEW."id", 0.15, true, 0.02, 0.25, 0.32, 0.28, 0.65, 0.70, 22, 7)
  ON CONFLICT ("company_id") DO NOTHING;

  RETURN NEW;
END;
$$;

-- El CHECK de fracciones nombra `iva_compra`, y PostgreSQL SUELTA ENTERO un
-- CHECK que referencia una columna soltada: los otros seis ratios se quedarian
-- sin su restriccion sin que nada avisara. Se suelta aqui a proposito y se
-- vuelve a crear abajo, sin la columna.
ALTER TABLE "company_settings" DROP CONSTRAINT "company_settings_ratios_son_fracciones";
-- ===== MANUAL: END =====

-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "iva_compra";

-- AlterTable
ALTER TABLE "item" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "product" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- LA BANDEJA DE PENDIENTES pagina por cursor: `company_id = $1 AND status =
-- 'SUGGESTED' AND id > $cursor ORDER BY id LIMIT n`. Con el indice de P3,
-- `(company_id, status)`, el EXPLAIN sobre el volumen del bench eligio recorrer
-- la CLAVE PRIMARIA en orden de id filtrando company y estado: con muchas
-- companies, eso es saltar las filas de todas las demas. Con `id` al final es un
-- rango de indice. Sustituye al de P3 y no se suma a el: su prefijo sigue
-- sirviendo a las lecturas por estado que ya lo usaban.
-- DropIndex
DROP INDEX "reference_price_company_id_status_idx";

-- CreateIndex
CREATE INDEX "reference_price_company_id_status_id_idx" ON "reference_price"("company_id", "status", "id");

-- ===== MANUAL: BEGIN =====
ALTER TABLE "company_settings"
  -- Los seis ratios que quedan son fracciones. Un IVA de 15 en vez de 0.15
  -- multiplicaria el costo por dieciseis.
  ADD CONSTRAINT "company_settings_ratios_son_fracciones" CHECK (
        "iva_venta"              BETWEEN 0 AND 1
    AND "provision_merma"        BETWEEN 0 AND 1
    AND "food_cost_objetivo"     BETWEEN 0 AND 1
    AND "food_cost_maximo"       BETWEEN 0 AND 1
    AND "food_cost_umbral_verde" BETWEEN 0 AND 1
    AND "prime_cost_maximo"      BETWEEN 0 AND 1
    AND "regla_popularidad"      BETWEEN 0 AND 1);

-- La version empieza en 1 y solo sube. Un cero o un negativo solo lo pondria
-- alguien escribiendo SQL a mano, y entonces el testigo de concurrencia dejaria
-- de significar «cuantas escrituras lleva».
ALTER TABLE "product" ADD CONSTRAINT "product_version_positiva" CHECK ("version" >= 1);
ALTER TABLE "item"    ADD CONSTRAINT "item_version_positiva"    CHECK ("version" >= 1);

-- Sin GRANT nuevo: `costeo_app` ya tiene UPDATE sobre `product` (P4) y sobre
-- `item` (P2), y la columna nueva lo hereda.
-- ===== MANUAL: END =====
