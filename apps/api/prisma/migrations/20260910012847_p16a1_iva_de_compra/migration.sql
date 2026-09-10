-- P16-A1 — el IVA de compra en DOS NIVELES (D-16.9, D-16.10, D-16.18, D-16.25).
--
-- QUE CAMBIA, Y POR QUE.
--
-- Hasta aqui el libro de inventario no sabia nada de IVA: `total_cost` era «el
-- dinero que se movio», y el bodeguero que teclea el total de una factura CON
-- IVA metia el impuesto entero en el costo del plato. La tarifa vivia solo en
-- el precio de referencia, con `company_settings.iva_compra` de defecto.
--
-- El usuario decidio (D-16.9): el bodeguero escribe EL TOTAL DE LA FACTURA CON
-- IVA. La TARIFA es del articulo de compra (o, sin articulo, del grupo del
-- item); la RECUPERABILIDAD es de la company (R13). Ninguno de los dos niveles
-- es la company: `company_settings.iva_compra` deja de leerse (D-16.43) y se
-- retira en P16-B. NUNCA SE ASUME 0.15: sin tarifa, la compra se rechaza (400).
--
-- Cada COMPRA nueva persiste los cuatro importes (D-16.10):
--
--   total_bruto              lo que dice la factura
--   iva_tarifa_aplicada      la tarifa con la que se neteo
--   iva_recuperable_aplicado el ajuste de la company EN ESE MOMENTO
--   total_cost               el NETO: recuperable ? bruto / (1 + tarifa) : bruto
--
-- `desglose_conocido` distingue esas filas de las anteriores. LAS COMPRA
-- ANTERIORES NO SE RELLENAN (D-16.18): el libro es append-only y nadie sabe con
-- que tarifa se pago cada una. Quedan «sin desglose», con `total_cost` tal como
-- se tecleo, y la discontinuidad se dice en ADR-024.
--
-- LA SEMILLA 0.15 DE `purchase_article.iva_tarifa` ES SEMILLA, NO VERDAD. La
-- columna nace NOT NULL y la tabla ya tiene filas: hace falta un valor para
-- llenarlas y se elige la tarifa general del Ecuador. El DEFAULT se SUELTA en
-- la misma migracion para que ningun articulo nuevo lo herede en silencio: el
-- alta exige la tarifa. Los existentes se corrigen por
-- `PUT /catalogo/articulos/:id`, que es lo que D-16.45 construye en este paquete.
--
-- ORDEN: columna sembrada -> resto de columnas -> restricciones -> semillas.
-- No hay tabla nueva (M6 no aplica) ni privilegio nuevo: `UPDATE` sobre
-- `purchase_article` e `item_group` lo concedio P2.

-- ===== MANUAL: BEGIN =====

-- --- La columna sembrada -------------------------------------------------------
--
-- Prisma generaria `ADD COLUMN "iva_tarifa" DECIMAL(24,12) NOT NULL`, que
-- falla sobre una tabla con filas. Se escribe a mano con la semilla y se suelta
-- el DEFAULT a continuacion: el estado final es exactamente el que declara
-- `schema.prisma` (NOT NULL, sin default), y `migrate:verify` 4/4 lo comprueba.
ALTER TABLE "purchase_article"
  ADD COLUMN "iva_tarifa" DECIMAL(24,12) NOT NULL DEFAULT 0.15;
ALTER TABLE "purchase_article"
  ALTER COLUMN "iva_tarifa" DROP DEFAULT;

-- ===== MANUAL: END =====

-- AlterTable
ALTER TABLE "inventory_movement" ADD COLUMN     "desglose_conocido" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "iva_recuperable_aplicado" BOOLEAN,
ADD COLUMN     "iva_tarifa_aplicada" DECIMAL(24,12),
ADD COLUMN     "total_bruto" DECIMAL(24,12);

-- AlterTable
ALTER TABLE "item_group" ADD COLUMN     "iva_tarifa" DECIMAL(24,12);

-- ===== MANUAL: BEGIN =====

-- --- Restricciones -------------------------------------------------------------
--
-- UNA TARIFA ES UNA FRACCION. `0.15`, no `15`: un 15 escrito donde va 0.15
-- dividiria el bruto entre 16 y el costo del plato saldria a un dieciseisavo,
-- plausible en pantalla y ruinoso. Misma familia que `reference_price_iva_es_fraccion`.
ALTER TABLE "purchase_article"
  ADD CONSTRAINT "purchase_article_iva_tarifa_es_fraccion"
    CHECK ("iva_tarifa" BETWEEN 0 AND 1);

ALTER TABLE "item_group"
  ADD CONSTRAINT "item_group_iva_tarifa_es_fraccion"
    CHECK ("iva_tarifa" IS NULL OR "iva_tarifa" BETWEEN 0 AND 1);

-- EL DESGLOSE ES TODO O NADA, Y SOLO EN UNA COMPRA (D-16.41). Con desglose,
-- los cuatro importes estan y el tipo es COMPRA — tambien en la correccion,
-- que conserva el tipo y COPIA los cuatro campos del original para que
-- Σ(COMPRA) del mes se cancele sola. Sin desglose, los tres campos nuevos van
-- NULL: es el estado de las filas anteriores y de todo lo que no es COMPRA.
-- Un desglose a medias —bruto sin tarifa, tarifa sin recuperabilidad— seria
-- una fila que nadie puede interpretar dentro de un ano.
ALTER TABLE "inventory_movement"
  ADD CONSTRAINT "inventory_movement_desglose_coherente" CHECK (
    (
      "desglose_conocido" = false
      AND "total_bruto" IS NULL
      AND "iva_tarifa_aplicada" IS NULL
      AND "iva_recuperable_aplicado" IS NULL
    ) OR (
      "desglose_conocido" = true
      AND "type" = 'COMPRA'
      AND "total_bruto" IS NOT NULL
      AND "iva_tarifa_aplicada" IS NOT NULL
      AND "iva_recuperable_aplicado" IS NOT NULL
      AND "total_cost" IS NOT NULL
    )
  ),
  -- El bruto es magnitud sin signo, como `total_cost`; la tarifa, fraccion.
  ADD CONSTRAINT "inventory_movement_desglose_en_rango" CHECK (
    ("total_bruto" IS NULL OR "total_bruto" >= 0)
    AND ("iva_tarifa_aplicada" IS NULL OR "iva_tarifa_aplicada" BETWEEN 0 AND 1)
  );

-- --- Semillas ------------------------------------------------------------------
--
-- El evento del `PUT /catalogo/grupos/:id`. `catalog.article.updated` ya lo
-- sembro P2 para un endpoint que no existia hasta hoy.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('catalog.group.updated', 'catalog', true)
ON CONFLICT ("code") DO NOTHING;

-- ===== MANUAL: END =====
