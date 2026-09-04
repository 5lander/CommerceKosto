-- CreateTable
CREATE TABLE "unit" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "factor_to_base" DECIMAL(24,12) NOT NULL,

    CONSTRAINT "unit_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "unit_dimension" (
    "code" TEXT NOT NULL,

    CONSTRAINT "unit_dimension_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "item_type" (
    "code" TEXT NOT NULL,

    CONSTRAINT "item_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "item_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "item_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "price_confidence" (
    "code" TEXT NOT NULL,

    CONSTRAINT "price_confidence_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "item_group" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "unit_of_use" TEXT NOT NULL,
    "yield" DECIMAL(24,12) NOT NULL,
    "group_id" UUID,
    "status" TEXT NOT NULL,
    "price_confidence" TEXT NOT NULL,
    "keeps_stock" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_article" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "supplier" TEXT,
    "presentation_amount" DECIMAL(24,12) NOT NULL,
    "presentation_unit" TEXT NOT NULL,
    "conversion_factor" DECIMAL(24,12) NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "unit_dimension_idx" ON "unit"("dimension");

-- CreateIndex
CREATE UNIQUE INDEX "item_group_company_id_name_key" ON "item_group"("company_id", "name");

-- CreateIndex
CREATE INDEX "item_company_id_status_idx" ON "item"("company_id", "status");

-- CreateIndex
CREATE INDEX "item_company_id_type_idx" ON "item"("company_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "item_company_id_name_key" ON "item"("company_id", "name");

-- CreateIndex
CREATE INDEX "purchase_article_company_id_item_id_idx" ON "purchase_article"("company_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_article_company_id_name_key" ON "purchase_article"("company_id", "name");

-- AddForeignKey
ALTER TABLE "unit" ADD CONSTRAINT "unit_dimension_fkey" FOREIGN KEY ("dimension") REFERENCES "unit_dimension"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_group" ADD CONSTRAINT "item_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_type_fkey" FOREIGN KEY ("type") REFERENCES "item_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_unit_of_use_fkey" FOREIGN KEY ("unit_of_use") REFERENCES "unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "item_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_status_fkey" FOREIGN KEY ("status") REFERENCES "item_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_price_confidence_fkey" FOREIGN KEY ("price_confidence") REFERENCES "price_confidence"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_article" ADD CONSTRAINT "purchase_article_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_article" ADD CONSTRAINT "purchase_article_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_article" ADD CONSTRAINT "purchase_article_presentation_unit_fkey" FOREIGN KEY ("presentation_unit") REFERENCES "unit"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_article" ADD CONSTRAINT "purchase_article_status_fkey" FOREIGN KEY ("status") REFERENCES "item_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- Lo que Prisma no sabe declarar y este paquete exige: la extension de
-- similitud, las restricciones de integridad, las semillas de los catalogos,
-- el indice trigrama, los privilegios y las politicas RLS.
--
-- ORDEN: extension -> restricciones -> semillas -> indices -> privilegios -> RLS.

-- --- Extension de similitud --------------------------------------------------
--
-- `pg_trgm` es una extension CONFIABLE desde PostgreSQL 13, asi que
-- `costeo_migrator` puede instalarla sin ser superusuario. Ya la crea
-- `docker/postgres/initdb/sql/grants.sql` en todo entorno nuevo; se repite aqui
-- —de forma idempotente— para que la migracion sea autocontenida y no dependa
-- de como se aprovisiono la base.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "unit"
  ADD CONSTRAINT "unit_code_en_minusculas" CHECK ("code" = lower("code")),
  -- El factor a la unidad base es una constante fisica: nunca cero ni negativo.
  ADD CONSTRAINT "unit_factor_positivo" CHECK ("factor_to_base" > 0);

ALTER TABLE "item_group"
  ADD CONSTRAINT "item_group_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200);

ALTER TABLE "item"
  ADD CONSTRAINT "item_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  -- El rendimiento es una FRACCION aprovechable: nunca mayor que 1. Un
  -- rendimiento de 1.2 significaria que limpiar el producto crea materia, y el
  -- costo saldria mas barato que el precio de compra sin que nada avisara.
  --
  -- El CERO SI se admite, y no es un descuido: SPEC §12 lo trata como guarda
  -- explicita (`rendimiento = 0 ? 0 : ...`). Es el caso de un item cuyo
  -- rendimiento todavia no se midio.
  ADD CONSTRAINT "item_yield_es_fraccion" CHECK ("yield" >= 0 AND "yield" <= 1),
  -- `keeps_stock` solo tiene sentido para una preparacion (SPEC §5). Sin esto,
  -- un item COMPRADO con `keeps_stock = false` seria una fila que nadie sabe
  -- interpretar.
  ADD CONSTRAINT "item_keeps_stock_solo_en_producido"
    CHECK (("type" = 'PRODUCIDO') = ("keeps_stock" IS NOT NULL));

ALTER TABLE "purchase_article"
  ADD CONSTRAINT "purchase_article_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "purchase_article_presentacion_positiva" CHECK ("presentation_amount" > 0),
  -- El factor de conversion es el DIVISOR de `costo_bruto_uso` (SPEC §12). Un
  -- cero ahi es una division por cero disfrazada; la formula la trata como
  -- guarda, pero una fila con cero es un dato mal capturado, no un caso.
  ADD CONSTRAINT "purchase_article_factor_positivo" CHECK ("conversion_factor" > 0);

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "unit_dimension" ("code") VALUES ('MASA'), ('VOLUMEN'), ('CONTEO');

-- La unidad BASE de cada dimension es la que tiene factor 1. Dos unidades solo
-- se convierten entre si sin factor explicito cuando comparten dimension; el
-- factor es entonces el cociente de sus `factor_to_base`.
INSERT INTO "unit" ("code", "name", "dimension", "factor_to_base") VALUES
  ('g',    'gramo',      'MASA',    1),
  ('kg',   'kilogramo',  'MASA',    1000),
  ('mg',   'miligramo',  'MASA',    0.001),
  ('lb',   'libra',      'MASA',    453.59237),
  ('oz',   'onza',       'MASA',    28.349523125),
  ('ml',   'mililitro',  'VOLUMEN', 1),
  ('lt',   'litro',      'VOLUMEN', 1000),
  ('gal',  'galon',      'VOLUMEN', 3785.411784),
  ('unid', 'unidad',     'CONTEO',  1),
  ('doc',  'docena',     'CONTEO',  12);

INSERT INTO "item_type" ("code") VALUES ('COMPRADO'), ('PRODUCIDO');

INSERT INTO "item_status" ("code") VALUES ('ACTIVE'), ('INACTIVE');

-- El tipo `SUP` del Excel: los ocho insumos con precio estimado y sin factura
-- de respaldo (SPEC §5). No era un tipo de item.
INSERT INTO "price_confidence" ("code") VALUES ('FACTURA'), ('ESTIMADO');

-- Capacidades que introduce P2 (SPEC §4: capacidades, no roles rigidos).
--
-- Tres y no una por tabla: el catalogo es UNA fuente de verdad, y quien puede
-- crear un item puede crear su articulo de compra. Separarlos produciria pares
-- de permisos que siempre se conceden juntos, y un catalogo de permisos que
-- nadie revisa porque es ruido.
INSERT INTO "permission" ("code", "domain") VALUES
  ('catalog.read',   'catalog'),
  ('catalog.create', 'catalog'),
  ('catalog.update', 'catalog');

-- OWNER y ADMIN gestionan el catalogo. El resto lo LEE: `GERENTE_LOCAL` y
-- `BODEGA` necesitan ver los items para contar inventario (P7), y un item no
-- revela ninguna receta — lo que CLAUDE.md 4.3 protege son las lineas de receta
-- y los derivados del consumo, que llegan en P4 y P6.
INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, p FROM unnest(ARRAY['OWNER', 'ADMIN']) AS r,
                   unnest(ARRAY['catalog.read', 'catalog.create', 'catalog.update']) AS p;

INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT r, 'catalog.read' FROM unnest(ARRAY['GERENTE_LOCAL', 'BODEGA', 'LECTURA']) AS r;

INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('catalog.item.created',    'catalog', true),
  ('catalog.item.updated',    'catalog', true),
  ('catalog.item.archived',   'catalog', true),
  ('catalog.article.created', 'catalog', true),
  ('catalog.article.updated', 'catalog', true),
  ('catalog.group.created',   'catalog', true)
ON CONFLICT ("code") DO NOTHING;

-- --- Indice de similitud para la deduplicacion de P10 ------------------------
--
-- ES UN INDICE DE EXPRESION, no una columna generada, y esa es la parte que
-- costo decidir. Una columna `name_normalized` mantenida por la aplicacion se
-- desincroniza el dia que alguien escriba por otra via; una columna GENERATED
-- de PostgreSQL no la sabe declarar Prisma y produciria deriva entre el esquema
-- y las migraciones. El indice sobre `lower("name")` no tiene ninguno de los
-- dos problemas: `lower` es IMMUTABLE, que es todo lo que PostgreSQL exige.
--
-- ES EL UNICO INDICE DEL PROYECTO SIN CONSULTA QUE LO USE HOY, y es una
-- excepcion consciente a CLAUDE.md §5. Su consumidor es la deduplicacion de
-- P10, y esta en los entregables aprobados de P2 porque crear el indice sobre
-- una tabla con decenas de miles de filas ya cargadas es mas caro que crearlo
-- vacia.
--
-- Sin plegado de acentos: "puree" y "puré" no se parecerian. Se decidio no
-- meter `unaccent` porque no es IMMUTABLE y envolverla para que lo parezca es
-- una trampa conocida que rompe los volcados. P10 puede aplicar `unaccent` en
-- la consulta: el indice trigrama es un prefiltro, no la respuesta.
CREATE INDEX "item_name_similitud" ON "item" USING gin (lower("name") gin_trgm_ops);

-- --- Privilegios -------------------------------------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql). Todo
-- UPDATE o DELETE se concede AQUI, tabla por tabla.

GRANT UPDATE ON TABLE "item_group"       TO costeo_app;
GRANT UPDATE ON TABLE "item"             TO costeo_app;
GRANT UPDATE ON TABLE "purchase_article" TO costeo_app;

-- NADA de DELETE: un item o un articulo se marcan INACTIVE. Borrarlos dejaria
-- huerfanas las lineas de receta y los movimientos de inventario que los
-- referencian, que es justamente lo que las claves foraneas RESTRICT impiden
-- (CLAUDE.md §5, sin borrado fisico en entidades auditables).

-- Los catalogos son datos de referencia: la aplicacion los lee, no los escribe.
-- `unit` es GLOBAL —un kilo pesa lo mismo en todas las companies— y por eso ni
-- siquiera admite INSERT: una company no puede declarar que su kilo tiene 900
-- gramos.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "unit"             FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "unit_dimension"   FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "item_type"        FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "item_status"      FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "price_confidence" FROM costeo_app;

-- --- RLS deny-by-default -----------------------------------------------------

ALTER TABLE "item_group" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_group" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "item_group_app" ON "item_group"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "item_group_migrator" ON "item_group"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "item" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "item_app" ON "item"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "item_migrator" ON "item"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "purchase_article" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_article" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "purchase_article_app" ON "purchase_article"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "purchase_article_migrator" ON "purchase_article"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- Catalogos: lectura para la aplicacion, todo para el migrator. Llevan RLS
-- aunque no tengan tenant, porque una regla con excepciones no se automatiza.
ALTER TABLE "unit" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "unit" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "unit_lectura" ON "unit" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "unit_migrator" ON "unit" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "unit_dimension" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "unit_dimension" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "unit_dimension_lectura" ON "unit_dimension" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "unit_dimension_migrator" ON "unit_dimension" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "item_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "item_type_lectura" ON "item_type" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "item_type_migrator" ON "item_type" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "item_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "item_status_lectura" ON "item_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "item_status_migrator" ON "item_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "price_confidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "price_confidence" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "price_confidence_lectura" ON "price_confidence" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "price_confidence_migrator" ON "price_confidence" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);
-- ===== MANUAL: END =====
