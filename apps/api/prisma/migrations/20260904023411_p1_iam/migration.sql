-- CreateTable
CREATE TABLE "company" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "max_locations" INTEGER NOT NULL DEFAULT 10,

    CONSTRAINT "company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "company_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "company_settings" (
    "company_id" UUID NOT NULL,
    "iva_venta" DECIMAL(24,12) NOT NULL,
    "iva_compra_recuperable" BOOLEAN NOT NULL,
    "provision_merma" DECIMAL(24,12) NOT NULL,
    "food_cost_objetivo" DECIMAL(24,12) NOT NULL,
    "food_cost_maximo" DECIMAL(24,12) NOT NULL,
    "food_cost_umbral_verde" DECIMAL(24,12) NOT NULL,
    "prime_cost_maximo" DECIMAL(24,12) NOT NULL,
    "regla_popularidad" DECIMAL(24,12) NOT NULL,
    "dias_operativos_mes" INTEGER NOT NULL,
    "dias_cobertura" INTEGER NOT NULL,

    CONSTRAINT "company_settings_pkey" PRIMARY KEY ("company_id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_type" (
    "code" TEXT NOT NULL,
    "vende" BOOLEAN NOT NULL,
    "almacena" BOOLEAN NOT NULL,

    CONSTRAINT "location_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "location_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "location_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invitation_token_hash" TEXT,
    "invitation_expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_status" (
    "code" TEXT NOT NULL,

    CONSTRAINT "user_status_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role" (
    "code" TEXT NOT NULL,
    "requires_location" BOOLEAN NOT NULL,

    CONSTRAINT "role_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "permission" (
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,

    CONSTRAINT "permission_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "role_code" TEXT NOT NULL,
    "permission_code" TEXT NOT NULL,

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("role_code","permission_code")
);

-- CreateTable
CREATE TABLE "user_role" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_code" TEXT NOT NULL,
    "location_id" UUID,
    "has_location" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "ip" INET,
    "user_agent" TEXT,
    "device_id" UUID,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "email" TEXT NOT NULL,
    "ip" INET,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "login_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "location_company_id_status_idx" ON "location"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_company_id_name_key" ON "location"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_invitation_token_hash_key" ON "app_user"("invitation_token_hash");

-- CreateIndex
CREATE INDEX "app_user_company_id_status_idx" ON "app_user"("company_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "role_code_requires_location_key" ON "role"("code", "requires_location");

-- CreateIndex
CREATE INDEX "user_role_company_id_user_id_idx" ON "user_role"("company_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_role_user_id_role_code_location_id_key" ON "user_role"("user_id", "role_code", "location_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_token_hash_key" ON "session"("token_hash");

-- CreateIndex
CREATE INDEX "session_company_id_user_id_expires_at_idx" ON "session"("company_id", "user_id", "expires_at");

-- CreateIndex
CREATE INDEX "login_attempt_email_at_idx" ON "login_attempt"("email", "at" DESC);

-- CreateIndex
CREATE INDEX "login_attempt_ip_at_idx" ON "login_attempt"("ip", "at" DESC);

-- AddForeignKey
ALTER TABLE "company" ADD CONSTRAINT "company_status_fkey" FOREIGN KEY ("status") REFERENCES "company_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_type_fkey" FOREIGN KEY ("type") REFERENCES "location_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location" ADD CONSTRAINT "location_status_fkey" FOREIGN KEY ("status") REFERENCES "location_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_status_fkey" FOREIGN KEY ("status") REFERENCES "user_status"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_code_fkey" FOREIGN KEY ("role_code") REFERENCES "role"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_permission_code_fkey" FOREIGN KEY ("permission_code") REFERENCES "permission"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_role_code_has_location_fkey" FOREIGN KEY ("role_code", "has_location") REFERENCES "role"("code", "requires_location") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_role" ADD CONSTRAINT "user_role_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_attempt" ADD CONSTRAINT "login_attempt_outcome_fkey" FOREIGN KEY ("outcome") REFERENCES "audit_outcome"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- Lo que Prisma no sabe declarar y este paquete exige: la funcion que expone el
-- tenant efectivo, las restricciones de integridad, las semillas de catalogos,
-- los privilegios y las politicas RLS de las catorce tablas nuevas.
--
-- ORDEN: funciones -> restricciones -> semillas -> privilegios -> RLS.

-- --- El tenant efectivo -----------------------------------------------------
--
-- ES LA PIEZA SOBRE LA QUE SE APOYAN TODAS LAS POLITICAS, y su comportamiento
-- cuando NO hay tenant fijado es lo que decide si una fuga es posible.
--
-- `current_setting('app.company_id', true)` devuelve NULL si nadie lo fijo (el
-- `true` es "no falles si no existe"). De ahi que `company_id = current_company()`
-- sea `NULL`, que NO es `true`, y la fila no pase el filtro. Resultado:
--
--   un caso de uso que olvida la capa de tenant devuelve CERO FILAS,
--   nunca las filas de otro tenant.
--
-- Ese es el criterio de aceptacion de P1, y lo garantiza PostgreSQL, no el ORM.
--
-- `nullif(..., '')` cubre el caso de que alguien fije la cadena vacia: sin el,
-- el `::uuid` lanzaria un error de sintaxis en mitad de una consulta cualquiera
-- y el diagnostico apuntaria al sitio equivocado.
CREATE FUNCTION current_company() RETURNS uuid
  LANGUAGE sql
  STABLE
  SET search_path = pg_catalog
AS $$
  SELECT nullif(current_setting('app.company_id', true), '')::uuid;
$$;

COMMENT ON FUNCTION current_company() IS
  'Tenant efectivo de la transaccion en curso. NULL si no se fijo: las politicas RLS devuelven cero filas.';

-- --- Busqueda de credenciales, ANTES de saber el tenant ---------------------
--
-- El login es el unico momento del sistema en que hay que leer una fila sin
-- saber a que company pertenece: el tenant se DEDUCE de quien entra. Una
-- politica RLS por tenant no puede cubrir eso, y relajarla para que pueda
-- seria abrir `app_user` entero.
--
-- Se resuelve con una unica funcion SECURITY DEFINER, que es lo mas parecido a
-- un agujero con forma exacta: devuelve solo las cinco columnas que el login
-- necesita, de un solo correo, y no admite ningun otro filtro.
--
-- `SET search_path = pg_catalog, public` es obligatorio en toda funcion
-- SECURITY DEFINER: sin el, quien pueda crear objetos en un esquema del
-- search_path puede secuestrar los nombres que la funcion resuelve y ejecutar
-- codigo con los privilegios del dueno. `costeo_app` no puede crear nada en
-- `public`, pero la defensa no depende de eso.
CREATE FUNCTION auth_lookup(p_email text)
  RETURNS TABLE (
    user_id        uuid,
    company_id     uuid,
    password_hash  text,
    user_status    text,
    company_status text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT u."id", u."company_id", u."password_hash", u."status", c."status"
  FROM "app_user" u
  JOIN "company" c ON c."id" = u."company_id"
  WHERE u."email" = lower(p_email);
$$;

COMMENT ON FUNCTION auth_lookup(text) IS
  'Unica lectura de app_user sin tenant efectivo. Solo para el login (SEGURIDAD.md 2.2).';

REVOKE EXECUTE ON FUNCTION auth_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION auth_lookup(text) TO costeo_app;

-- --- Resolucion de la sesion, ANTES de saber el tenant -----------------------
--
-- MISMO PROBLEMA QUE `auth_lookup`, Y POR ESO MISMA FORMA. La Barrera 3 dice
-- que el tenant sale de la sesion; para leer la sesion hace falta el tenant.
-- Es circular, y la unica salida limpia es una funcion SECURITY DEFINER con la
-- forma exacta del hueco: se entra POR EL HASH DEL TOKEN —que solo tiene quien
-- posee el token— y se sale con esa sesion y nada mas. No admite ningun otro
-- filtro, asi que no se puede enumerar con ella.
--
-- DEVUELVE EL CONTEXTO ENTERO EN UNA SOLA LLAMADA: vigencia, estados,
-- capacidades efectivas y alcance de ubicaciones. Esto corre en CADA peticion
-- autenticada, y resolverlo en tres consultas seria triplicar el coste fijo de
-- toda la API (OPTIMIZACION.md §3).
--
-- `alcance_company` es `true` si el usuario tiene algun rol de nivel company
-- (OWNER, ADMIN, LECTURA). En ese caso ve todas las ubicaciones de su company;
-- si no, solo las de `ubicaciones`. La distincion se decide aqui, con los datos
-- delante, y no en la aplicacion a base de interpretar una lista vacia.
CREATE FUNCTION session_lookup(p_token_hash text)
  RETURNS TABLE (
    session_id      uuid,
    user_id         uuid,
    company_id      uuid,
    created_at      timestamptz,
    last_seen_at    timestamptz,
    expires_at      timestamptz,
    revoked_at      timestamptz,
    user_status     text,
    company_status  text,
    permisos        text[],
    ubicaciones     uuid[],
    alcance_company boolean
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT s."id", s."user_id", s."company_id",
         s."created_at", s."last_seen_at", s."expires_at", s."revoked_at",
         u."status", c."status",
         COALESCE(cap."permisos", ARRAY[]::text[]),
         COALESCE(alc."ubicaciones", ARRAY[]::uuid[]),
         COALESCE(alc."alcance_company", false)
  FROM "session" s
  JOIN "app_user" u ON u."id" = s."user_id"
  JOIN "company"  c ON c."id" = s."company_id"
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT rp."permission_code") AS "permisos"
    FROM "user_role" ur
    JOIN "role_permission" rp ON rp."role_code" = ur."role_code"
    WHERE ur."user_id" = s."user_id" AND ur."company_id" = s."company_id"
  ) cap ON true
  LEFT JOIN LATERAL (
    SELECT array_agg(DISTINCT ur."location_id")
             FILTER (WHERE ur."location_id" IS NOT NULL) AS "ubicaciones",
           bool_or(NOT ur."has_location")                AS "alcance_company"
    FROM "user_role" ur
    WHERE ur."user_id" = s."user_id" AND ur."company_id" = s."company_id"
  ) alc ON true
  WHERE s."token_hash" = p_token_hash;
$$;

COMMENT ON FUNCTION session_lookup(text) IS
  'Unica lectura de session sin tenant efectivo. Se entra por el hash del token y solo devuelve esa sesion (Barrera 3).';

REVOKE EXECUTE ON FUNCTION session_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION session_lookup(text) TO costeo_app;

-- --- Resolucion de una invitacion, ANTES de saber el tenant ------------------
--
-- LA TERCERA Y ULTIMA FUNCION DE ESTA FORMA. Aceptar una invitacion ocurre sin
-- sesion —quien llega por el enlace todavia no es nadie— y por tanto sin
-- tenant. Mismo patron que `auth_lookup` y `session_lookup`: se entra por el
-- hash del token, sale una fila, no admite ningun otro filtro.
--
-- Que sean exactamente TRES, y que se cuenten, importa: son la lista completa
-- de sitios donde el sistema lee sin tenant efectivo. Cualquier cuarta funcion
-- `SECURITY DEFINER` que aparezca merece la misma discusion que estas tres.
CREATE FUNCTION invitation_lookup(p_token_hash text)
  RETURNS TABLE (
    user_id    uuid,
    company_id uuid,
    email      text,
    expires_at timestamptz,
    status     text
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
  SELECT u."id", u."company_id", u."email", u."invitation_expires_at", u."status"
  FROM "app_user" u
  WHERE u."invitation_token_hash" = p_token_hash;
$$;

COMMENT ON FUNCTION invitation_lookup(text) IS
  'Unica lectura de app_user por token de invitacion. Se usa al aceptar, que ocurre sin sesion.';

REVOKE EXECUTE ON FUNCTION invitation_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION invitation_lookup(text) TO costeo_app;

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "company"
  ADD CONSTRAINT "company_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "company_max_locations_positivo" CHECK ("max_locations" >= 1);

ALTER TABLE "location"
  ADD CONSTRAINT "location_name_no_vacio" CHECK (length(btrim("name")) BETWEEN 1 AND 200);

-- El correo se guarda SIEMPRE en minusculas. Sin esto, "Ana@x.com" y "ana@x.com"
-- serian dos cuentas distintas y el unico indice de unicidad no lo impediria:
-- la enumeracion de usuarios y el bloqueo por fuerza bruta se esquivarian
-- cambiando una mayuscula.
ALTER TABLE "app_user"
  ADD CONSTRAINT "app_user_email_en_minusculas" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "app_user_email_con_forma" CHECK ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  -- Un usuario INVITED todavia no tiene contrasena; uno ACTIVE siempre la tiene.
  ADD CONSTRAINT "app_user_credencial_coherente" CHECK (
        ("status" = 'INVITED' AND "password_hash" IS NULL)
     OR ("status" <> 'INVITED' AND "password_hash" IS NOT NULL)),
  -- Las dos columnas de la invitacion van juntas o no van. Un token sin fecha
  -- de caducidad es un enlace de activacion que no caduca nunca.
  ADD CONSTRAINT "app_user_invitacion_coherente"
    CHECK (("invitation_token_hash" IS NULL) = ("invitation_expires_at" IS NULL));

-- `has_location` no es un campo mas: es lo que ata la asignacion al catalogo de
-- roles. La clave foranea COMPUESTA contra `role(code, requires_location)` la
-- declara ya el esquema de Prisma; lo que falta aqui es el CHECK que impide que
-- la columna MIENTA respecto de `location_id`. Sin el, bastaria con poner
-- `has_location = false` y una ubicacion para colar un ADMIN con ubicacion.
ALTER TABLE "user_role"
  ADD CONSTRAINT "user_role_has_location_coherente"
    CHECK ("has_location" = ("location_id" IS NOT NULL));

-- SPEC 4: el OWNER es UNICO por company. Se hace con un indice unico parcial y
-- no con un trigger a proposito: dos altas simultaneas de OWNER se serializan
-- en el indice, mientras que un trigger que consulta y decide tiene una ventana
-- de carrera entre la consulta y la insercion.
CREATE UNIQUE INDEX "user_role_owner_unico_por_company"
  ON "user_role" ("company_id") WHERE "role_code" = 'OWNER';

-- El `@@unique(user_id, role_code, location_id)` de Prisma NO impide asignar
-- dos veces un rol de nivel company, y esto no es un detalle: en PostgreSQL dos
-- NULL son DISTINTOS para un indice unico, asi que `(u, 'ADMIN', NULL)` cabe
-- tantas veces como se pida. El resultado serian filas duplicadas que nadie ve
-- hasta que un `count(*)` de permisos devuelve el doble.
--
-- Este indice parcial cubre exactamente el hueco: unicidad de (usuario, rol)
-- cuando NO hay ubicacion. El indice de Prisma sigue cubriendo el caso con
-- ubicacion, donde no hay NULL que valga.
CREATE UNIQUE INDEX "user_role_unico_sin_ubicacion"
  ON "user_role" ("user_id", "role_code") WHERE "location_id" IS NULL;

ALTER TABLE "session"
  ADD CONSTRAINT "session_vigencia_coherente" CHECK ("expires_at" > "created_at"),
  ADD CONSTRAINT "session_user_agent_acotado"
    CHECK ("user_agent" IS NULL OR length("user_agent") <= 512);

ALTER TABLE "login_attempt"
  ADD CONSTRAINT "login_attempt_email_en_minusculas" CHECK ("email" = lower("email"));

-- --- Semillas de los catalogos ----------------------------------------------

INSERT INTO "company_status" ("code") VALUES ('ACTIVE'), ('SUSPENDED'), ('CLOSED');

-- El tipo no es decorativo (SPEC 2): una bodega modelada como local aparece con
-- ventas en cero y contamina todo reporte comparativo.
INSERT INTO "location_type" ("code", "vende", "almacena") VALUES
  ('BODEGA', false, true),
  ('LOCAL',  true,  true),
  ('AMBOS',  true,  true);

INSERT INTO "location_status" ("code") VALUES ('ACTIVE'), ('INACTIVE');

INSERT INTO "user_status" ("code") VALUES ('INVITED'), ('ACTIVE'), ('SUSPENDED');

-- `requires_location` decide, por clave foranea, si el rol se asigna a una
-- ubicacion o a la company entera.
INSERT INTO "role" ("code", "requires_location") VALUES
  ('OWNER',         false),
  ('ADMIN',         false),
  ('GERENTE_LOCAL', true),
  ('BODEGA',        true),
  ('LECTURA',       false);

-- Capacidades, no roles rigidos (SPEC 4). Cada paquete siembra las suyas: estas
-- son exactamente las que P1 hace cumplir, ni una mas.
INSERT INTO "permission" ("code", "domain") VALUES
  ('company.read',        'company'),
  ('company.update',      'company'),
  ('company.delete',      'company'),
  ('subscription.manage', 'company'),
  ('location.read',       'location'),
  ('location.create',     'location'),
  ('location.update',     'location'),
  ('user.read',           'user'),
  ('user.invite',         'user'),
  ('user.update',         'user'),
  ('user.remove',         'user'),
  ('session.revoke_any',  'user');

-- OWNER: todo. Es el unico que puede eliminar la company y tocar la suscripcion.
INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT 'OWNER', "code" FROM "permission";

-- ADMIN: todo lo operativo. NO elimina la company ni gestiona la suscripcion.
-- Que no pueda eliminar al OWNER no es una capacidad que se le quite, sino una
-- regla sobre el objetivo: se comprueba en el caso de uso y tiene su prueba.
INSERT INTO "role_permission" ("role_code", "permission_code")
  SELECT 'ADMIN', "code" FROM "permission"
  WHERE "code" NOT IN ('company.delete', 'subscription.manage');

INSERT INTO "role_permission" ("role_code", "permission_code") VALUES
  ('GERENTE_LOCAL', 'company.read'),
  ('GERENTE_LOCAL', 'location.read'),
  ('GERENTE_LOCAL', 'user.read'),
  ('BODEGA',        'company.read'),
  ('BODEGA',        'location.read'),
  ('LECTURA',       'company.read'),
  ('LECTURA',       'location.read'),
  ('LECTURA',       'user.read');

-- Eventos de auditoria que P1 introduce (SEGURIDAD.md 10). `requires_company`
-- es false en los de autenticacion: un login fallido puede no tener tenant
-- porque el correo no existe, y registrarlo igual es justamente el punto.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('auth.login.succeeded',   'auth',     false),
  ('auth.login.failed',      'auth',     false),
  ('auth.login.blocked',     'auth',     false),
  ('auth.logout',            'auth',     true),
  ('auth.session.revoked',   'auth',     true),
  ('auth.password.changed',  'auth',     true),
  ('company.created',        'company',  true),
  ('company.updated',        'company',  true),
  ('location.created',       'location', true),
  ('location.updated',       'location', true),
  ('user.invited',           'user',     true),
  ('user.activated',         'user',     true),
  ('user.role_granted',      'user',     true),
  ('user.role_revoked',      'user',     true),
  ('user.suspended',         'user',     true)
-- `ON CONFLICT DO NOTHING` es el otro lado del `NOT EXISTS` del down: si una
-- vuelta atras conservo tipos que sostenian evidencia, la siguiente ida se los
-- encuentra puestos. Sin esto, `up -> down -> up` moriria por clave duplicada
-- en una base con datos, y la reversibilidad solo seria cierta en vacio.
ON CONFLICT ("code") DO NOTHING;

-- --- Privilegios -------------------------------------------------------------
--
-- Los DEFAULT PRIVILEGES conceden SELECT + INSERT y nada mas (grants.sql). Todo
-- UPDATE o DELETE se concede AQUI, tabla por tabla, y solo donde la aplicacion
-- de verdad lo necesita. Lo que no aparece, no se puede.

GRANT UPDATE ON TABLE "company"          TO costeo_app;
GRANT UPDATE ON TABLE "company_settings" TO costeo_app;
GRANT UPDATE ON TABLE "location"         TO costeo_app;
GRANT UPDATE ON TABLE "app_user"         TO costeo_app;
GRANT UPDATE ON TABLE "session"          TO costeo_app;

-- Revocar un rol es borrar la asignacion; una sesion caducada se purga.
GRANT DELETE ON TABLE "user_role"     TO costeo_app;
GRANT DELETE ON TABLE "session"       TO costeo_app;
GRANT DELETE ON TABLE "login_attempt" TO costeo_app;

-- La aplicacion NO borra companies, ubicaciones ni usuarios: CLAUDE.md 5 exige
-- sin borrado fisico en entidades auditables. Se marcan CLOSED / INACTIVE /
-- SUSPENDED, que es lo que los catalogos de estado existen para permitir.

-- Los catalogos son datos de referencia: la aplicacion los lee, no los escribe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "company_status"  FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "location_type"   FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "location_status" FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "user_status"     FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "role"            FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "permission"      FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "role_permission" FROM costeo_app;

-- Crear una company es alta de tenant, y eso es del back office (P11). La
-- aplicacion cliente no puede: sin INSERT, ninguna ruta puede fabricarse un
-- tenant aunque el codigo se equivoque.
REVOKE INSERT ON TABLE "company" FROM costeo_app;

-- --- RLS deny-by-default -----------------------------------------------------
--
-- Toda tabla nueva: ENABLE + FORCE + politica. `audit:migrations` M6 lo exige y
-- su lista de exentas esta vacia.
--
-- El patron de las tablas con tenant es siempre el mismo:
--   costeo_app       -> solo su company, en lectura Y en escritura
--   costeo_migrator  -> todo, porque es quien migra y quien siembra
--
-- El `WITH CHECK` no es redundante con el `USING`: sin el, la aplicacion podria
-- INSERTAR filas con el company_id de otro tenant (no las veria despues, pero
-- las habria escrito). `USING` filtra lo que se lee; `WITH CHECK` valida lo que
-- se escribe. Hacen falta los dos.

-- company: su llave de aislamiento es su propio id.
ALTER TABLE "company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "company_app" ON "company"
  FOR ALL TO costeo_app
  USING ("id" = current_company())
  WITH CHECK ("id" = current_company());
CREATE POLICY "company_migrator" ON "company"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "company_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_settings" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "company_settings_app" ON "company_settings"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "company_settings_migrator" ON "company_settings"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "location" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "location" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "location_app" ON "location"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "location_migrator" ON "location"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "app_user_app" ON "app_user"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "app_user_migrator" ON "app_user"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "user_role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_role" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "user_role_app" ON "user_role"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "user_role_migrator" ON "user_role"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "session" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "session_app" ON "session"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "session_migrator" ON "session"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- login_attempt: SIN tenant, y es deliberado.
--
-- El login ocurre antes de saber a que company pertenece quien lo intenta. Una
-- politica por tenant dejaria la tabla ilegible justo en el momento en que hace
-- falta contar intentos. Se acota por lo que contiene —correo e IP, nada mas— y
-- porque ningun endpoint la expone.
ALTER TABLE "login_attempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "login_attempt" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "login_attempt_app" ON "login_attempt"
  FOR ALL TO costeo_app USING (true) WITH CHECK (true);
CREATE POLICY "login_attempt_migrator" ON "login_attempt"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- Catalogos: lectura para la aplicacion, todo para el migrator. Llevan RLS
-- aunque no tengan tenant, porque una regla con excepciones no se automatiza.
ALTER TABLE "company_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "company_status_lectura" ON "company_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "company_status_migrator" ON "company_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "location_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "location_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "location_type_lectura" ON "location_type" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "location_type_migrator" ON "location_type" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "location_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "location_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "location_status_lectura" ON "location_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "location_status_migrator" ON "location_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "user_status" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_status" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "user_status_lectura" ON "user_status" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "user_status_migrator" ON "user_status" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "role_lectura" ON "role" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "role_migrator" ON "role" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "permission" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "permission_lectura" ON "permission" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "permission_migrator" ON "permission" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "role_permission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role_permission" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "role_permission_lectura" ON "role_permission" FOR SELECT TO costeo_app USING (true);
CREATE POLICY "role_permission_migrator" ON "role_permission" FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- --- audit_log gana su politica de tenant ------------------------------------
--
-- P0 dejo escrito que P1 "solo suma": la politica de eventos de sistema sigue
-- intacta y esta se anade al lado. Con dos politicas permisivas, PostgreSQL
-- acepta la fila si CUALQUIERA de las dos la admite, que es justo lo que hace
-- falta: eventos sin tenant (system.*) y eventos con tenant (auth.*, user.*).
CREATE POLICY "audit_log_app_inserta_tenant" ON "audit_log"
  FOR INSERT TO costeo_app
  WITH CHECK ("company_id" = current_company());

-- ===== MANUAL: END =====
