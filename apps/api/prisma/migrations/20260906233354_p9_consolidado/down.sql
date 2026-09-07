-- ===== MANUAL-REVERSE: BEGIN =====
-- Primero las concesiones, que apuntan al permiso; despues el permiso. El orden
-- inverso fallaria por la clave foranea de `role_permission`.
--
-- Se pueden borrar filas de `permission` sin soltarla porque el unico que la
-- referencia es `role_permission`, y se vacia en la sentencia de al lado. Es el
-- mismo caso que M10 acepto en el down de P2.
DELETE FROM "role_permission" WHERE "permission_code" = 'analytics.consolidated.read';
DELETE FROM "permission" WHERE "code" = 'analytics.consolidated.read';
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260906233354_p9_consolidado';
