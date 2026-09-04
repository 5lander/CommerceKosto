-- CreateTable
CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_type" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "company_id" UUID,
    "ip" INET,
    "geo_country" CHAR(2),
    "geo_city" TEXT,
    "user_agent" TEXT,
    "device_id" UUID,
    "correlation_id" UUID NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event_type" (
    "code" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "requires_company" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "audit_event_type_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "audit_outcome" (
    "code" TEXT NOT NULL,

    CONSTRAINT "audit_outcome_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "audit_actor_type" (
    "code" TEXT NOT NULL,

    CONSTRAINT "audit_actor_type_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "audit_log_at_idx" ON "audit_log"("at" DESC);

-- CreateIndex
CREATE INDEX "audit_log_correlation_id_idx" ON "audit_log"("correlation_id");

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_event_type_fkey" FOREIGN KEY ("event_type") REFERENCES "audit_event_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_outcome_fkey" FOREIGN KEY ("outcome") REFERENCES "audit_outcome"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_type_fkey" FOREIGN KEY ("actor_type") REFERENCES "audit_actor_type"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===== MANUAL: BEGIN =====
--
-- Lo que Prisma no sabe declarar y este proyecto exige: restricciones de
-- integridad, privilegios, append-only y RLS deny-by-default.
--
-- El ORDEN importa. Las semillas de los catalogos van ANTES de activar
-- FORCE ROW LEVEL SECURITY: con FORCE activo, la politica alcanza tambien al
-- dueno de la tabla, y un INSERT sin politica que lo permita seria rechazado.

-- --- Restricciones de integridad --------------------------------------------

ALTER TABLE "audit_log"
  ADD CONSTRAINT "audit_log_detail_es_objeto"
    CHECK (jsonb_typeof("detail") = 'object'),

  -- Evita que un actor con INSERT forje un evento con fecha futura para
  -- desordenar la evidencia. El minuto de holgura absorbe la deriva de reloj.
  ADD CONSTRAINT "audit_log_at_no_es_futuro"
    CHECK ("at" <= now() + interval '1 minute'),

  ADD CONSTRAINT "audit_log_user_agent_acotado"
    CHECK ("user_agent" IS NULL OR length("user_agent") <= 512),

  -- Un evento de sistema no tiene actor; uno de usuario siempre lo tiene.
  ADD CONSTRAINT "audit_log_actor_coherente" CHECK (
        ("actor_type" IN ('SYSTEM', 'ANONYMOUS') AND "actor_id" IS NULL)
     OR ("actor_type" IN ('USER', 'BACKOFFICE')  AND "actor_id" IS NOT NULL));

-- --- Semillas de los catalogos de enums -------------------------------------
-- CLAUDE.md §5: enums en tabla de catalogo, no en tipo nativo. Un enum nativo
-- exige una migracion con bloqueo para anadir un valor, y este catalogo crece
-- en cada paquete.

INSERT INTO "audit_outcome" ("code") VALUES ('success'), ('failure'), ('blocked');

INSERT INTO "audit_actor_type" ("code") VALUES ('SYSTEM'), ('ANONYMOUS'), ('USER'), ('BACKOFFICE');

-- Solo los eventos de sistema, que son los unicos que P0 puede emitir. Cada
-- paquete anade los suyos en su propia migracion (SEGURIDAD.md §10, columna
-- "Desde"), y `requires_company` es false porque ninguno tiene tenant.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('system.migration.applied',  'system', false),
  ('system.config.changed',     'system', false),
  ('system.ratelimit.exceeded', 'system', false),
  ('system.audit_log.read',     'system', false);

-- --- Privilegios: append-only, capa 1 de 3 ----------------------------------
-- Los DEFAULT PRIVILEGES ya conceden SELECT + INSERT (docker/postgres/initdb/
-- sql/grants.sql). Aqui se retira todo lo que muta y se deja constancia.

REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE "audit_log" FROM costeo_app;

-- El historial de migraciones no es asunto de la aplicacion.
REVOKE ALL ON TABLE "_prisma_migrations" FROM costeo_app;

-- Los catalogos son datos de referencia: la aplicacion los lee, no los escribe.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "audit_event_type" FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "audit_outcome"    FROM costeo_app;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE "audit_actor_type" FROM costeo_app;

-- --- Append-only, capa 2 de 3: trigger --------------------------------------
--
-- FOR EACH STATEMENT, NO FOR EACH ROW. La diferencia no es cosmetica: con
-- FORCE ROW LEVEL SECURITY activo y sin politica de DELETE, un
-- `DELETE FROM audit_log` ejecutado por el DUENO afecta a CERO filas, un
-- trigger de fila nunca llega a dispararse, y el borrado "tiene exito" en
-- silencio. El trigger de sentencia se dispara siempre, haya filas o no.
--
-- Esta capa cubre lo que la de privilegios no puede: al dueno de la tabla.

CREATE FUNCTION rechazar_mutacion() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog
AS $$
BEGIN
  RAISE EXCEPTION
    'La tabla % es append-only: % rechazado. Un error se corrige con una fila nueva, nunca editando el historial.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER "audit_log_sin_mutacion"
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

CREATE TRIGGER "audit_log_sin_truncado"
  BEFORE TRUNCATE ON "audit_log"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion();

-- --- RLS deny-by-default ----------------------------------------------------
-- CLAUDE.md §4.1: la politica se define ANTES de insertar la primera fila.
-- Sin politica que lo permita, nadie ve ni escribe nada: ese es el sentido de
-- "deny by default".

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE  ROW LEVEL SECURITY;

-- En P0 la aplicacion solo puede escribir eventos de SISTEMA. P1 anade la
-- politica de tenant (`company_id = current_setting('app.company_id')::uuid`)
-- sin tocar esta: solo suma.
CREATE POLICY "audit_log_app_inserta_sistema" ON "audit_log"
  FOR INSERT TO costeo_app
  WITH CHECK ("company_id" IS NULL);

-- SEGURIDAD.md §10: "el acceso al log de auditoria es de solo lectura,
-- restringido al back office". La aplicacion cliente escribe y no lee.
CREATE POLICY "audit_log_app_no_lee" ON "audit_log"
  FOR SELECT TO costeo_app
  USING (false);

CREATE POLICY "audit_log_migrator_inserta" ON "audit_log"
  FOR INSERT TO costeo_migrator
  WITH CHECK ("company_id" IS NULL AND "event_type" = 'system.migration.applied');

-- Los catalogos tambien llevan RLS. No tienen tenant, pero dejarlos fuera
-- crearia una excepcion a "toda tabla tiene RLS", y una regla con excepciones
-- no se puede automatizar.
ALTER TABLE "audit_event_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_event_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "audit_event_type_lectura" ON "audit_event_type"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "audit_event_type_migrator" ON "audit_event_type"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "audit_outcome" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_outcome" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "audit_outcome_lectura" ON "audit_outcome"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "audit_outcome_migrator" ON "audit_outcome"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

ALTER TABLE "audit_actor_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_actor_type" FORCE  ROW LEVEL SECURITY;
CREATE POLICY "audit_actor_type_lectura" ON "audit_actor_type"
  FOR SELECT TO costeo_app USING (true);
CREATE POLICY "audit_actor_type_migrator" ON "audit_actor_type"
  FOR ALL TO costeo_migrator USING (true) WITH CHECK (true);

-- ===== MANUAL: END =====
