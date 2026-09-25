-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL del up, y va PRIMERO: hay que quitar lo que
-- cuelga de las columnas antes de que el DDL de Prisma las suelte.
--
-- 1. `session_lookup` vuelve a la firma de P15, sin `csrf_token`. `CREATE OR
--    REPLACE` no sirve —cambia el tipo de retorno— y por eso se suelta y se
--    vuelve a crear, repitiendo REVOKE y GRANT.
-- 2. Las dos restricciones se sueltan explicitamente: `DROP COLUMN` se las
--    llevaria por delante, pero dejarlo implicito esconde que existieron.
DROP FUNCTION IF EXISTS session_lookup(text);

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
    alcance_company boolean,
    ubicaciones_de_company uuid[]
  )
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $FUNC$
  SELECT s."id", s."user_id", s."company_id",
         s."created_at", s."last_seen_at", s."expires_at", s."revoked_at",
         u."status", c."status",
         COALESCE(cap."permisos", ARRAY[]::text[]),
         COALESCE(alc."ubicaciones", ARRAY[]::uuid[]),
         COALESCE(alc."alcance_company", false),
         COALESCE(loc."de_la_company", ARRAY[]::uuid[])
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
  LEFT JOIN LATERAL (
    SELECT array_agg(l."id") AS "de_la_company"
    FROM "location" l
    WHERE l."company_id" = s."company_id"
  ) loc ON true
  WHERE s."token_hash" = p_token_hash;
$FUNC$;

COMMENT ON FUNCTION session_lookup(text) IS
  'Contexto de una sesion. SECURITY DEFINER: es la unica lectura sin tenant efectivo, '
  'y por eso vive en una funcion con `search_path` fijado y sin EXECUTE para PUBLIC. '
  'Desde P15 devuelve tambien las ubicaciones de la company, para que la pertenencia '
  'se pueda comprobar sin una consulta mas.';

REVOKE EXECUTE ON FUNCTION session_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION session_lookup(text) TO costeo_app;

ALTER TABLE "session"            DROP CONSTRAINT IF EXISTS "session_csrf_acotado";
ALTER TABLE "backoffice_session" DROP CONSTRAINT IF EXISTS "backoffice_session_csrf_acotado";
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- AlterTable
ALTER TABLE "public"."session" DROP COLUMN "csrf_token";

-- AlterTable
ALTER TABLE "public"."backoffice_session" DROP COLUMN "csrf_token";

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260910202336_p16a2_csrf';
