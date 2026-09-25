-- P16-A1 — Correo transaccional y limite de tasa (D-16.12, D-16.19, D-16.23,
-- D-16.26, D-16.28, D-16.31, D-16.34, D-16.46, D-16.47, D-16.50; ADR-025, ADR-026).
--
-- QUE TRAE. Tres tablas y las dos primeras funciones SECURITY DEFINER que
-- ESCRIBEN. Las tres tablas son distintas entre si, y conviene tenerlo claro
-- antes de leer los privilegios:
--
--   email_outbox          La cola de correo. La aplicacion ENCOLA —dentro de la
--                         misma transaccion que crea la invitacion o el token—
--                         y no hace nada mas: sin UPDATE ni DELETE. Quien
--                         entrega y marca es el despachador, un proceso aparte
--                         con su propio rol (`costeo_despachador`), que ve la
--                         cola entera por una politica permisiva. El back office
--                         la lee para la salud (`PENDIENTE` con mas de N minutos).
--                         `datos` —el enlace con el token en claro, mientras
--                         el correo esta en vuelo— solo lo lee el despachador:
--                         los otros dos tienen SELECT por columnas, sin ella.
--
--   password_reset_token  El token de restablecimiento, hasheado. LA APLICACION
--                         NO LO VE: sin politica para `costeo_app` y con sus
--                         privilegios revocados. Lo crea `password_reset_request`
--                         y lo gasta `password_reset_consume`, y nada mas.
--
--   rate_limit_hit        Los golpes al limite de tasa. SIN TENANT, como
--                         `login_attempt`, y por la misma razon: quien pide un
--                         restablecimiento no tiene sesion. La aplicacion
--                         inserta y cuenta; el despachador borra los viejos en
--                         cada pasada. Es la exencion de AMBITO registrada en
--                         SEGURIDAD.md; NO es una exencion de RLS (M6 sigue con
--                         la lista vacia).
--
-- EL ROL `costeo_despachador` TIENE QUE EXISTIR YA, igual que `costeo_backoffice`
-- en P11: lo crea `roles.sql` en un cluster nuevo y `npm run rol:despachador` en
-- uno que ya estaba en pie. Esta migracion NO lo crea y **falla en alto** si no
-- esta. Saltarse sus GRANT en silencio dejaria los correos en `PENDIENTE` para
-- siempre, sin un solo error en ningun log.
--
-- ORDEN: rol -> tablas (Prisma) -> restricciones -> privilegios -> RLS ->
-- funciones definer -> semillas.

-- ===== MANUAL: BEGIN =====

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'costeo_despachador') THEN
    RAISE EXCEPTION
      'Falta el rol costeo_despachador. Crealo antes de migrar: npm run rol:despachador (ADR-025).';
  END IF;
END $$;

-- ===== MANUAL: END =====

-- CreateTable
CREATE TABLE "email_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID,
    "user_id" UUID,
    "destinatario" TEXT NOT NULL,
    "plantilla" TEXT NOT NULL,
    "datos" JSONB NOT NULL,
    "estado" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "siguiente_intento_en" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_token" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_hit" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "kind" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_hit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_outbox_estado_siguiente_intento_en_created_at_idx" ON "email_outbox"("estado", "siguiente_intento_en", "created_at");

-- CreateIndex
CREATE INDEX "email_outbox_user_id_created_at_idx" ON "email_outbox"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_token_token_hash_key" ON "password_reset_token"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_token_user_id_created_at_idx" ON "password_reset_token"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "rate_limit_hit_kind_clave_at_idx" ON "rate_limit_hit"("kind", "clave", "at" DESC);

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_outbox" ADD CONSTRAINT "email_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_token" ADD CONSTRAINT "password_reset_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "email_outbox"
  -- No valida que el correo exista; valida que no sea cualquier cosa. Mismo
  -- criterio que `app_user` desde P1.
  ADD CONSTRAINT "email_outbox_destinatario_con_forma"
    CHECK ("destinatario" ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' AND length("destinatario") <= 254),

  -- Las tres plantillas: dos con enlace y el aviso de bloqueo del login, que
  -- hasta P16-A1 salia de la API por `MailerPort` y ahora se encola como los
  -- otros dos. La API no envia NADA directamente.
  ADD CONSTRAINT "email_outbox_plantilla_conocida"
    CHECK ("plantilla" IN ('INVITACION', 'RESTABLECIMIENTO', 'BLOQUEO')),

  ADD CONSTRAINT "email_outbox_estado_conocido"
    CHECK ("estado" IN ('PENDIENTE', 'ENVIADO', 'FALLIDO')),

  ADD CONSTRAINT "email_outbox_intentos_no_negativos"
    CHECK ("intentos" >= 0),

  -- ENVIADO si y solo si hay fecha de envio. Un `ENVIADO` sin fecha no dice
  -- cuando salio; una fecha sin `ENVIADO` es una fila que el despachador
  -- volveria a mandar.
  ADD CONSTRAINT "email_outbox_enviado_con_fecha"
    CHECK (("estado" = 'ENVIADO') = ("sent_at" IS NOT NULL));

ALTER TABLE "password_reset_token"
  ADD CONSTRAINT "password_reset_token_caduca_despues_de_nacer"
    CHECK ("expires_at" > "created_at");

-- La lista de D-16.50. El `kind` lo fija el codigo, nunca una peticion; el
-- CHECK es la segunda cerradura.
ALTER TABLE "rate_limit_hit"
  ADD CONSTRAINT "rate_limit_hit_kind_conocido"
    CHECK ("kind" IN (
      'password.olvido', 'password.restablecimiento', 'usuario.invitar', 'usuario.reenvio'
    ));

-- --- Privilegios ------------------------------------------------------------
--
-- LO PRIMERO ES QUITAR. `grants.sql` declara `ALTER DEFAULT PRIVILEGES ... GRANT
-- SELECT, INSERT ON TABLES TO costeo_app`, asi que las tres tablas NACEN
-- legibles e insertables por la aplicacion. Para `password_reset_token` eso es
-- justo lo que no puede ser: se revoca todo. Para las otras dos, SELECT e
-- INSERT es exactamente lo que la aplicacion necesita, y se deja escrito que
-- lo demas NO lo tiene.

REVOKE ALL ON TABLE "password_reset_token" FROM costeo_app;

-- La aplicacion encola y lee (la salud de una invitacion, P16-C); no marca ni
-- borra. Marcar es del despachador; borrar, de nadie.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "email_outbox" FROM costeo_app;

-- Y NADIE MAS QUE EL DESPACHADOR LEE `datos`. Mientras el correo esta en vuelo,
-- `datos` lleva el enlace con el token EN CLARO (D-16.34), y con ese token se
-- activa una cuenta o se restablece una contrasena: vale exactamente lo mismo
-- que la fila de `password_reset_token`, que a la aplicacion se le niega
-- entera. Negar el hash y dejar legible el token seria una cerradura con la
-- llave puesta. Ni la aplicacion (estado y error, P16-C) ni el back office
-- (contadores e instantes, `/correo/salud`) necesitan la columna. Se revoca el
-- SELECT de tabla y se concede POR COLUMNAS, todas menos `datos`; el INSERT no
-- la necesita porque `createMany` no emite RETURNING. Con esto, ni una app
-- comprometida que fije el tenant que quiera con `set_config`, ni el back
-- office con su BYPASSRLS, pueden leer un token en vuelo (ADR-025).
REVOKE SELECT ON TABLE "email_outbox" FROM costeo_app, costeo_backoffice;
GRANT SELECT ("id", "company_id", "user_id", "destinatario", "plantilla", "estado",
              "intentos", "error", "siguiente_intento_en", "created_at", "sent_at")
  ON TABLE "email_outbox" TO costeo_app, costeo_backoffice;

-- La aplicacion registra golpes y los cuenta. Purgar es del despachador.
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "rate_limit_hit" FROM costeo_app;

-- ANTES QUE NINGUN GRANT DE TABLA: sin USAGE sobre el esquema, los privilegios
-- de abajo son papel mojado y el error que sale —«permission denied for schema
-- public»— no menciona ni la tabla ni el privilegio que falta (P11 lo aprendio).
GRANT USAGE ON SCHEMA public TO costeo_despachador;

-- El despachador: leer la cola y marcarla. Nada de INSERT —no crea correos— ni
-- de DELETE: un correo fallido se queda como evidencia, no se borra.
GRANT SELECT, UPDATE ON TABLE "email_outbox" TO costeo_despachador;

-- Y purgar los golpes viejos. `DELETE ... WHERE "at" < ...` necesita leer la
-- columna del WHERE, asi que el SELECT se concede SOLO sobre `at`: el
-- despachador puede decidir que es viejo sin poder leer una sola clave.
GRANT SELECT ("at") ON TABLE "rate_limit_hit" TO costeo_despachador;
GRANT DELETE          ON TABLE "rate_limit_hit" TO costeo_despachador;

-- El back office mira la salud de la cola: contadores e instantes. Su SELECT
-- es el de columnas de arriba, sin `datos`: que ninguna de sus lecturas
-- devuelva el token no depende de que el codigo lo omita (D-16.34).

-- --- RLS --------------------------------------------------------------------
--
-- `costeo_despachador` NO es BYPASSRLS (a diferencia del back office): lo que
-- ve lo ve por las dos politicas permisivas de abajo, sobre exactamente dos
-- tablas. Sobre `password_reset_token` no tiene ni politica ni GRANT.
--
-- Las funciones definer corren como su duena, `costeo_migrator`, y FORCE hace
-- que RLS le aplique tambien a ella: por eso cada tabla lleva su politica
-- `_migrator`. Sin ella, `password_reset_request` no podria insertar nada.

ALTER TABLE "email_outbox"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_outbox"         FORCE  ROW LEVEL SECURITY;
ALTER TABLE "password_reset_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "password_reset_token" FORCE  ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_hit"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_limit_hit"       FORCE  ROW LEVEL SECURITY;

-- La aplicacion encola bajo su tenant. `FOR ALL` y no `FOR INSERT`: el INSERT
-- con RETURNING exige pasar tambien la politica de SELECT (INC-010), y la
-- lectura de la salud de una invitacion (P16-C) la necesita igual.
CREATE POLICY "email_outbox_app" ON "email_outbox"
  FOR ALL TO costeo_app
  USING ("company_id" = current_company())
  WITH CHECK ("company_id" = current_company());
CREATE POLICY "email_outbox_despachador" ON "email_outbox"
  FOR ALL TO costeo_despachador USING (true) WITH CHECK (true);
CREATE POLICY "email_outbox_migrator" ON "email_outbox"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- SOLO el migrator, que es quien ejecuta las definer. Para `costeo_app` no hay
-- politica: deny-by-default, y ademas sin privilegios (arriba).
CREATE POLICY "password_reset_token_migrator" ON "password_reset_token"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- Sin tenant, como `login_attempt`: la aplicacion cuenta golpes de gente que
-- todavia no es nadie. La tabla no lleva nada de negocio: un `kind`, una clave
-- que es una IP o un hash, y un instante.
CREATE POLICY "rate_limit_hit_app" ON "rate_limit_hit"
  FOR ALL TO costeo_app USING (true) WITH CHECK (true);
CREATE POLICY "rate_limit_hit_despachador" ON "rate_limit_hit"
  FOR ALL TO costeo_despachador USING (true) WITH CHECK (true);
CREATE POLICY "rate_limit_hit_migrator" ON "rate_limit_hit"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- --- Las dos funciones definer que ESCRIBEN ---------------------------------
--
-- P1 dejo tres funciones SECURITY DEFINER —`auth_lookup`, `session_lookup`,
-- `invitation_lookup`—, todas STABLE y de solo lectura, y escribio que «cualquier
-- cuarta merece la misma discusion». Esta es la discusion (ADR-025):
--
-- El restablecimiento de contrasena ocurre SIN SESION: quien lo pide no puede
-- entrar, y por eso lo pide. No hay tenant que fijar, asi que la aplicacion no
-- puede escribir por su camino normal. Las opciones eran (a) darle a `costeo_app`
-- una politica permisiva sobre `password_reset_token` y `email_outbox` sin
-- tenant —una tabla de tokens legible entera por la app, que es lo que un
-- volcado de RCE se llevaria—, o (b) dos funciones con la forma EXACTA del
-- hueco: entra un correo y sale nada; entra un hash y sale una fila o ninguna.
-- Se eligio (b). Son VOLATILE porque escriben, y son las UNICAS dos que lo
-- hacen: ninguna de las dos admite un filtro distinto del que lleva, asi que
-- con ellas no se puede enumerar ni reescribir nada mas.
--
-- `password_reset_request` NO DISTINGUE desde fuera si el correo existe POR LA
-- RESPUESTA: sin usuario activo, no hace nada y devuelve lo mismo. POR EL
-- TIEMPO queda un residuo estructural que no se disimula: con usuario hace dos
-- INSERT mas (un indice unico, dos claves foraneas y un jsonb: milisegundos);
-- sin usuario, solo el SELECT. Fingir el trabajo —escribir algo tambien en el
-- ramal vacio— mezclaria el limitador con esta funcion y no cerraria el canal
-- del todo. Se asume, se acota con el limite de tasa (10/h por IP y 3/h por
-- destinatario, D-16.50) que impide muestrearlo, y una prueba fija que la
-- diferencia se queda en la escala de un INSERT y nunca en la de un hash
-- (`correo-transaccional.spec.ts`; ADR-025). El `company_id` del outbox lo
-- pone la propia funcion —la aplicacion no lo sabe—, que es lo que permite que
-- el correo quede atribuido al tenant sin que nadie lo haya fijado.

CREATE FUNCTION password_reset_request(
  p_email      text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_datos      jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $FUNC$
DECLARE
  v_user_id    uuid;
  v_company_id uuid;
BEGIN
  SELECT u."id", u."company_id"
    INTO v_user_id, v_company_id
    FROM "app_user" u
   WHERE u."email" = lower(p_email)
     AND u."status" = 'ACTIVE';

  -- Sin usuario activo no pasa nada, y no se dice. Un invitado que aun no
  -- activo no tiene contrasena que restablecer: tiene una invitacion.
  IF v_user_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "password_reset_token" ("user_id", "token_hash", "expires_at")
  VALUES (v_user_id, p_token_hash, p_expires_at);

  INSERT INTO "email_outbox"
    ("company_id", "user_id", "destinatario", "plantilla", "datos", "estado")
  VALUES
    (v_company_id, v_user_id, lower(p_email), 'RESTABLECIMIENTO', p_datos, 'PENDIENTE');
END;
$FUNC$;

COMMENT ON FUNCTION password_reset_request(text, text, timestamptz, jsonb) IS
  'Crea el token de restablecimiento y encola su correo en UNA operacion, sin tenant. Sin usuario activo no hace nada y devuelve igual.';

REVOKE EXECUTE ON FUNCTION password_reset_request(text, text, timestamptz, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION password_reset_request(text, text, timestamptz, jsonb) TO costeo_app;

-- Gasta el token: un uso, y solo antes de caducar. Devuelve la fila —usuario y
-- company— o ninguna; con eso la aplicacion escribe la contrasena y revoca las
-- sesiones POR SU CAMINO NORMAL, con el tenant fijado. Que devuelva
-- `company_id` no es comodidad: sin el no habria tenant que fijar (D-16.47).
CREATE FUNCTION password_reset_consume(p_token_hash text, p_ahora timestamptz)
  RETURNS TABLE (
    user_id    uuid,
    company_id uuid
  )
  LANGUAGE sql
  VOLATILE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $FUNC$
  WITH consumido AS (
    UPDATE "password_reset_token" t
       SET "used_at" = p_ahora
     WHERE t."token_hash" = p_token_hash
       AND t."used_at" IS NULL
       AND t."expires_at" > p_ahora
    RETURNING t."user_id"
  )
  SELECT u."id", u."company_id"
    FROM consumido c
    JOIN "app_user" u ON u."id" = c."user_id"
   WHERE u."status" = 'ACTIVE';
$FUNC$;

COMMENT ON FUNCTION password_reset_consume(text, timestamptz) IS
  'Marca usado el token de restablecimiento si no estaba usado ni caducado y devuelve usuario y company; vacio si no.';

REVOKE EXECUTE ON FUNCTION password_reset_consume(text, timestamptz) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION password_reset_consume(text, timestamptz) TO costeo_app;

-- --- Semillas ---------------------------------------------------------------
--
-- Los eventos del paquete. `system.ratelimit.exceeded` lo sembro P0 y
-- `auth.password.reset_requested` podria existir en una base que ya lo tuviera:
-- por eso `ON CONFLICT DO NOTHING`. Ninguno se borra en el down (M10, INC-011).
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('auth.password.reset_requested', 'auth',   false),
  ('auth.password.reset_completed', 'auth',   true),
  ('user.invitation_resent',        'user',   true),
  ('system.ratelimit.exceeded',     'system', false)
ON CONFLICT ("code") DO NOTHING;

-- ===== MANUAL: END =====
