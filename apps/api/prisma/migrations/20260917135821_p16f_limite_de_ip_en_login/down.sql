-- ===== MANUAL-REVERSE: BEGIN =====
-- LA SEMILLA `audit_event_type` NO SE BORRA (INC-011 / M10), y aqui la razon es
-- la del propio log: un `audit_log` que ya referencie `auth.login.ip_limited`
-- haria irrevertible esta migracion sobre una base con datos, y el log es
-- append-only (SEGURIDAD.md §10) — revertir el codigo no puede borrar lo que
-- paso. La fila del catalogo se queda: es una etiqueta, no una regla, y sin
-- eventos que la usen no molesta a nadie.
--
-- Esta migracion no toca nada mas: el cambio de D-16.196 es de codigo.
-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260917135821_p16f_limite_de_ip_en_login';
