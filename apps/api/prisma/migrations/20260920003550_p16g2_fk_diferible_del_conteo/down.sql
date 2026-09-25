-- ===== MANUAL-REVERSE: BEGIN =====
--
-- Vuelve a ser NOT DEFERRABLE, que es como nació en P7. El efecto de revertir
-- está dicho y no es menor: la restauración por tenant deja de poder reponer
-- los conteos confirmados de un cliente.

ALTER TABLE "physical_count_line"
  DROP CONSTRAINT "physical_count_line_count_id_company_id_fkey";

ALTER TABLE "physical_count_line"
  ADD CONSTRAINT "physical_count_line_count_id_company_id_fkey"
    FOREIGN KEY ("count_id", "company_id") REFERENCES "physical_count"("id", "company_id")
    ON UPDATE CASCADE ON DELETE RESTRICT;

-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260920003550_p16g2_fk_diferible_del_conteo';
