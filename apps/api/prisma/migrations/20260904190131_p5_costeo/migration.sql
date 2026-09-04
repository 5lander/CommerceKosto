-- AlterTable
ALTER TABLE "product" ADD COLUMN     "packaging_item_id" UUID;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_packaging_item_id_company_id_fkey" FOREIGN KEY ("packaging_item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateIndex
-- P5: todas las recetas vigentes de UNA ubicacion, sin product_id en el filtro.
CREATE INDEX "recipe_por_ubicacion_y_vigencia" ON "recipe"("company_id", "location_id", "valid_from" DESC);

-- ===== MANUAL: BEGIN =====
--
-- P5 no crea ninguna tabla: el motor de costeo es DOMINIO PURO y no persiste
-- nada. Lo que la base necesita es lo que el motor no puede inventarse.
--
-- 1. EL EMPAQUE, que SPEC §14 usa y el esquema no tenia.
-- 2. EL PERMISO de leer un costeo, que `BODEGA` no puede tener.

-- --- 1. El empaque -----------------------------------------------------------
--
-- `empaque_neto = iva_recuperable ? precio_empaque / (1 + iva) : precio_empaque`
-- es, letra por letra, la cadena de SPEC §12 con factor de conversion 1. Por eso
-- el empaque es un ITEM y no una tabla propia: se compra, tiene articulo, tiene
-- precio con vigencia y un dia se cuenta en el inventario. El razonamiento
-- completo esta en ADR-008.
--
-- La clave foranea es COMPUESTA contra `item(id, company_id)`: el empaque de un
-- producto tiene que ser de la misma company que el producto. Sin la columna
-- `company_id` dentro de la FK, una fila podria apuntar al item de otro tenant y
-- RLS no lo veria — la politica filtra lo que se LEE, no lo que se referencia.

COMMENT ON COLUMN "product"."packaging_item_id" IS
  'Item COMPRADO que hace de empaque (SPEC 14, ADR-008). NULL = el producto no lleva empaque, y entonces empaque_neto es 0.';

-- --- 2. El permiso de leer un costeo -----------------------------------------
--
-- CLAUDE.md §4.3 lista «costo de plato, margen, food cost» entre los datos que
-- NO pueden salir del backend para un usuario `BODEGA`: son derivados de la
-- receta y permiten despejarla por aritmetica.
--
-- El filtrado va en la API, no en el frontend. Aqui, en una fila que no existe:
-- `BODEGA` no aparece en ningun INSERT de abajo.

INSERT INTO "permission" ("code", "domain") VALUES
  ('costing.read', 'costing');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, 'costing.read' FROM unnest(ARRAY['OWNER', 'ADMIN', 'GERENTE_LOCAL', 'LECTURA']) AS r;

-- `GERENTE_LOCAL` SI lo tiene, y su alcance lo limita la ubicacion, no el
-- permiso: puede costear su local y recibe 403 sobre otro. Es la misma escalada
-- horizontal de P1, resuelta en `exigirUbicacionEnAlcance`.
--
-- `LECTURA` tambien: es el rol de quien mira sin tocar, y el costeo es lectura.

-- ===== MANUAL: END =====
