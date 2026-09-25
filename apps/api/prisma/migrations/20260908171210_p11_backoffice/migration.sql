-- P11 — Back office: el plan con sus limites, y las tres tablas del operador.
--
-- EL ORDEN DE ESTE ARCHIVO NO ES EL QUE GENERO PRISMA, y el cambio es
-- deliberado. `migrate diff` emitia el `DROP COLUMN "max_locations"` en la
-- primera linea, antes de que existiera un solo plan al que mover ese limite:
-- el dato se habria perdido y la perdida habria sido silenciosa, porque el
-- valor por defecto coincide. Aqui se crea el plan, se siembra, se traslada
-- cada company al plan que de verdad cubre su limite —fallando en alto si
-- ninguno lo cubre— y solo entonces se suelta la columna.
--
-- Lo mismo con la clave foranea de `company` -> `plan`: al final, cuando ya hay
-- filas a las que apuntar.

-- ===== MANUAL: BEGIN =====
--
-- ORDEN: rol -> tablas -> restricciones -> semillas -> traslado de datos ->
-- clave foranea -> privilegios -> RLS.
--
-- QUE TRAE. El plan como entidad con SUS TRES LIMITES (D5) y las tres tablas
-- del back office. Las tres son la excepcion del esquema: no llevan
-- `company_id`, porque un operador de back office NO PERTENECE A NINGUN TENANT.
-- Que no pertenezca es lo que le permite mirar a todos, y es exactamente por
-- eso que cada mirada queda registrada con su motivo.
--
-- EL ROL `costeo_backoffice` TIENE QUE EXISTIR YA. Lo crea
-- `docker/postgres/initdb/sql/roles.sql` en un cluster nuevo y
-- `npm run rol:backoffice` en uno que ya estaba en pie. Esta migracion NO lo
-- crea —`costeo_migrator` es NOCREATEROLE, y ampliarlo para esto seria dar
-- capacidad de crear roles al dueno de todas las tablas— y **falla en alto** si
-- no esta. Saltarse los GRANT en silencio dejaria el back office sin acceso y
-- se descubriria en produccion.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'costeo_backoffice') THEN
    RAISE EXCEPTION
      'Falta el rol costeo_backoffice. Crealo antes de migrar: npm run rol:backoffice (ADR-017).';
  END IF;
END $$;

-- ===== MANUAL: END =====

-- CreateTable
CREATE TABLE "plan" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "max_locations" INTEGER NOT NULL,
    "max_items" INTEGER NOT NULL,
    "max_products" INTEGER NOT NULL,

    CONSTRAINT "plan_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "backoffice_user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backoffice_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backoffice_session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" INET,
    "user_agent" TEXT,

    CONSTRAINT "backoffice_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backoffice_access_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "operator_id" UUID NOT NULL,
    "company_id" UUID,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ip" INET,

    CONSTRAINT "backoffice_access_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "backoffice_user_email_key" ON "backoffice_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "backoffice_session_token_hash_key" ON "backoffice_session"("token_hash");

-- CreateIndex
CREATE INDEX "backoffice_session_user_id_expires_at_idx" ON "backoffice_session"("user_id", "expires_at");

-- CreateIndex
CREATE INDEX "backoffice_access_log_at_idx" ON "backoffice_access_log"("at" DESC);

-- CreateIndex
CREATE INDEX "backoffice_access_log_company_id_at_idx" ON "backoffice_access_log"("company_id", "at" DESC);

-- AddForeignKey
ALTER TABLE "backoffice_session" ADD CONSTRAINT "backoffice_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "backoffice_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backoffice_access_log" ADD CONSTRAINT "backoffice_access_log_operator_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "backoffice_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backoffice_access_log" ADD CONSTRAINT "backoffice_access_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "plan"
  ADD CONSTRAINT "plan_codigo_conocido"
    CHECK ("code" IN ('BASICO', 'PROFESIONAL', 'CADENA')),

  -- Un limite de cero dejaria una company que no puede crear ni su primera
  -- ubicacion: un plan que no permite usar el producto.
  ADD CONSTRAINT "plan_limites_positivos"
    CHECK ("max_locations" >= 1 AND "max_items" >= 1 AND "max_products" >= 1);

ALTER TABLE "backoffice_user"
  ADD CONSTRAINT "backoffice_user_estado_conocido"
    CHECK ("status" IN ('ACTIVE', 'SUSPENDED')),

  -- No valida que el correo exista; valida que no sea cualquier cosa. Mismo
  -- criterio que `app_user` desde P1.
  ADD CONSTRAINT "backoffice_user_email_con_forma"
    CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' AND length("email") <= 254);

ALTER TABLE "backoffice_session"
  ADD CONSTRAINT "backoffice_session_caduca_despues_de_nacer"
    CHECK ("expires_at" > "created_at");

ALTER TABLE "backoffice_access_log"
  -- EL CORAZON DE LA TABLA. Un motivo opcional se deja vacio, y un registro sin
  -- motivo no responde la unica pregunta para la que existe un log de acceso
  -- privilegiado: por que miro esta persona los datos de ese cliente. Veinte
  -- caracteres no impiden escribir cualquier cosa, pero si impiden el «-», el
  -- «.» y el «soporte», que es lo que se escribe cuando el campo lo admite.
  ADD CONSTRAINT "backoffice_access_log_motivo_con_sustancia"
    CHECK (length(btrim("reason")) >= 20 AND length("reason") <= 1000),

  ADD CONSTRAINT "backoffice_access_log_accion_conocida"
    CHECK ("action" IN (
      'company.list', 'company.read', 'company.create', 'company.plan.changed',
      'company.status.changed', 'audit.read'
    )),

  -- Fechar evidencia en el futuro es como se desordena una investigacion. La
  -- misma guarda que `audit_log` lleva desde P0.
  ADD CONSTRAINT "backoffice_access_log_at_no_es_futuro"
    CHECK ("at" <= now() + INTERVAL '1 minute');

-- --- Semillas ---------------------------------------------------------------
--
-- TRES PLANES CON LIMITES GENEROSOS, que es lo que D5 pide. `BASICO` lleva
-- **exactamente diez** ubicaciones a proposito: es el `max_locations DEFAULT 10`
-- que tenia `company` hasta esta migracion, asi que ninguna company que
-- estuviera en el valor por defecto ve cambiar su limite porque ahora se llame
-- plan.

INSERT INTO "plan" ("code", "name", "max_locations", "max_items", "max_products") VALUES
  ('BASICO',      'Basico',      10,   500,   300),
  ('PROFESIONAL', 'Profesional', 25,  2000,  1000),
  ('CADENA',      'Cadena',     100, 10000,  5000);

-- --- Traslado del limite, ANTES de soltar la columna -------------------------

ALTER TABLE "company" ADD COLUMN "plan_code" TEXT NOT NULL DEFAULT 'BASICO';

-- Cada company al plan MAS PEQUENO que cubre el limite que ya tenia. No se
-- supone que todas estaban en el valor por defecto: se mira.
UPDATE "company" c
   SET "plan_code" = (
     SELECT p."code" FROM "plan" p
      WHERE p."max_locations" >= c."max_locations"
      ORDER BY p."max_locations" ASC
      LIMIT 1
   )
 WHERE EXISTS (SELECT 1 FROM "plan" p WHERE p."max_locations" >= c."max_locations");

-- Y si alguna se queda sin plan que la cubra, la migracion PARA. Bajar el
-- limite de un cliente en silencio es peor que no migrar: el cliente lo
-- descubre el dia que abre una sucursal.
DO $$
DECLARE sin_plan int;
BEGIN
  SELECT count(*) INTO sin_plan
    FROM "company" c
   WHERE NOT EXISTS (SELECT 1 FROM "plan" p WHERE p."max_locations" >= c."max_locations");

  IF sin_plan > 0 THEN
    RAISE EXCEPTION
      'Hay % company(s) con max_locations por encima de todo plan. Amplia CADENA o asigna a mano.',
      sin_plan;
  END IF;
END $$;

ALTER TABLE "company" DROP COLUMN "max_locations";

-- --- Clave foranea, ya con filas a las que apuntar ---------------------------

ALTER TABLE "company"
  ADD CONSTRAINT "company_plan_code_fkey"
    FOREIGN KEY ("plan_code") REFERENCES "plan"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- --- Privilegios ------------------------------------------------------------
--
-- LO PRIMERO ES QUITAR. `grants.sql` declara `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT ON TABLES TO costeo_app`, asi que estas tres tablas NACEN
-- legibles e insertables por la aplicacion cliente. Un back office cuyas tablas
-- nacen abiertas a la app no es un back office. El REVOKE va antes que nada.

REVOKE ALL ON TABLE "backoffice_user"       FROM costeo_app;
REVOKE ALL ON TABLE "backoffice_session"    FROM costeo_app;
REVOKE ALL ON TABLE "backoffice_access_log" FROM costeo_app;

-- `plan` SI es legible por la aplicacion: los limites se verifican donde se
-- crea una ubicacion, un item o un producto, y eso pasa en la app cliente. Lo
-- que no puede es tocarlos.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "plan" FROM costeo_app;

-- ANTES QUE NINGUN GRANT DE TABLA: sin USAGE sobre el esquema, todos los
-- privilegios de abajo son papel mojado y el error que sale —«permission denied
-- for schema public»— no menciona ni la tabla ni el privilegio que falta.
-- `grants.sql` se lo da a `costeo_app` desde P0; al rol del back office se lo da
-- esta migracion, que es la que lo estrena.
GRANT USAGE ON SCHEMA public TO costeo_backoffice;

-- El back office: SELECT sobre lo que necesita ver, escritura SOLO donde tiene
-- sentido que escriba, y DELETE en ningun sitio.
GRANT SELECT                 ON TABLE "plan"                  TO costeo_backoffice;
GRANT SELECT, INSERT, UPDATE ON TABLE "company"               TO costeo_backoffice;
GRANT SELECT                 ON TABLE "company_settings"      TO costeo_backoffice;
GRANT SELECT                 ON TABLE "company_status"        TO costeo_backoffice;
GRANT SELECT, INSERT         ON TABLE "location"              TO costeo_backoffice;
GRANT SELECT, INSERT         ON TABLE "app_user"              TO costeo_backoffice;
GRANT SELECT, INSERT         ON TABLE "user_role"             TO costeo_backoffice;
GRANT SELECT                 ON TABLE "location_type"         TO costeo_backoffice;
GRANT SELECT                 ON TABLE "location_status"       TO costeo_backoffice;
GRANT SELECT                 ON TABLE "user_status"           TO costeo_backoffice;
GRANT SELECT                 ON TABLE "role"                  TO costeo_backoffice;

-- SOLO PARA CONTAR, y el alcance es deliberadamente estrecho. La ficha de una
-- company enseña CUANTOS items y productos tiene, que es lo que hace falta para
-- decidir un plan. NO se conceden `recipe`, `recipe_line`, `reference_price` ni
-- `inventory_movement`: un operador que pudiera leer las recetas de un cliente
-- veria su secreto de negocio (CLAUDE.md §4.3), y contar no es leer. El dia que
-- soporte necesite mas, lo concede su paquete con su motivo escrito al lado.
GRANT SELECT                 ON TABLE "item"                  TO costeo_backoffice;
GRANT SELECT                 ON TABLE "product"               TO costeo_backoffice;
GRANT SELECT                 ON TABLE "backoffice_user"       TO costeo_backoffice;
GRANT SELECT, INSERT, UPDATE ON TABLE "backoffice_session"    TO costeo_backoffice;

-- APPEND-ONLY POR PRIVILEGIO, no por costumbre: sin UPDATE y sin DELETE, la
-- unica forma de que una linea de este log cambie es entrar como superusuario.
-- Es la misma decision que sostiene R3 en el libro de inventario.
GRANT SELECT, INSERT         ON TABLE "backoffice_access_log" TO costeo_backoffice;

-- EL PENDIENTE ESTRUCTURAL QUE P11 CIERRA. `audit_log` se escribe desde P0 y
-- NADIE PODIA LEERLO: `costeo_app` tiene politica `USING (false)` a proposito y
-- no existia otro rol. Un registro de auditoria que nadie puede leer cumple la
-- letra de SEGURIDAD.md §10 y no su proposito.
GRANT SELECT                 ON TABLE "audit_log"             TO costeo_backoffice;

-- --- RLS --------------------------------------------------------------------
--
-- SOBRE `costeo_backoffice` Y RLS, PARA QUE NO CONFUNDA A NADIE: ese rol es
-- BYPASSRLS, asi que ninguna politica se le aplica. Lo que le da acceso son los
-- GRANT de arriba, no las politicas de abajo.
--
-- Y las politicas de `costeo_app` no son decorativas: son la segunda cerradura.
-- Si manana alguien concediera por error un SELECT sobre `backoffice_user` a la
-- aplicacion cliente, `USING (false)` seguiria devolviendo cero filas. Un GRANT
-- se escribe de memoria; dos cerraduras no se abren de memoria.

ALTER TABLE "plan"                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "plan"                  FORCE  ROW LEVEL SECURITY;
ALTER TABLE "backoffice_user"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_user"       FORCE  ROW LEVEL SECURITY;
ALTER TABLE "backoffice_session"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_session"    FORCE  ROW LEVEL SECURITY;
ALTER TABLE "backoffice_access_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "backoffice_access_log" FORCE  ROW LEVEL SECURITY;

-- `plan` es catalogo: se lee entero y sin tenant, como `unit` o `role`.
CREATE POLICY "plan_app_lee" ON "plan"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "plan_migrator" ON "plan"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

CREATE POLICY "backoffice_user_app_no_ve" ON "backoffice_user"
  FOR ALL TO costeo_app USING (false) WITH CHECK (false);
CREATE POLICY "backoffice_user_migrator" ON "backoffice_user"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

CREATE POLICY "backoffice_session_app_no_ve" ON "backoffice_session"
  FOR ALL TO costeo_app USING (false) WITH CHECK (false);
CREATE POLICY "backoffice_session_migrator" ON "backoffice_session"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

CREATE POLICY "backoffice_access_log_app_no_ve" ON "backoffice_access_log"
  FOR ALL TO costeo_app USING (false) WITH CHECK (false);
CREATE POLICY "backoffice_access_log_migrator" ON "backoffice_access_log"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
