-- CreateTable
CREATE TABLE "period_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "period_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "period" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "status" TEXT NOT NULL,
    "closed_at" TIMESTAMPTZ(6),
    "closed_by" UUID,
    "reopened_at" TIMESTAMPTZ(6),
    "reopened_by" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_count_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "physical_count_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "physical_count" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "cutoff_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_period_id" UUID,
    "theoretical_value" DECIMAL(24,12),
    "covered_value" DECIMAL(24,12),
    "physical_value" DECIMAL(24,12),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "confirmed_by" UUID,
    "note" TEXT,

    CONSTRAINT "physical_count_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "physical_count_line" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "count_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "quantity" DECIMAL(24,12),
    "theoretical_quantity" DECIMAL(24,12),
    "unit_cost" DECIMAL(24,12),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "physical_count_line_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "period_company_id_location_id_starts_at_idx" ON "period"("company_id", "location_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "period_company_id_location_id_year_month_key" ON "period"("company_id", "location_id", "year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "period_id_company_id_key" ON "period"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_count_confirmed_period_id_key" ON "physical_count"("confirmed_period_id");

-- CreateIndex
CREATE INDEX "physical_count_company_id_period_id_idx" ON "physical_count"("company_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_count_id_company_id_key" ON "physical_count"("id", "company_id");

-- CreateIndex
CREATE INDEX "physical_count_line_company_id_count_id_idx" ON "physical_count_line"("company_id", "count_id");

-- CreateIndex
CREATE UNIQUE INDEX "physical_count_line_count_id_item_id_key" ON "physical_count_line"("count_id", "item_id");

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_location_id_company_id_fkey" FOREIGN KEY ("location_id", "company_id") REFERENCES "location"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_status_fkey" FOREIGN KEY ("status") REFERENCES "period_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_closed_by_fkey" FOREIGN KEY ("closed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "period" ADD CONSTRAINT "period_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count" ADD CONSTRAINT "physical_count_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count" ADD CONSTRAINT "physical_count_period_id_company_id_fkey" FOREIGN KEY ("period_id", "company_id") REFERENCES "period"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count" ADD CONSTRAINT "physical_count_status_fkey" FOREIGN KEY ("status") REFERENCES "physical_count_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count" ADD CONSTRAINT "physical_count_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count" ADD CONSTRAINT "physical_count_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_line" ADD CONSTRAINT "physical_count_line_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_line" ADD CONSTRAINT "physical_count_line_count_id_company_id_fkey" FOREIGN KEY ("count_id", "company_id") REFERENCES "physical_count"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "physical_count_line" ADD CONSTRAINT "physical_count_line_item_id_company_id_fkey" FOREIGN KEY ("item_id", "company_id") REFERENCES "item"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> semillas -> privilegios -> triggers -> RLS.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "period_status"
  ADD CONSTRAINT "period_status_codigo_conocido" CHECK ("code" IN ('ABIERTO', 'CERRADO'));

ALTER TABLE "physical_count_status"
  ADD CONSTRAINT "physical_count_status_codigo_conocido"
    CHECK ("code" IN ('BORRADOR', 'CONFIRMADO'));

ALTER TABLE "period"
  ADD CONSTRAINT "period_mes_valido" CHECK ("month" BETWEEN 1 AND 12),
  ADD CONSTRAINT "period_anio_valido" CHECK ("year" BETWEEN 2000 AND 2100),

  -- El intervalo es semiabierto [starts_at, ends_at) y no puede estar vacio ni
  -- invertido: si lo estuviera, un mes cerrado no bloquearia nada y el bloqueo
  -- fallaria en silencio, que es el peor modo de fallo posible aqui.
  ADD CONSTRAINT "period_rango_coherente" CHECK ("ends_at" > "starts_at"),

  ADD CONSTRAINT "period_cierre_coherente"
    CHECK (("closed_at" IS NULL) = ("closed_by" IS NULL)),
  ADD CONSTRAINT "period_cerrado_tiene_autor"
    CHECK ("status" <> 'CERRADO' OR "closed_at" IS NOT NULL),
  ADD CONSTRAINT "period_reapertura_coherente"
    CHECK (("reopened_at" IS NULL) = ("reopened_by" IS NULL)),

  -- No se reabre lo que nunca se cerro. El rastro del cierre SE CONSERVA tras
  -- la reapertura a proposito: la fila dice cuando se sello y quien lo hizo, y
  -- la historia completa de idas y venidas vive en `audit_log`, que si es
  -- append-only.
  ADD CONSTRAINT "period_reapertura_exige_cierre"
    CHECK ("reopened_at" IS NULL OR "closed_at" IS NOT NULL);

ALTER TABLE "physical_count"
  ADD CONSTRAINT "physical_count_confirmacion_coherente"
    CHECK (("confirmed_at" IS NULL) = ("confirmed_by" IS NULL)),
  ADD CONSTRAINT "physical_count_confirmado_tiene_fecha"
    CHECK (("status" = 'CONFIRMADO') = ("confirmed_at" IS NOT NULL)),

  -- La copia que expresa "un solo conteo confirmado por periodo" con un indice
  -- unico corriente. Estas dos restricciones son lo que impide que la copia se
  -- despegue de su original y la unicidad deje de significar lo que dice.
  ADD CONSTRAINT "physical_count_confirmado_marca_periodo"
    CHECK (("status" = 'CONFIRMADO') = ("confirmed_period_id" IS NOT NULL)),
  ADD CONSTRAINT "physical_count_periodo_confirmado_es_el_suyo"
    CHECK ("confirmed_period_id" IS NULL OR "confirmed_period_id" = "period_id"),

  -- Los tres valores se congelan JUNTOS o no se congela ninguno: con uno solo
  -- relleno, la cobertura saldria de un cociente a medias.
  --
  -- NO HAY CHECK DE "cubierto <= teorico", y la ausencia es deliberada: el
  -- stock teorico de un item puede ser NEGATIVO —significa "faltan compras",
  -- SPEC 18— y con valores negativos esa desigualdad es falsa sin que nada
  -- este mal. Una restriccion que rechaza datos correctos es peor que ninguna.
  ADD CONSTRAINT "physical_count_valores_congelados_juntos" CHECK (
    ("theoretical_value" IS NULL) = ("covered_value" IS NULL)
    AND ("theoretical_value" IS NULL) = ("physical_value" IS NULL)),
  ADD CONSTRAINT "physical_count_confirmado_tiene_valores"
    CHECK (("status" = 'CONFIRMADO') = ("theoretical_value" IS NOT NULL)),

  ADD CONSTRAINT "physical_count_note_acotada"
    CHECK ("note" IS NULL OR length("note") <= 500);

ALTER TABLE "physical_count_line"
  -- NULL es "sin verificar" y cero es "mire y no habia" (D7). Lo que no existe
  -- es contar en negativo: eso es un error de captura.
  ADD CONSTRAINT "physical_count_line_cantidad_no_negativa"
    CHECK ("quantity" IS NULL OR "quantity" >= 0),
  ADD CONSTRAINT "physical_count_line_congelados_juntos"
    CHECK (("theoretical_quantity" IS NULL) = ("unit_cost" IS NULL)),
  ADD CONSTRAINT "physical_count_line_costo_no_negativo"
    CHECK ("unit_cost" IS NULL OR "unit_cost" >= 0);

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "period_status" ("code") VALUES ('ABIERTO'), ('CERRADO');
INSERT INTO "physical_count_status" ("code") VALUES ('BORRADOR'), ('CONFIRMADO');

INSERT INTO "permission" ("code", "domain") VALUES
  ('period.read',   'periods'),
  ('period.close',  'periods'),
  ('period.reopen', 'periods'),
  ('count.write',   'inventory'),
  ('count.read',    'inventory');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r,
                   unnest(ARRAY['period.read', 'period.close',
                                'count.write', 'count.read']) AS p;

INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  -- REABRIR ES SOLO DEL OWNER (D6). Reabrir un mes permite mover cifras que ya
  -- se informaron: es una decision de control interno, no una tarea operativa.
  ('OWNER', 'period.reopen'),

  ('GERENTE_LOCAL', 'period.read'),
  ('GERENTE_LOCAL', 'period.close'),
  ('GERENTE_LOCAL', 'count.write'),
  ('GERENTE_LOCAL', 'count.read'),

  ('LECTURA', 'period.read'),
  ('LECTURA', 'count.read'),

  -- BODEGA CUENTA PERO NO CONCILIA, y es la misma asimetria que P6 instalo
  -- sobre el saldo. Tiene `count.write` porque contar es su trabajo; no tiene
  -- `count.read` porque la conciliacion lleva el stock teorico, la diferencia
  -- y su valorizacion, que son tres de los datos prohibidos de CLAUDE.md 4.3.
  --
  -- El efecto colateral es el que SPEC 4 pide expresamente: BODEGA cuenta A
  -- CIEGAS, sin saber cuanto deberia haber. Quien conoce el numero esperado
  -- tiende a ajustar el conteo hacia el, asi que la restriccion de
  -- confidencialidad MEJORA la calidad del dato de inventario.
  --
  -- `period.read` si se le concede: saber que un mes esta cerrado no permite
  -- despejar nada, y sin ello no entenderia por que le rechazan una compra.
  ('BODEGA', 'period.read'),
  ('BODEGA', 'count.write');

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('period.closed',    'periods',   true),
  ('period.reopened',  'periods',   true),
  ('count.created',    'inventory', true),
  ('count.confirmed',  'inventory', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios ------------------------------------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql), asi
-- que cada tabla nace sin UPDATE ni DELETE y hay que pedir explicitamente lo
-- que de verdad se usa. El orden es el de P0 y es a proposito: si falta un
-- GRANT, las pruebas fallan con 42501 el primer dia; si el defecto fuera al
-- reves y faltara un REVOKE, el libro dejaria de ser append-only en silencio.

-- Cerrar y reabrir cambian `status` de una fila existente.
GRANT UPDATE ON TABLE "period" TO costeo_app;
-- Confirmar congela los tres valores sobre la fila del conteo.
GRANT UPDATE ON TABLE "physical_count" TO costeo_app;
-- La hoja de conteo se reescribe entera mientras sea borrador.
GRANT UPDATE, DELETE ON TABLE "physical_count_line" TO costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "period_status"         FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "physical_count_status" FROM costeo_app;

-- --- El libro no admite movimientos en un mes cerrado (D6) ------------------
--
-- ESTA ES LA GARANTIA, NO LA GUARDA. `ExigirPeriodoAbierto` traduce el rechazo
-- a un 409 con mensaje, pero vive en las cinco escrituras del libro y una
-- sexta que alguien anada manana podria olvidarla. El trigger no: cubre toda
-- fila que entre, venga de donde venga.
--
-- ALCANZA TAMBIEN A LA CORRECCION, y no es un efecto colateral. Una correccion
-- conserva la fecha del movimiento que anula (R3), asi que corregir dentro de
-- un mes sellado tambien se detiene aqui. Eso es exactamente lo que "cerrado
-- es de solo lectura" significa.
--
-- El SELECT corre bajo RLS con el rol de la aplicacion, asi que solo ve
-- periodos de la misma company. Es lo correcto: `NEW.company_id` ya tiene que
-- coincidir con `current_company()` para que la propia insercion pase.

CREATE FUNCTION rechazar_movimiento_en_periodo_cerrado() RETURNS trigger AS $rechazo$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "period" p
     WHERE p."company_id"  = NEW."company_id"
       AND p."location_id" = NEW."location_id"
       AND p."status"      = 'CERRADO'
       AND NEW."occurred_at" >= p."starts_at"
       AND NEW."occurred_at" <  p."ends_at")
  THEN
    RAISE EXCEPTION
      'El periodo de esa ubicacion esta cerrado y no admite movimientos con esa fecha. Para modificarlo hay que reabrirlo primero.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$rechazo$ LANGUAGE plpgsql;

CREATE TRIGGER "inventory_movement_respeta_periodo_cerrado"
  BEFORE INSERT ON "inventory_movement"
  FOR EACH ROW EXECUTE FUNCTION rechazar_movimiento_en_periodo_cerrado();

-- --- Un conteo confirmado no se edita ---------------------------------------
--
-- Confirmar congela el stock teorico y el costo de cada linea: es lo que hace
-- que la diferencia siga significando lo mismo dentro de un ano. Si el conteo
-- salio mal se abre otro, que es barato.
--
-- FOR EACH ROW y no FOR EACH STATEMENT, al reves que en `audit_log` y en el
-- libro: alli la tabla entera es inmutable y basta con negar la sentencia;
-- aqui lo inmutable son SOLO las filas ya confirmadas, y para distinguirlas
-- hace falta OLD.

CREATE FUNCTION rechazar_edicion_de_conteo_confirmado() RETURNS trigger AS $conteo$
BEGIN
  IF OLD."status" = 'CONFIRMADO' THEN
    RAISE EXCEPTION
      'Ese conteo ya esta confirmado y no admite cambios. Si hay que rehacerlo, abre un conteo nuevo para el mismo periodo.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$conteo$ LANGUAGE plpgsql;

CREATE TRIGGER "physical_count_confirmado_no_se_edita"
  BEFORE UPDATE OR DELETE ON "physical_count"
  FOR EACH ROW EXECUTE FUNCTION rechazar_edicion_de_conteo_confirmado();

-- Y sus lineas tampoco. `TG_OP` decide de donde sale la referencia al conteo:
-- en un DELETE la fila NEW no existe, y leerla ahi seria un error de plpgsql.
CREATE FUNCTION rechazar_linea_de_conteo_confirmado() RETURNS trigger AS $linea$
DECLARE
  conteo uuid;
  estado text;
BEGIN
  IF TG_OP = 'DELETE' THEN conteo := OLD."count_id"; ELSE conteo := NEW."count_id"; END IF;

  SELECT c."status" INTO estado FROM "physical_count" c WHERE c."id" = conteo;

  IF estado = 'CONFIRMADO' THEN
    RAISE EXCEPTION
      'Ese conteo ya esta confirmado y no admite cambios. Si hay que rehacerlo, abre un conteo nuevo para el mismo periodo.'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$linea$ LANGUAGE plpgsql;

CREATE TRIGGER "physical_count_line_solo_en_borrador"
  BEFORE INSERT OR UPDATE OR DELETE ON "physical_count_line"
  FOR EACH ROW EXECUTE FUNCTION rechazar_linea_de_conteo_confirmado();

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "period" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "period_app" ON "period"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "period_migrator" ON "period"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "physical_count" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "physical_count_app" ON "physical_count"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "physical_count_migrator" ON "physical_count"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "physical_count_line" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_line" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "physical_count_line_app" ON "physical_count_line"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "physical_count_line_migrator" ON "physical_count_line"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- Los catalogos tambien llevan RLS. No tienen tenant, pero dejarlos fuera
-- crearia una excepcion a "toda tabla tiene RLS", y una regla con excepciones
-- no se puede automatizar.
ALTER TABLE "period_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "period_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "period_status_lectura" ON "period_status"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "period_status_migrator" ON "period_status"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "physical_count_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "physical_count_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "physical_count_status_lectura" ON "physical_count_status"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "physical_count_status_migrator" ON "physical_count_status"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
