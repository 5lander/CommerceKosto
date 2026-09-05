-- CreateTable
CREATE TABLE "product_sales" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "units" DECIMAL(24,12) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "product_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_cost_classification" (
    "code" TEXT NOT NULL,
    "is_percentage" BOOLEAN NOT NULL,

    CONSTRAINT "fixed_cost_classification_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "fixed_cost" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "concept" TEXT NOT NULL,
    "classification" TEXT NOT NULL,
    "amount" DECIMAL(24,12) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,

    CONSTRAINT "fixed_cost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_sales_company_id_period_id_idx" ON "product_sales"("company_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_sales_period_id_product_id_key" ON "product_sales"("period_id", "product_id");

-- CreateIndex
CREATE INDEX "fixed_cost_company_id_period_id_idx" ON "fixed_cost"("company_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_cost_period_id_concept_key" ON "fixed_cost"("period_id", "concept");

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_period_id_company_id_fkey" FOREIGN KEY ("period_id", "company_id") REFERENCES "period"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "product"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_sales" ADD CONSTRAINT "product_sales_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_cost" ADD CONSTRAINT "fixed_cost_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_cost" ADD CONSTRAINT "fixed_cost_period_id_company_id_fkey" FOREIGN KEY ("period_id", "company_id") REFERENCES "period"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_cost" ADD CONSTRAINT "fixed_cost_classification_fkey" FOREIGN KEY ("classification") REFERENCES "fixed_cost_classification"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_cost" ADD CONSTRAINT "fixed_cost_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> semillas -> privilegios -> RLS.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "product_sales"
  -- Vender en negativo no es una devolucion: es un error de captura. Una
  -- devolucion se registra bajando la cifra del mes, que es lo que la grilla
  -- editable de P12 hace.
  ADD CONSTRAINT "product_sales_unidades_no_negativas" CHECK ("units" >= 0),

  -- Las unidades vendidas son ENTERAS. El dominio las modela como `Count`, que
  -- es lo que P5 ya asumia en `totalesDelMes` y lo que menu engineering
  -- necesita para contar. El dia que se vendan medias porciones, el cambio es
  -- soltar este CHECK y no migrar el tipo de la columna.
  ADD CONSTRAINT "product_sales_unidades_enteras" CHECK ("units" = trunc("units"));

ALTER TABLE "fixed_cost_classification"
  ADD CONSTRAINT "fixed_cost_classification_codigo_conocido"
    CHECK ("code" IN ('MANO_DE_OBRA', 'OTRO_FIJO', 'VARIABLE'));

ALTER TABLE "fixed_cost"
  ADD CONSTRAINT "fixed_cost_concepto_no_vacio" CHECK (length(btrim("concept")) > 0),
  ADD CONSTRAINT "fixed_cost_concepto_acotado" CHECK (length("concept") <= 200),

  -- El importe no lleva signo. Un costo negativo es un ingreso, y T6 no es
  -- donde se registran ingresos: la venta entra por `product_sales`.
  ADD CONSTRAINT "fixed_cost_importe_no_negativo" CHECK ("amount" >= 0);

-- --- Semillas de los catalogos ----------------------------------------------

-- `is_percentage` es lo que hace que una sola columna `amount` signifique dos
-- cosas SIN ambiguedad: el catalogo dice cual, y no el nombre del concepto.
INSERT INTO "fixed_cost_classification" ("code", "is_percentage") VALUES
  ('MANO_DE_OBRA', false),
  ('OTRO_FIJO',    false),
  -- Comisiones de tarjeta, delivery, propinas: escalan con la venta, asi que
  -- su importe es una FRACCION de la venta neta (SPEC 17:
  -- `costos_variables_adic = venta_neta x pct_variable_total`).
  ('VARIABLE',     true);

INSERT INTO "permission" ("code", "domain") VALUES
  ('sales.read',        'analytics'),
  ('sales.write',       'analytics'),
  ('cost.read',         'analytics'),
  ('cost.write',        'analytics'),
  ('analytics.read',    'analytics'),
  ('replenishment.read','analytics');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN', 'GERENTE_LOCAL']) AS r,
                   unnest(ARRAY['sales.read', 'sales.write', 'cost.read',
                                'cost.write', 'analytics.read',
                                'replenishment.read']) AS p;

INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  ('LECTURA', 'sales.read'),
  ('LECTURA', 'cost.read'),
  ('LECTURA', 'analytics.read'),
  ('LECTURA', 'replenishment.read'),

  -- BODEGA SOLO RECIBE EL SEMAFORO, y es la tercera vez que aparece la misma
  -- asimetria: P6 le nego el saldo, P7 la conciliacion, y P8 le niega las seis
  -- vistas enteras. Todas llevan consumo teorico, stock teorico, diferencias o
  -- costos, que son cuatro de los seis datos prohibidos de CLAUDE.md 4.3.
  --
  -- Lo que SI le corresponde —SPEC 4 lo dice con estas palabras— es un
  -- semaforo REPONER/OK **sin la cantidad que lo origina**. Se sirve por un
  -- endpoint propio, no por un filtro sobre la vista de inventario: un campo
  -- que se calcula y luego se quita ya viajo por el cable alguna vez.
  ('BODEGA', 'replenishment.read');

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('sales.recorded',      'analytics', true),
  ('fixed_cost.recorded', 'analytics', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios ------------------------------------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql). Las
-- dos tablas se cargan en LOTE y por reemplazo —es una grilla del mes, no un
-- alta a alta—, asi que necesitan DELETE ademas del INSERT que ya tienen.
--
-- NO SE CONCEDE UPDATE, y la ausencia es deliberada: reemplazar el lote entero
-- deja el estado igual al que el usuario ve en pantalla, sin tener que
-- averiguar que fila cambio. Un UPDATE parcial abriria la puerta a dejar la
-- mitad de la grilla del mes pasado mezclada con la de este.
GRANT DELETE ON TABLE "product_sales" TO costeo_app;
GRANT DELETE ON TABLE "fixed_cost"    TO costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE "fixed_cost_classification" FROM costeo_app;

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "product_sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_sales" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "product_sales_app" ON "product_sales"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "product_sales_migrator" ON "product_sales"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "fixed_cost" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "fixed_cost_app" ON "fixed_cost"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "fixed_cost_migrator" ON "fixed_cost"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- El catalogo tambien lleva RLS. No tiene tenant, pero dejarlo fuera crearia
-- una excepcion a "toda tabla tiene RLS", y una regla con excepciones no se
-- puede automatizar.
ALTER TABLE "fixed_cost_classification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "fixed_cost_classification" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "fixed_cost_classification_lectura" ON "fixed_cost_classification"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "fixed_cost_classification_migrator" ON "fixed_cost_classification"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
