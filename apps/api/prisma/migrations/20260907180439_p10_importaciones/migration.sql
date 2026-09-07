-- CreateTable
CREATE TABLE "import_job_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "import_job_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "import_job" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "analysis" JSONB,
    "written_rows" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_job_company_id_created_at_idx" ON "import_job"("company_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_status_fkey" FOREIGN KEY ("status") REFERENCES "import_job_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: restricciones -> semillas -> privilegios -> RLS.
--
-- QUE ES `import_job` Y QUE NO ES. Es el RASTRO de una importacion, no la
-- importacion. Las filas importadas las escriben los casos de uso de lote de
-- cada modulo dueno —catalog, pricing, recipes, inventory—; aqui solo queda
-- que archivo entro, quien lo metio, que se analizo y como acabo. Por eso esta
-- tabla no tiene ni una clave foranea hacia lo importado: si la tuviera,
-- borrar un item obligaria a decidir que hacer con su historia.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "import_job_status"
  ADD CONSTRAINT "import_job_status_codigo_conocido"
    CHECK ("code" IN ('SUBIDA', 'ANALIZADA', 'CONFIRMADA', 'DESCARTADA'));

ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_tipo_conocido"
    CHECK ("kind" IN ('ITEMS', 'ARTICULOS', 'PRECIOS', 'PRODUCTOS', 'RECETAS', 'MOVIMIENTOS')),

  -- El nombre original es SOLO para ensenarselo a una persona (SEGURIDAD.md
  -- 5.3): no abre ninguna ruta ni decide ningun formato. Se acota porque una
  -- cadena sin techo en una columna que se pinta en pantalla es una via de
  -- ruido, no de ataque, pero ruido que nadie quiere depurar.
  ADD CONSTRAINT "import_job_nombre_no_vacio" CHECK (length(btrim("original_name")) > 0),
  ADD CONSTRAINT "import_job_nombre_acotado"  CHECK (length("original_name") <= 255),

  ADD CONSTRAINT "import_job_clave_no_vacia" CHECK (length(btrim("storage_key")) > 0),

  -- Un archivo de cero bytes no es un archivo vacio: es un archivo que no se
  -- subio. El lector ya lo rechaza (`esTextoPlano` falla con la muestra vacia);
  -- esto lo deja dicho tambien en la base. El TECHO de tamano NO va aqui a
  -- proposito: vive en `infrastructure/limites.ts`, y duplicarlo daria dos
  -- sitios que mantener en sincronia para el mismo numero.
  ADD CONSTRAINT "import_job_tamano_positivo" CHECK ("byte_size" > 0),

  ADD CONSTRAINT "import_job_filas_no_negativas"
    CHECK ("written_rows" IS NULL OR "written_rows" >= 0),

  -- LAS DOS INVARIANTES QUE HACEN QUE ESTE RASTRO VALGA ALGO.
  --
  -- La primera: confirmada si y solo si hay fecha de confirmacion y hay
  -- recuento de filas. Una fila 'CONFIRMADA' sin `confirmed_at` seria una
  -- importacion que ocurrio en un momento que nadie sabe, y el recuento es lo
  -- unico que permite cuadrar lo escrito con lo analizado.
  ADD CONSTRAINT "import_job_confirmada_es_coherente"
    CHECK (("status" = 'CONFIRMADA') = ("confirmed_at" IS NOT NULL)
       AND ("status" = 'CONFIRMADA') = ("written_rows" IS NOT NULL)),

  -- La segunda: analizada o confirmada exige el analisis guardado. Confirmar
  -- NO vuelve a parsear el archivo —escribe exactamente lo que la
  -- previsualizacion enseno—, asi que una confirmada sin analisis seria una
  -- escritura de la que no queda constancia de que se aprobo.
  ADD CONSTRAINT "import_job_analizada_tiene_analisis"
    CHECK ("status" IN ('SUBIDA', 'DESCARTADA') OR "analysis" IS NOT NULL);

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "import_job_status" ("code") VALUES
  ('SUBIDA'), ('ANALIZADA'), ('CONFIRMADA'), ('DESCARTADA');

-- UN PERMISO, Y DE NIVEL COMPANY. `GERENTE_LOCAL` NO LO RECIBE.
--
-- Es el mismo trazo que P4 con `recipe.propagate` y P9 con
-- `analytics.consolidated.read`: importar reescribe el catalogo de la company
-- entera —los items y los precios no son de una ubicacion—, y un gerente manda
-- en su local, no en la cadena. `LECTURA` tampoco: no es una lectura.
--
-- NO se crea `import.read` mientras nada lea. El dia que exista la pantalla de
-- importaciones (P10-autoservicio, pospuesto) se anade con su migracion.
INSERT INTO "permission" ("code", "domain") VALUES
  ('import.write', 'imports');

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, 'import.write' FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r;

-- UN EVENTO POR LOTE, NO UNO POR FILA. Doscientos `catalog.item.created`
-- seguidos no cuentan que hubo una importacion: la esconden. El detalle de que
-- entro vive en `import_job.analysis`; el log de auditoria guarda la ACCION.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('import.confirmed',                     'imports',   true),
  ('catalog.items.bulk_created',           'catalog',   true),
  ('catalog.articles.bulk_created',        'catalog',   true),
  ('pricing.reference_prices.bulk_suggested', 'pricing', true),
  ('product.bulk_created',                 'products',  true),
  ('recipe.bulk_saved',                    'recipes',   true),
  ('inventory.movements.bulk_recorded',    'inventory', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios ------------------------------------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql).
--
-- AQUI SI SE CONCEDE UPDATE, y es la desviacion respecto de P8, donde se nego
-- a proposito. La diferencia es que alli la unidad era el LOTE del mes y se
-- reemplazaba entero; aqui la unidad es UN ARCHIVO y su fila tiene identidad:
-- recorre SUBIDA -> ANALIZADA -> CONFIRMADA y su `id` es el rastro al que se
-- vuelve. Reemplazarla en vez de actualizarla perderia esa identidad.
--
-- NO se concede DELETE. Una importacion descartada sigue siendo algo que paso.
GRANT UPDATE ON TABLE "import_job" TO costeo_app;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE "import_job_status" FROM costeo_app;

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "import_job" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "import_job_app" ON "import_job"
  FOR ALL TO costeo_app USING ("company_id" = current_company()) WITH CHECK ("company_id" = current_company());
CREATE POLICY "import_job_migrator" ON "import_job"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- El catalogo tambien lleva RLS. No tiene tenant, pero dejarlo fuera crearia
-- una excepcion a "toda tabla tiene RLS", y una regla con excepciones no se
-- puede automatizar.
ALTER TABLE "import_job_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "import_job_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "import_job_status_lectura" ON "import_job_status"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "import_job_status_migrator" ON "import_job_status"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
