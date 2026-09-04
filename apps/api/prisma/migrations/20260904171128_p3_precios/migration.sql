-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "iva_compra" DECIMAL(24,12) NOT NULL;

-- CreateTable
CREATE TABLE "reference_price_origin" (
    "code" TEXT NOT NULL,

    CONSTRAINT "reference_price_origin_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "reference_price_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "reference_price_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "reference_price" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "purchase_article_id" UUID,
    "price" DECIMAL(24,12) NOT NULL,
    "iva_compra" DECIMAL(24,12) NOT NULL,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by" UUID,
    "confirmed_at" TIMESTAMPTZ(6),
    "note" TEXT,

    CONSTRAINT "reference_price_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reference_price_company_id_item_id_valid_from_idx" ON "reference_price"("company_id", "item_id", "valid_from" DESC);

-- CreateIndex
CREATE INDEX "reference_price_company_id_status_idx" ON "reference_price"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_article_id_item_id_key" ON "purchase_article"("id", "item_id");

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_origin_fkey" FOREIGN KEY ("origin") REFERENCES "reference_price_origin"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_status_fkey" FOREIGN KEY ("status") REFERENCES "reference_price_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reference_price" ADD CONSTRAINT "reference_price_purchase_article_id_item_id_fkey" FOREIGN KEY ("purchase_article_id", "item_id") REFERENCES "purchase_article"("id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> trigger de ajustes -> semillas -> privilegios -> RLS.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "company_settings"
  -- Los cinco ratios son fracciones. Un IVA de 15 en vez de 0.15 multiplicaria
  -- el costo por dieciseis, y el numero saldria sin que nada avisara.
  ADD CONSTRAINT "company_settings_ratios_son_fracciones" CHECK (
        "iva_venta"              BETWEEN 0 AND 1
    AND "iva_compra"             BETWEEN 0 AND 1
    AND "provision_merma"        BETWEEN 0 AND 1
    AND "food_cost_objetivo"     BETWEEN 0 AND 1
    AND "food_cost_maximo"       BETWEEN 0 AND 1
    AND "food_cost_umbral_verde" BETWEEN 0 AND 1
    AND "prime_cost_maximo"      BETWEEN 0 AND 1
    AND "regla_popularidad"      BETWEEN 0 AND 1),
  -- El semaforo tiene que poder pintar los tres colores.
  ADD CONSTRAINT "company_settings_umbrales_ordenados" CHECK (
    "food_cost_objetivo" <= "food_cost_umbral_verde"
    AND "food_cost_umbral_verde" <= "food_cost_maximo"),
  ADD CONSTRAINT "company_settings_dias_positivos" CHECK (
    "dias_operativos_mes" BETWEEN 1 AND 31 AND "dias_cobertura" >= 1);

ALTER TABLE "reference_price"
  -- Un precio de cero es un dato sin capturar, no un regalo. La formula de
  -- SPEC §12 divide por el factor y por el rendimiento, no por el precio, asi
  -- que el cero no rompe nada: simplemente miente.
  ADD CONSTRAINT "reference_price_positivo" CHECK ("price" > 0),
  ADD CONSTRAINT "reference_price_iva_es_fraccion" CHECK ("iva_compra" BETWEEN 0 AND 1),
  -- R5 EN UNA RESTRICCION: confirmado equivale a tener autor y fecha de
  -- confirmacion. Ni un precio confirmado sin quien lo confirmo, ni un autor de
  -- confirmacion en un precio que sigue sugerido.
  ADD CONSTRAINT "reference_price_confirmacion_coherente" CHECK (
    ("status" = 'CONFIRMED') = ("confirmed_by" IS NOT NULL AND "confirmed_at" IS NOT NULL)),
  ADD CONSTRAINT "reference_price_nota_acotada"
    CHECK ("note" IS NULL OR length("note") <= 500);

-- --- Cada company nace con sus ajustes ---------------------------------------
--
-- POR QUE UN TRIGGER Y NO EL CODIGO DE ALTA. Porque el alta de una company la
-- hace el back office (P11), que todavia no existe, y las de hoy las crean las
-- pruebas y la carga inicial. Un `INSERT` que alguien tenga que acordarse de
-- escribir en tres sitios produce, tarde o temprano, una company sin ajustes —
-- y una company sin ajustes es una company donde el motor de costeo no puede
-- calcular nada.
--
-- Con el trigger, «toda company tiene ajustes» es cierto por construccion.
--
-- Los valores son los de D3, tomados del Excel original. NO se escriben en el
-- codigo: viven aqui, en la semilla, y se editan desde la aplicacion.
CREATE FUNCTION sembrar_ajustes_de_company() RETURNS trigger
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

COMMENT ON FUNCTION sembrar_ajustes_de_company() IS
  'D3: toda company nace con los parametros de costeo del Excel original. Ninguno vive en el codigo.';

CREATE TRIGGER "company_nace_con_ajustes"
  AFTER INSERT ON "company"
  FOR EACH ROW EXECUTE FUNCTION sembrar_ajustes_de_company();

-- Las companies que ya existen tambien los necesitan. Idempotente.
INSERT INTO "company_settings" (
  "company_id", "iva_venta", "iva_compra", "iva_compra_recuperable",
  "provision_merma", "food_cost_objetivo", "food_cost_maximo",
  "food_cost_umbral_verde", "prime_cost_maximo", "regla_popularidad",
  "dias_operativos_mes", "dias_cobertura")
SELECT "id", 0.15, 0.15, true, 0.02, 0.25, 0.32, 0.28, 0.65, 0.70, 22, 7
FROM "company"
ON CONFLICT ("company_id") DO NOTHING;

-- --- Un precio confirmado no se reescribe ------------------------------------
--
-- R5 dice «nunca sobrescritura». El `GRANT UPDATE` que la aplicacion necesita
-- para confirmar un precio no sabe distinguir «cambiar el estado» de «cambiar
-- el importe», asi que la distincion la hace un trigger.
--
-- Lo que se puede cambiar de una fila existente es SOLO su estado, y solo desde
-- `SUGGESTED`. Un precio ya confirmado es historia: corregirlo es una fila
-- nueva con otra vigencia, que es exactamente lo que hace que cambiar el precio
-- de hoy no altere el costo del mes pasado.
CREATE FUNCTION exigir_precio_inmutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD."status" <> 'SUGGESTED' THEN
    RAISE EXCEPTION 'Un precio % no se modifica: un precio nuevo es una fila nueva (R5).', OLD."status"
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW."price" <> OLD."price"
     OR NEW."iva_compra" <> OLD."iva_compra"
     OR NEW."valid_from" <> OLD."valid_from"
     OR NEW."item_id" <> OLD."item_id"
     OR NEW."company_id" <> OLD."company_id"
     OR NEW."origin" <> OLD."origin" THEN
    RAISE EXCEPTION 'De un precio sugerido solo cambia el estado, nunca el importe ni la vigencia (R5).'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "reference_price_solo_cambia_de_estado"
  BEFORE UPDATE ON "reference_price"
  FOR EACH ROW EXECUTE FUNCTION exigir_precio_inmutable();

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "reference_price_origin" ("code") VALUES ('MANUAL'), ('ULTIMA_COMPRA'), ('EXTERNO');

INSERT INTO "reference_price_status" ("code") VALUES ('SUGGESTED'), ('CONFIRMED'), ('REJECTED');

INSERT INTO "permission" ("code", "domain") VALUES
  ('pricing.read',    'pricing'),
  ('pricing.suggest', 'pricing'),
  -- Confirmar es lo que hace vigente un precio, y de ahi salen todos los costos
  -- del negocio. Se separa de `suggest` a proposito: sugerir puede hacerlo
  -- quien registra compras; confirmar es una decision de quien responde por el
  -- margen.
  ('pricing.confirm', 'pricing'),
  ('settings.read',   'company'),
  ('settings.update', 'company');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r,
                   unnest(ARRAY['pricing.read', 'pricing.suggest', 'pricing.confirm',
                                'settings.read', 'settings.update']) AS p;

-- `GERENTE_LOCAL` sugiere y lee, pero NO confirma: ve las compras de su local y
-- es quien primero nota que un precio subio.
INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  ('GERENTE_LOCAL', 'pricing.read'),
  ('GERENTE_LOCAL', 'pricing.suggest'),
  ('GERENTE_LOCAL', 'settings.read'),
  ('LECTURA',       'pricing.read'),
  ('LECTURA',       'settings.read');

-- `BODEGA` NO aparece, y es deliberado (CLAUDE.md §4.3). El precio de
-- referencia es un derivado directo del costo del plato: con el precio y la
-- cantidad se despeja la receta. Es el mismo criterio que deja fuera el consumo
-- teorico y el stock teorico.

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('pricing.reference_price.suggested', 'pricing', true),
  ('pricing.reference_price.confirmed', 'pricing', true),
  ('pricing.reference_price.rejected',  'pricing', true),
  ('company.settings_updated',          'company', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios -------------------------------------------------------------

-- UPDATE solo para confirmar o rechazar: el trigger de arriba impide todo lo
-- demas. Sin DELETE: un precio es historia.
GRANT UPDATE ON TABLE "reference_price" TO costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "reference_price_origin" FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "reference_price_status" FROM costeo_app;

-- La aplicacion no crea ajustes: los crea el trigger al nacer la company. Solo
-- los edita.
REVOKE INSERT, DELETE, TRUNCATE ON TABLE "company_settings" FROM costeo_app;

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "reference_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_price" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reference_price_app" ON "reference_price"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "reference_price_migrator" ON "reference_price"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "reference_price_origin" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_origin" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reference_price_origin_lectura" ON "reference_price_origin" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "reference_price_origin_migrator" ON "reference_price_origin" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "reference_price_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reference_price_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "reference_price_status_lectura" ON "reference_price_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "reference_price_status_migrator" ON "reference_price_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);
-- --- El precio va con su presentacion, salvo en las preparaciones -----------
--
-- Un precio sin presentacion no significa nada: «2.30» solo es un dato junto a
-- «el saco de 2 kg». Por eso un item COMPRADO exige articulo.
--
-- Una preparacion PRODUCIDA no se compra: su precio es el COSTO ESTANDAR por
-- unidad de uso que fija el usuario (SPEC 6, R10), y por eso no lleva articulo.
-- Que el plato no cambie de costo segun cuanto se produjo ese dia es el punto.
--
-- Va en un trigger y no en un CHECK porque la condicion mira OTRA tabla, y un
-- CHECK no puede. La clave foranea COMPUESTA contra `purchase_article(id,
-- item_id)` cubre la otra mitad: el articulo tiene que ser del mismo item.
CREATE FUNCTION exigir_articulo_segun_tipo() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
DECLARE
  tipo text;
BEGIN
  SELECT i."type" INTO tipo FROM "item" i WHERE i."id" = NEW."item_id";

  IF tipo = 'COMPRADO' AND NEW."purchase_article_id" IS NULL THEN
    RAISE EXCEPTION 'Un precio de un item comprado necesita su articulo: el precio es de una presentacion concreta.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF tipo = 'PRODUCIDO' AND NEW."purchase_article_id" IS NOT NULL THEN
    RAISE EXCEPTION 'Una preparacion producida no se compra: su precio es el costo estandar por unidad de uso (R10).'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "reference_price_articulo_segun_tipo"
  BEFORE INSERT ON "reference_price"
  FOR EACH ROW EXECUTE FUNCTION exigir_articulo_segun_tipo();

-- ===== MANUAL: END =====
