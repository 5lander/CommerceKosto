-- ===== MANUAL-REVERSE: BEGIN =====
--
-- `RESET search_path` devuelve las tres funciones a heredar el del llamante,
-- que es exactamente el defecto de INC-030. Se escribe igual, porque un down
-- que no deshace no es un down — y porque revertir esta migración significa
-- volver a la versión del código anterior, donde nada la necesitaba.

ALTER FUNCTION rechazar_linea_de_conteo_confirmado()    RESET search_path;
ALTER FUNCTION rechazar_edicion_de_conteo_confirmado()  RESET search_path;
ALTER FUNCTION rechazar_movimiento_en_periodo_cerrado() RESET search_path;

-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260920002554_p16g2_search_path_de_las_guardas';
