-- Tres guardas que dejaban de encontrar la tabla que vigilan — INC-030.
--
-- LO DESTAPÓ EL SIMULACRO DE RESTAURACIÓN POR TENANT (D-16.198), y así:
--
--   ERROR: relation "physical_count" does not exist
--   QUERY: SELECT c."status" FROM "physical_count" c WHERE c."id" = conteo
--   CONTEXT: PL/pgSQL function public.rechazar_linea_de_conteo_confirmado()
--
-- La tabla existía. Lo que no existía era el `search_path` con el que la
-- función esperaba encontrarla: `pg_dump --data-only` lo deja **vacío**
-- (`set_config('search_path', '', false)`) y una función que no fija el suyo
-- hereda el de quien la llama. Tres de las nuestras no lo fijaban:
--
--   rechazar_linea_de_conteo_confirmado      lee `physical_count`
--   rechazar_edicion_de_conteo_confirmado    lee `physical_count`
--   rechazar_movimiento_en_periodo_cerrado   lee `period`
--
-- **NO ES SOLO ROBUSTEZ, ES LA BARRERA.** Una guarda que resuelve el nombre de
-- su tabla con el `search_path` de quien escribe es una guarda que mira donde
-- le digan: bastaría un esquema por delante con una `physical_count` vacía para
-- que el conteo confirmado dejara de estar protegido. Hoy `costeo_app` no puede
-- crear esquemas —por eso esto no es un agujero abierto— pero la defensa no se
-- apoya en eso: se apoya en que la función sepa dónde mira.
--
-- Las otras nueve funciones del proyecto ya lo fijaban (`auth_lookup`,
-- `session_lookup`, `rechazar_mutacion`…), así que esto no inaugura un patrón:
-- cierra tres omisiones. Y `audit:migrations` M12 lo vigila desde hoy, para que
-- la décima nazca con él.
--
-- `ALTER FUNCTION` y no `CREATE OR REPLACE`: el cuerpo no cambia ni una línea, y
-- copiarlo aquí para cambiarle una cláusula dejaría dos versiones del mismo
-- texto a las que nadie obliga a coincidir.

-- ===== MANUAL: BEGIN =====

ALTER FUNCTION rechazar_linea_de_conteo_confirmado()    SET search_path = pg_catalog, public;
ALTER FUNCTION rechazar_edicion_de_conteo_confirmado()  SET search_path = pg_catalog, public;
ALTER FUNCTION rechazar_movimiento_en_periodo_cerrado() SET search_path = pg_catalog, public;

-- ===== MANUAL: END =====
