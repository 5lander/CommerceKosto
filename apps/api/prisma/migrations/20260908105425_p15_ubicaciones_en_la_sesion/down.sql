-- ===== MANUAL-REVERSE: BEGIN =====
-- Se vuelve a la firma de P1, sin `ubicaciones_de_company`.
--
-- `CREATE OR REPLACE` NO sirve aqui: cambia el tipo de retorno, y PostgreSQL lo
-- rechaza con «cannot change return type of existing function». Hay que
-- soltarla y volver a crearla.
DROP FUNCTION IF EXISTS session_lookup(text);

CREATE OR REPLACE FUNCTION session_lookup(p_token_hash text)
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
AS $FUNC$
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
$FUNC$;

COMMENT ON FUNCTION session_lookup(text) IS
  'Contexto de una sesion. SECURITY DEFINER: es la unica lectura sin tenant efectivo, '
  'y por eso vive en una funcion con `search_path` fijado y sin EXECUTE para PUBLIC.';

REVOKE EXECUTE ON FUNCTION session_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION session_lookup(text) TO costeo_app;
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260908105425_p15_ubicaciones_en_la_sesion';
