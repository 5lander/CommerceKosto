-- P15 — la sesion lleva las ubicaciones DE LA COMPANY.
--
-- QUE AGUJERO CIERRA, Y COMO SE ENCONTRO.
--
-- `exigirUbicacionEnAlcance` sale temprano cuando el rol es de company: un
-- OWNER o un ADMIN «pueden con todas», asi que no se comprobaba nada mas. El
-- resultado es que un `locationId` de OTRA company pasaba la comprobacion, y
-- `GET /costeo?locationId=<ajena>` respondia **200** — sin fuga, porque RLS
-- filtra y lo que devuelve son los productos del propio usuario, pero con
-- TODOS a cero y activo=false.
--
-- Eso incumple CLAUDE.md 4.4 —«todo acceso por ID valida pertenencia a la
-- company»— y, peor para este producto, ensena un numero plausible y falso:
-- quien se equivoca de identificador lee «todos mis platos cuestan cero».
--
-- Lo encontro el pentest interno de P15, no una revision de codigo.
--
-- POR QUE EN LA SESION Y NO EN CADA CASO DE USO. Porque asi **todos los
-- llamantes existentes heredan la comprobacion sin tocarlos**, y sin una
-- consulta mas por peticion: `session_lookup` ya se ejecuta en cada request y
-- solo se le anade un LATERAL sobre `location`, que esta indexado por company.
--
-- Y por que no un guard: el propio `PermisosGuard` explica por que no —«un
-- guard que intentara adivinar la ubicacion desde la URL acertaria hoy y
-- fallaria en silencio en cuanto una ruta cambiara»—. Esto no adivina nada:
-- pone el dato en la sesion y deja que decida quien sabe cual es la ubicacion
-- afectada.

-- ===== MANUAL: BEGIN =====

-- `CREATE OR REPLACE` NO SIRVE: cambia el tipo de retorno de la funcion, y
-- PostgreSQL lo rechaza con «cannot change return type of existing function».
-- Hay que soltarla y volver a crearla — y de paso eso obliga a repetir el
-- REVOKE y el GRANT de abajo, que es lo correcto: una funcion nueva nace sin
-- los privilegios de la anterior, y `SECURITY DEFINER` sin REVOKE a PUBLIC
-- seria una lectura sin tenant abierta a cualquiera.
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

-- ===== MANUAL: END =====
