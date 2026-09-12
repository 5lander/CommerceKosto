-- P16-A2 — el token anti-CSRF vive en la fila de la sesion (U4, SEGURIDAD.md 4.2, ADR-021).
--
-- QUE SE ANADE, Y POR QUE AHORA.
--
-- Hasta aqui la unica defensa contra CSRF era `SameSite=Strict` en la cookie.
-- El usuario decidio (U4) el token completo, que es lo que SEGURIDAD.md 4.2
-- pedia desde el principio: `SameSite` lo aplica el NAVEGADOR, asi que es una
-- defensa que la API no controla — un navegador viejo, un subdominio propio
-- comprometido o un fallo de implementacion la anulan sin avisar a nadie. El
-- token lo comprueba el servidor en cada mutacion, y no depende de nadie mas.
--
-- PATRON SYNCHRONIZER, NO DOUBLE-SUBMIT. El token se guarda EN LA FILA DE LA
-- SESION y viaja al cliente en el CUERPO del login (y de `GET /auth/sesion`),
-- nunca en una cookie. Una segunda cookie legible seria el mismo canal que se
-- esta protegiendo —el navegador la mandaria sola en la peticion cruzada— y
-- ademas el navegante no gana nada: el JavaScript de la pagina puede leer el
-- cuerpo de una respuesta suya igual de bien.
--
-- EL TOKEN SE GUARDA EN CLARO, Y ES DELIBERADO.
--
--   1. NO ES UNA CREDENCIAL DE ACCESO. Quien tenga esta columna no puede
--      entrar: la credencial es la cookie de sesion, de la que la base solo
--      guarda el SHA-256. Con el token CSRF y sin cookie no se hace nada.
--   2. Un atacante que ya tenga la cookie de la victima no necesita el token:
--      esta actuando como ella, no CONTRA ella. El CSRF protege del sitio
--      cruzado que NO puede leer la respuesta, no del robo de sesion.
--   3. Guardarlo hasheado impediria devolverlo en `GET /auth/sesion`, que es
--      justo lo que permite recuperarlo tras recargar la pagina sin rotarlo
--      —rotar en cada lectura rompe las pestanas abiertas—.
--
--   Lo que se pierde: un volcado de `session` revela tokens CSRF vivos. Lo que
--   habilita ese volcado es exactamente nada, por (1) y (2).
--
-- LAS SESIONES YA ABIERTAS NACEN CON `csrf_token` NULO, Y NO SE RELLENAN.
-- Rellenarlas con un valor generado en SQL dejaria sesiones vivas cuyo token
-- nadie ha entregado al cliente: navegarian con normalidad y fallarian al
-- guardar. Se elige lo contrario y mas simple: `ValidarSesion` trata una
-- sesion SIN token como INVALIDA (401), de modo que el usuario vuelve a entrar
-- de inmediato y obtiene una sesion completa. El coste es que el despliegue de
-- este paquete cierra las sesiones abiertas; el beneficio es que `csrfToken`
-- es `string` y no `string | null` en todo el codigo que hay por encima.
--
-- Ninguna tabla es nueva (M6 no aplica) y ningun privilegio hace falta:
-- `costeo_app` ya tiene INSERT/UPDATE sobre `session` desde P1, y el back
-- office llega a `backoffice_session` por su rol propio. Una columna nueva no
-- necesita GRANT: los privilegios de tabla la cubren.

-- AlterTable
ALTER TABLE "backoffice_session" ADD COLUMN     "csrf_token" TEXT;

-- AlterTable
ALTER TABLE "session" ADD COLUMN     "csrf_token" TEXT;

-- ===== MANUAL: BEGIN =====

-- --- Las dos restricciones ------------------------------------------------
--
-- GUARDA: ninguna de las dos es alcanzable desde la API. El token lo genera
-- SIEMPRE el servidor con `GeneradorDeTokens.generar()` (32 bytes en base64url
-- = 43 caracteres) y ningun endpoint acepta un `csrf_token` de entrada, asi
-- que no hay peticion que pueda violarlas. Son ESTRUCTURALES en el sentido de
-- docs/sistema/guardas-de-dominio.md y estan aqui para que un `UPDATE` a mano
-- o una migracion futura no metan una cadena vacia, que el comparador leeria
-- como «sin token» en un sitio y como «token» en otro. El rango es holgado a
-- proposito: fija un minimo de entropia sin atar la base a la codificacion
-- elegida hoy.
ALTER TABLE "session"
  ADD CONSTRAINT "session_csrf_acotado"
  CHECK ("csrf_token" IS NULL OR length("csrf_token") BETWEEN 32 AND 128);

ALTER TABLE "backoffice_session"
  ADD CONSTRAINT "backoffice_session_csrf_acotado"
  CHECK ("csrf_token" IS NULL OR length("csrf_token") BETWEEN 32 AND 128);

-- --- `session_lookup` devuelve tambien el token ----------------------------
--
-- `CREATE OR REPLACE` NO SIRVE: cambia el tipo de retorno de la funcion y
-- PostgreSQL lo rechaza con «cannot change return type of existing function».
-- Hay que soltarla y volver a crearla — y eso obliga a repetir el REVOKE y el
-- GRANT: una funcion nueva nace sin los privilegios de la anterior, y
-- `SECURITY DEFINER` sin REVOKE a PUBLIC seria una lectura sin tenant abierta
-- a cualquiera.
--
-- POR QUE VIAJA AQUI Y NO EN UNA CONSULTA APARTE: `session_lookup` ya corre en
-- CADA peticion. Una segunda lectura para el token duplicaria las consultas de
-- toda la API para traer una columna de la MISMA fila.
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
    ubicaciones_de_company uuid[],
    csrf_token      text
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
         COALESCE(loc."de_la_company", ARRAY[]::uuid[]),
         s."csrf_token"
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
  'Desde P15 devuelve las ubicaciones de la company; desde P16-A2, el token anti-CSRF '
  'de la sesion (ADR-021), para que la comprobacion no cueste una consulta mas.';

REVOKE EXECUTE ON FUNCTION session_lookup(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION session_lookup(text) TO costeo_app;

-- ===== MANUAL: END =====
