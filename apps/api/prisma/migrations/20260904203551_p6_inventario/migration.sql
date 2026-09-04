-- CreateTable
CREATE TABLE "inventory_movement_type" (
    "code" TEXT NOT NULL,
    "direction" TEXT NOT NULL,

    CONSTRAINT "inventory_movement_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "inventory_movement" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "total_cost" DECIMAL(24,12),
    "purchase_article_id" UUID,
    "transfer_id" UUID,
    "production_id" UUID,
    "reverses_movement_id" UUID,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "note" TEXT,

    CONSTRAINT "inventory_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_transfer" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "from_location_id" UUID NOT NULL,
    "to_location_id" UUID NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "note" TEXT,

    CONSTRAINT "inventory_transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_production" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(24,12) NOT NULL,
    "standard_unit_cost" DECIMAL(24,12) NOT NULL,
    "standard_total" DECIMAL(24,12) NOT NULL,
    "real_total" DECIMAL(24,12) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "note" TEXT,

    CONSTRAINT "inventory_production_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movement_type_code_direction_key" ON "inventory_movement_type"("code", "direction");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_movement_reverses_movement_id_key" ON "inventory_movement"("reverses_movement_id");

-- CreateIndex
CREATE INDEX "inventory_movement_company_id_location_id_occurred_at_idx" ON "inventory_movement"("company_id", "location_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movement_company_id_location_id_item_id_occurred__idx" ON "inventory_movement"("company_id", "location_id", "item_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inventory_movement_company_id_transfer_id_idx" ON "inventory_movement"("company_id", "transfer_id");

-- CreateIndex
CREATE INDEX "inventory_movement_company_id_production_id_idx" ON "inventory_movement"("company_id", "production_id");

-- CreateIndex
CREATE INDEX "inventory_transfer_company_id_occurred_at_idx" ON "inventory_transfer"("company_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "inventory_production_company_id_location_id_occurred_at_idx" ON "inventory_production"("company_id", "location_id", "occurred_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "location_id_company_id_key" ON "location"("id", "company_id");

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_location_id_company_id_fkey" FOREIGN KEY ("location_id", "company_id") REFERENCES "location"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_item_id_company_id_fkey" FOREIGN KEY ("item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_type_direction_fkey" FOREIGN KEY ("type", "direction") REFERENCES "inventory_movement_type"("code", "direction") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_purchase_article_id_item_id_fkey" FOREIGN KEY ("purchase_article_id", "item_id") REFERENCES "purchase_article"("id", "item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_transfer_id_fkey" FOREIGN KEY ("transfer_id") REFERENCES "inventory_transfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_production_id_fkey" FOREIGN KEY ("production_id") REFERENCES "inventory_production"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_reverses_movement_id_fkey" FOREIGN KEY ("reverses_movement_id") REFERENCES "inventory_movement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movement" ADD CONSTRAINT "inventory_movement_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_from_location_id_company_id_fkey" FOREIGN KEY ("from_location_id", "company_id") REFERENCES "location"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_to_location_id_company_id_fkey" FOREIGN KEY ("to_location_id", "company_id") REFERENCES "location"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_transfer" ADD CONSTRAINT "inventory_transfer_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_production" ADD CONSTRAINT "inventory_production_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_production" ADD CONSTRAINT "inventory_production_location_id_company_id_fkey" FOREIGN KEY ("location_id", "company_id") REFERENCES "location"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_production" ADD CONSTRAINT "inventory_production_item_id_company_id_fkey" FOREIGN KEY ("item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_production" ADD CONSTRAINT "inventory_production_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> semillas -> privilegios -> append-only -> RLS.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "inventory_movement_type"
  ADD CONSTRAINT "inventory_movement_type_direccion_valida"
    CHECK ("direction" IN ('ENTRADA', 'SALIDA', 'AMBAS'));

ALTER TABLE "inventory_movement"
  -- Un movimiento de cantidad CERO es una fila que no mueve nada y que alguien
  -- tendra que interpretar dentro de un ano. El libro registra hechos, y "no
  -- paso nada" no es uno.
  ADD CONSTRAINT "inventory_movement_cantidad_no_nula" CHECK ("quantity" <> 0),

  -- EL SIGNO DICE LO MISMO QUE EL TIPO.
  --
  -- Una COMPRA que resta y una MERMA que suma son, cada una, un saldo
  -- equivocado que nadie va a cuestionar porque el numero resultante es
  -- perfectamente plausible. Un CHECK no puede consultar la tabla de tipos,
  -- asi que la direccion viaja EN la fila y una FK compuesta (type, direction)
  -- impide que discrepe de su catalogo. Mismo mecanismo que P3 uso para atar
  -- el articulo de compra a su item.
  --
  -- LA EXCEPCION ES LA CORRECCION, y esta acotada a ella. Corregir una COMPRA
  -- produce una COMPRA negativa: tiene que ser del MISMO tipo o
  -- `compras_del_mes = SUM(movimientos tipo COMPRA)` (SPEC 16) seguiria
  -- contando una compra anulada. La regla de signos protege la CAPTURA —que
  -- nadie escriba una merma al reves— y una correccion no es captura: su
  -- cantidad no la escribe nadie, se deriva del movimiento que anula.
  ADD CONSTRAINT "inventory_movement_signo_segun_direccion" CHECK (
        "reverses_movement_id" IS NOT NULL
     OR "direction" = 'AMBAS'
     OR ("direction" = 'ENTRADA' AND "quantity" > 0)
     OR ("direction" = 'SALIDA'  AND "quantity" < 0)),

  -- El importe es una MAGNITUD: el sentido lo lleva la cantidad. Guardarlo con
  -- signo tambien dejaria dos sitios donde el sentido puede discrepar.
  ADD CONSTRAINT "inventory_movement_importe_no_negativo"
    CHECK ("total_cost" IS NULL OR "total_cost" >= 0),

  -- COMPRA y PRODUCCION tienen que traer importe: son los dos tipos que
  -- alimentan cifras de dinero (SPEC 16, R10). Sin el, `compras_del_mes` sale
  -- corta y la varianza del lote no se puede calcular.
  ADD CONSTRAINT "inventory_movement_importe_obligatorio" CHECK (
    "type" NOT IN ('COMPRA', 'PRODUCCION') OR "total_cost" IS NOT NULL),

  -- Las dos patas de una transferencia tienen que poder encontrarse.
  ADD CONSTRAINT "inventory_movement_transferencia_agrupada" CHECK (
    ("type" IN ('TRANSFERENCIA_SALIDA', 'TRANSFERENCIA_ENTRADA')) = ("transfer_id" IS NOT NULL)),

  -- Y el alta y los consumos de un lote, lo mismo. Es lo que hace seguro que
  -- PRODUCCION sea bidireccional: lo que protege no es el signo, es el grupo.
  ADD CONSTRAINT "inventory_movement_produccion_agrupada" CHECK (
    ("type" = 'PRODUCCION') = ("production_id" IS NOT NULL)),

  -- Solo una compra tiene articulo: es la presentacion en que se compro.
  ADD CONSTRAINT "inventory_movement_articulo_solo_en_compra" CHECK (
    "purchase_article_id" IS NULL OR "type" = 'COMPRA'),

  -- El libro registra lo que YA ocurrio. El minuto de holgura absorbe la
  -- deriva entre el reloj del cliente y el del servidor, igual que audit_log.
  ADD CONSTRAINT "inventory_movement_fecha_no_futura"
    CHECK ("occurred_at" <= now() + interval '1 minute'),

  -- Un movimiento no se anula a si mismo.
  ADD CONSTRAINT "inventory_movement_no_se_corrige_a_si_mismo"
    CHECK ("reverses_movement_id" IS NULL OR "reverses_movement_id" <> "id"),

  ADD CONSTRAINT "inventory_movement_note_acotada"
    CHECK ("note" IS NULL OR length("note") <= 500);

ALTER TABLE "inventory_transfer"
  -- Transferir a la misma ubicacion no mueve nada y deja dos filas que solo
  -- sirven para confundir un arqueo.
  ADD CONSTRAINT "inventory_transfer_origen_distinto_de_destino"
    CHECK ("from_location_id" <> "to_location_id"),
  ADD CONSTRAINT "inventory_transfer_fecha_no_futura"
    CHECK ("occurred_at" <= now() + interval '1 minute'),
  ADD CONSTRAINT "inventory_transfer_note_acotada"
    CHECK ("note" IS NULL OR length("note") <= 500);

ALTER TABLE "inventory_production"
  ADD CONSTRAINT "inventory_production_cantidad_positiva" CHECK ("quantity" > 0),
  ADD CONSTRAINT "inventory_production_costos_no_negativos" CHECK (
    "standard_unit_cost" >= 0 AND "standard_total" >= 0 AND "real_total" >= 0),
  ADD CONSTRAINT "inventory_production_fecha_no_futura"
    CHECK ("occurred_at" <= now() + interval '1 minute'),
  ADD CONSTRAINT "inventory_production_note_acotada"
    CHECK ("note" IS NULL OR length("note") <= 500);

-- --- Semillas de los catalogos ----------------------------------------------

-- Los siete tipos del SPEC 7, con lo que cada uno hace al saldo.
INSERT INTO "inventory_movement_type" ("code", "direction") VALUES
  ('COMPRA',                'ENTRADA'),
  ('TRANSFERENCIA_ENTRADA', 'ENTRADA'),
  ('TRANSFERENCIA_SALIDA',  'SALIDA'),
  ('MERMA',                 'SALIDA'),
  ('CONSUMO_POR_VENTA',     'SALIDA'),
  -- Bidireccional porque una produccion mueve el libro en los dos sentidos a
  -- la vez —da de alta la preparacion y consume sus insumos— y las dos mitades
  -- son el mismo hecho.
  ('PRODUCCION',            'AMBAS'),
  -- Bidireccional porque existe precisamente para mover el saldo en la
  -- direccion que haga falta.
  ('AJUSTE',                'AMBAS');

INSERT INTO "permission" ("code", "domain") VALUES
  ('inventory.read',     'inventory'),
  ('inventory.write',    'inventory'),
  ('inventory.transfer', 'inventory'),
  ('inventory.produce',  'inventory');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r,
                   unnest(ARRAY['inventory.read', 'inventory.write',
                                'inventory.transfer', 'inventory.produce']) AS p;

INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  ('GERENTE_LOCAL', 'inventory.read'),
  ('GERENTE_LOCAL', 'inventory.write'),
  ('GERENTE_LOCAL', 'inventory.transfer'),
  ('GERENTE_LOCAL', 'inventory.produce'),
  ('LECTURA',       'inventory.read'),

  -- BODEGA ESCRIBE EL LIBRO PERO NO LO LEE, y esa asimetria es la regla mas
  -- dura de este paquete. No es una precaucion de mas:
  --
  --     saldo = inicial + compras - consumo
  --
  -- BODEGA conoce el inicial y las compras, porque las registra el. Si ademas
  -- ve el saldo, DESPEJA EL CONSUMO; y el consumo dividido entre las unidades
  -- vendidas es, literalmente, la cantidad de la receta (CLAUDE.md 4.3). La
  -- receta es el secreto de negocio del cliente.
  --
  -- Por eso `inventory.read` no aparece aqui, y por eso ningun endpoint de
  -- escritura devuelve el saldo resultante: una respuesta que diga "nuevo
  -- saldo: 12,4 kg" filtra exactamente lo mismo que un endpoint de lectura.
  --
  -- Lo que BODEGA necesita para reponer es un semaforo REPONER/OK SIN la
  -- cantidad que lo origina. Ese semaforo necesita el punto de reorden, que
  -- sale del consumo teorico de SPEC 18: llega en P8, con su vista. Inventarlo
  -- aqui seria una columna que alguien tendria que rellenar a ojo.
  ('BODEGA',        'inventory.write'),
  ('BODEGA',        'inventory.transfer');

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('inventory.movement.recorded',   'inventory', true),
  ('inventory.transfer.completed',  'inventory', true),
  ('inventory.production.recorded', 'inventory', true),
  ('inventory.correction.recorded', 'inventory', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios: append-only, capa 1 de 3 ----------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql), asi
-- que las tres tablas nacen sin UPDATE ni DELETE. Este REVOKE es explicito
-- igualmente, para que la intencion quede escrita donde se lee la tabla.

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE "inventory_movement" FROM costeo_app;

-- La cabecera de una transferencia y la de un lote tampoco se editan: son el
-- encabezado de hechos que ya estan en el libro.
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "inventory_transfer"   FROM costeo_app;
REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "inventory_production" FROM costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE "inventory_movement_type" FROM costeo_app;

-- --- Append-only, capa 2 de 3: trigger --------------------------------------
--
-- FOR EACH STATEMENT, NO FOR EACH ROW, por la misma razon que en `audit_log`:
-- con FORCE ROW LEVEL SECURITY activo y sin politica de DELETE, un
-- `DELETE FROM inventory_movement` ejecutado por el DUENO afecta a CERO filas,
-- un trigger de fila nunca llega a dispararse, y el borrado "tiene exito" en
-- silencio. Esta capa cubre lo que la de privilegios no puede: al dueno.
--
-- `rechazar_mutacion()` ya existe desde P0 y su mensaje ya dice lo que hay que
-- hacer en su lugar: "un error se corrige con una fila nueva".

CREATE TRIGGER "inventory_movement_sin_mutacion"
  BEFORE UPDATE OR DELETE ON "inventory_movement"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

CREATE TRIGGER "inventory_movement_sin_truncado"
  BEFORE TRUNCATE ON "inventory_movement"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

CREATE TRIGGER "inventory_transfer_sin_mutacion"
  BEFORE UPDATE OR DELETE ON "inventory_transfer"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

CREATE TRIGGER "inventory_production_sin_mutacion"
  BEFORE UPDATE OR DELETE ON "inventory_production"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "inventory_movement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "inventory_movement_app" ON "inventory_movement"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "inventory_movement_migrator" ON "inventory_movement"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "inventory_transfer" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_transfer" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "inventory_transfer_app" ON "inventory_transfer"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "inventory_transfer_migrator" ON "inventory_transfer"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "inventory_production" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_production" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "inventory_production_app" ON "inventory_production"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "inventory_production_migrator" ON "inventory_production"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- El catalogo tambien lleva RLS. No tiene tenant, pero dejarlo fuera crearia
-- una excepcion a "toda tabla tiene RLS", y una regla con excepciones no se
-- puede automatizar.
ALTER TABLE "inventory_movement_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory_movement_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "inventory_movement_type_lectura" ON "inventory_movement_type"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "inventory_movement_type_migrator" ON "inventory_movement_type"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
