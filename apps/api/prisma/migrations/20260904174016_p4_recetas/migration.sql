-- CreateTable
CREATE TABLE "product_type" (
    "code" TEXT NOT NULL,

    CONSTRAINT "product_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "product_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "recipe_line_base" (
    "code" TEXT NOT NULL,

    CONSTRAINT "recipe_line_base_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "recipe_line_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "recipe_line_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "recipe_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "recipe_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "product" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_location" (
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "pvp" DECIMAL(24,12),
    "rendimiento_porciones" DECIMAL(24,12),

    CONSTRAINT "product_location_pkey" PRIMARY KEY ("product_id","location_id")
);

-- CreateTable
CREATE TABLE "combo_component" (
    "company_id" UUID NOT NULL,
    "combo_product_id" UUID NOT NULL,
    "component_product_id" UUID NOT NULL,
    "cantidad" DECIMAL(24,12) NOT NULL,

    CONSTRAINT "combo_component_pkey" PRIMARY KEY ("combo_product_id","component_product_id")
);

-- CreateTable
CREATE TABLE "recipe" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "product_id" UUID,
    "item_id" UUID,
    "status" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "recipe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "cantidad" DECIMAL(24,12) NOT NULL,
    "base" TEXT NOT NULL,
    "estado" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_propagation" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "source_recipe_id" UUID NOT NULL,
    "propagated_by" UUID NOT NULL,
    "propagated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reverted_by" UUID,
    "reverted_at" TIMESTAMPTZ(6),

    CONSTRAINT "recipe_propagation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_propagation_target" (
    "propagation_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "previous_recipe_id" UUID,
    "created_recipe_id" UUID NOT NULL,

    CONSTRAINT "recipe_propagation_target_pkey" PRIMARY KEY ("propagation_id","location_id")
);

-- CreateIndex
CREATE INDEX "product_company_id_status_idx" ON "product"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "product_company_id_name_key" ON "product"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "product_id_company_id_key" ON "product"("id", "company_id");

-- CreateIndex
CREATE INDEX "product_location_company_id_location_id_idx" ON "product_location"("company_id", "location_id");

-- CreateIndex
CREATE INDEX "combo_component_company_id_combo_product_id_idx" ON "combo_component"("company_id", "combo_product_id");

-- CreateIndex
CREATE INDEX "recipe_company_id_product_id_location_id_valid_from_idx" ON "recipe"("company_id", "product_id", "location_id", "valid_from" DESC);

-- CreateIndex
CREATE INDEX "recipe_company_id_item_id_location_id_valid_from_idx" ON "recipe"("company_id", "item_id", "location_id", "valid_from" DESC);

-- CreateIndex
CREATE INDEX "recipe_line_company_id_recipe_id_idx" ON "recipe_line"("company_id", "recipe_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_line_recipe_id_item_id_key" ON "recipe_line"("recipe_id", "item_id");

-- CreateIndex
CREATE INDEX "recipe_propagation_company_id_product_id_propagated_at_idx" ON "recipe_propagation"("company_id", "product_id", "propagated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "item_id_company_id_key" ON "item"("id", "company_id");

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_type_fkey" FOREIGN KEY ("type") REFERENCES "product_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product" ADD CONSTRAINT "product_status_fkey" FOREIGN KEY ("status") REFERENCES "product_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_component" ADD CONSTRAINT "combo_component_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_component" ADD CONSTRAINT "combo_component_combo_product_id_company_id_fkey" FOREIGN KEY ("combo_product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "combo_component" ADD CONSTRAINT "combo_component_component_product_id_company_id_fkey" FOREIGN KEY ("component_product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_item_id_company_id_fkey" FOREIGN KEY ("item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe" ADD CONSTRAINT "recipe_status_fkey" FOREIGN KEY ("status") REFERENCES "recipe_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_item_id_company_id_fkey" FOREIGN KEY ("item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_base_fkey" FOREIGN KEY ("base") REFERENCES "recipe_line_base"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_line" ADD CONSTRAINT "recipe_line_estado_fkey" FOREIGN KEY ("estado") REFERENCES "recipe_line_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation" ADD CONSTRAINT "recipe_propagation_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation" ADD CONSTRAINT "recipe_propagation_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation_target" ADD CONSTRAINT "recipe_propagation_target_propagation_id_fkey" FOREIGN KEY ("propagation_id") REFERENCES "recipe_propagation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation_target" ADD CONSTRAINT "recipe_propagation_target_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation_target" ADD CONSTRAINT "recipe_propagation_target_previous_recipe_id_fkey" FOREIGN KEY ("previous_recipe_id") REFERENCES "recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_propagation_target" ADD CONSTRAINT "recipe_propagation_target_created_recipe_id_fkey" FOREIGN KEY ("created_recipe_id") REFERENCES "recipe"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> semillas -> privilegios -> RLS.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "product"
  ADD CONSTRAINT "product_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "product_category_acotada"
    CHECK ("category" IS NULL OR length(btrim("category")) BETWEEN 1 AND 100);

ALTER TABLE "product_location"
  -- El PVP incluye IVA (R14) y es opcional mientras el producto no se active.
  ADD CONSTRAINT "product_location_pvp_positivo" CHECK ("pvp" IS NULL OR "pvp" > 0),
  ADD CONSTRAINT "product_location_rendimiento_positivo"
    CHECK ("rendimiento_porciones" IS NULL OR "rendimiento_porciones" > 0),
  -- Un producto ACTIVO en un local sin PVP es un producto que se puede vender
  -- sin saber a cuanto. El margen saldria indefinido y el food cost, infinito.
  ADD CONSTRAINT "product_location_activo_tiene_pvp"
    CHECK ("activo" = false OR "pvp" IS NOT NULL);

ALTER TABLE "combo_component"
  ADD CONSTRAINT "combo_component_cantidad_positiva" CHECK ("cantidad" > 0),
  -- Un combo que se contiene a si mismo. Es el caso trivial de R9 aplicado a
  -- combos; los indirectos los corta el dominio al guardar.
  ADD CONSTRAINT "combo_component_no_se_contiene"
    CHECK ("combo_product_id" <> "component_product_id");

ALTER TABLE "recipe"
  -- EL DESTINO ES UN PRODUCTO O UN ITEM, EXACTAMENTE UNO.
  --
  -- Un producto de venta tiene receta; una subpreparacion —item PRODUCIDO—
  -- tambien, y es lo que habilita la recursion que R9 corta. Sin este CHECK
  -- cabria una receta sin destino, que no significa nada, y una con dos, que
  -- significa dos cosas contradictorias.
  ADD CONSTRAINT "recipe_un_solo_destino"
    CHECK (("product_id" IS NOT NULL) <> ("item_id" IS NOT NULL)),
  ADD CONSTRAINT "recipe_note_acotada" CHECK ("note" IS NULL OR length("note") <= 500);

ALTER TABLE "recipe_line"
  -- Cantidad CERO permitida: una linea a cero es una que se dejo escrita para
  -- no perder la referencia. Negativa no: eso seria devolver insumo al hacer un
  -- plato.
  ADD CONSTRAINT "recipe_line_cantidad_no_negativa" CHECK ("cantidad" >= 0),
  ADD CONSTRAINT "recipe_line_orden_no_negativo" CHECK ("orden" >= 0);

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "product_type" ("code") VALUES ('SIMPLE'), ('COMBO');
INSERT INTO "product_status" ("code") VALUES ('ACTIVE'), ('INACTIVE');

-- AP y EP, el catalogo mas pequeno y mas peligroso del sistema (SPEC §13, R4).
INSERT INTO "recipe_line_base" ("code") VALUES ('AP'), ('EP');
INSERT INTO "recipe_line_status" ("code") VALUES ('ACTIVA'), ('INACTIVA');
INSERT INTO "recipe_status" ("code") VALUES ('ACTIVE'), ('VOID');

INSERT INTO "permission" ("code", "domain") VALUES
  ('product.read',    'products'),
  ('product.write',   'products'),
  ('recipe.read',     'recipes'),
  ('recipe.write',    'recipes'),
  -- R11: PERMISO SEPARADO Y DE NIVEL COMPANY. Propagar sobrescribe la receta
  -- completa en las demas ubicaciones, asi que no puede estar en manos de quien
  -- gestiona una sola: un gerente no decide como cocina el local de al lado.
  ('recipe.propagate', 'recipes');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r,
                   unnest(ARRAY['product.read', 'product.write', 'recipe.read',
                                'recipe.write', 'recipe.propagate']) AS p;

-- `GERENTE_LOCAL` gestiona la receta de SU ubicacion, y no propaga.
INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  ('GERENTE_LOCAL', 'product.read'),
  ('GERENTE_LOCAL', 'recipe.read'),
  ('GERENTE_LOCAL', 'recipe.write'),
  ('LECTURA',       'product.read'),
  ('LECTURA',       'recipe.read');

-- `BODEGA` NO aparece en ninguna de las dos de receta, y es la regla mas dura
-- de CLAUDE.md §4.3: las lineas de receta con sus cantidades SON la receta. El
-- filtrado va en la API, no en el frontend: aqui, en una fila que no existe.
-- `product.read` tampoco: el nombre de un producto no revela nada, pero P6 le
-- dara lo que necesita —el semaforo de reposicion— por otra via.

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('product.created',           'products', true),
  ('product.updated',           'products', true),
  ('recipe.saved',              'recipes',  true),
  ('recipe.propagated',         'recipes',  true),
  ('recipe.propagation_reverted', 'recipes', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios -------------------------------------------------------------

GRANT UPDATE ON TABLE "product"            TO costeo_app;
GRANT UPDATE ON TABLE "product_location"   TO costeo_app;
GRANT UPDATE ON TABLE "recipe_propagation" TO costeo_app;

-- Las lineas de una receta se reemplazan al guardar una version nueva; la
-- version anterior NO se toca. `DELETE` sobre `recipe_line` es para la version
-- en construccion, no para la historia: `recipe` no tiene DELETE.
GRANT DELETE ON TABLE "recipe_line"     TO costeo_app;
GRANT DELETE ON TABLE "combo_component" TO costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "product_type"       FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "product_status"     FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "recipe_line_base"   FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "recipe_line_status" FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "recipe_status"      FROM costeo_app;

-- --- Una receta no se edita: se versiona ------------------------------------
--
-- Misma regla que los precios de P3, y por la misma razon: los costeos
-- historicos no se recalculan (SPEC §9). Lo unico que puede cambiar de una fila
-- de `recipe` es... nada. Se crea una version nueva.
--
-- Va en un trigger porque `recipe` no necesita `UPDATE` para nada, pero un
-- `GRANT` olvidado en el futuro lo abriria en silencio.
CREATE FUNCTION exigir_receta_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION 'Una receta no se edita: se guarda una version nueva con su vigencia (SPEC 9).'
    USING ERRCODE = 'restrict_violation';
  RETURN NULL;
END;
$$;

CREATE TRIGGER "recipe_no_se_edita"
  BEFORE UPDATE ON "recipe"
  FOR EACH ROW EXECUTE FUNCTION exigir_receta_inmutable();

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "product_app" ON "product"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "product_migrator" ON "product" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "product_location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_location" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "product_location_app" ON "product_location"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "product_location_migrator" ON "product_location" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "combo_component" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "combo_component" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "combo_component_app" ON "combo_component"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "combo_component_migrator" ON "combo_component" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_app" ON "recipe"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "recipe_migrator" ON "recipe" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_line_app" ON "recipe_line"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "recipe_line_migrator" ON "recipe_line" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe_propagation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_propagation_app" ON "recipe_propagation"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "recipe_propagation_migrator" ON "recipe_propagation" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- `recipe_propagation_target` NO tiene `company_id` propio: cuelga de la
-- propagacion, que si lo tiene. Su politica se apoya en esa fila, que es la que
-- RLS ya filtra. Una columna repetida seria un segundo sitio donde el tenant
-- podria discrepar.
ALTER TABLE "recipe_propagation_target" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_propagation_target" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_propagation_target_app" ON "recipe_propagation_target"
  FOR ALL TO costeo_app
  USING (EXISTS (SELECT 1 FROM "recipe_propagation" p
                 WHERE p."id" = "propagation_id" AND p."company_id" = current_company()))
  WITH CHECK (EXISTS (SELECT 1 FROM "recipe_propagation" p
                      WHERE p."id" = "propagation_id" AND p."company_id" = current_company()));
CREATE POLICY "recipe_propagation_target_migrator" ON "recipe_propagation_target"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "product_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "product_type_lectura" ON "product_type" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "product_type_migrator" ON "product_type" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "product_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "product_status_lectura" ON "product_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "product_status_migrator" ON "product_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe_line_base" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_base" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_line_base_lectura" ON "recipe_line_base" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "recipe_line_base_migrator" ON "recipe_line_base" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe_line_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_line_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_line_status_lectura" ON "recipe_line_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "recipe_line_status_migrator" ON "recipe_line_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "recipe_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "recipe_status_lectura" ON "recipe_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "recipe_status_migrator" ON "recipe_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);
-- ===== MANUAL: END =====
