-- ===== MANUAL-REVERSE: BEGIN =====
-- El reverso del bloque MANUAL, y va PRIMERO: hay que quitar lo que cuelga de
-- una columna antes de quitar la columna.
--
-- LA SEMILLA `audit_event_type` NO SE BORRA (INC-011 / M10): un `audit_log` que
-- ya la referencie haría irrevertible esta migración sobre una base con datos, y
-- el log es append-only (SEGURIDAD.md §10).
--
-- Y UNA ADVERTENCIA SOBRE LOS DATOS. Soltar `import_job_id` pierde el hilo entre
-- cada movimiento y la importación de la que vino: los movimientos se quedan
-- —el libro no se edita— pero deja de saberse cuáles entraron por archivo, así
-- que ninguna de esas importaciones se podrá volver a anular como tal. Las
-- anuladas antes del down ya emitieron sus movimientos de signo contrario, y
-- esos también se quedan: el saldo no cambia al revertir el código.

-- El estado vuelve a ser CONFIRMADA en las anuladas: es de donde vinieron, y el
-- CHECK viejo no admite ANULADA. Lo que hicieron ya está en el libro.
UPDATE "import_job" SET "status" = 'CONFIRMADA' WHERE "status" = 'ANULADA';

ALTER TABLE "import_job"
  DROP CONSTRAINT IF EXISTS "import_job_anulada_es_coherente",
  DROP CONSTRAINT IF EXISTS "import_job_confirmada_es_coherente";

ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_confirmada_es_coherente"
    CHECK (
      (("status" = 'CONFIRMADA') = ("confirmed_at" IS NOT NULL))
      AND (("status" = 'CONFIRMADA') = ("written_rows" IS NOT NULL))
    );

ALTER TABLE "import_job"
  DROP CONSTRAINT IF EXISTS "import_job_voided_by_fkey",
  DROP COLUMN IF EXISTS "voided_by",
  DROP COLUMN IF EXISTS "voided_at";

-- LA FILA `'ANULADA'` DEL CATÁLOGO TAMPOCO SE BORRA, Y SU CHECK SE QUEDA CON
-- ELLA (M10, INC-011). Dos razones, y la segunda es mecánica:
--
--   1. `import_job_status` es un catálogo al que apunta `import_job` con
--      `ON DELETE RESTRICT`. Aquí arriba ninguna importación queda ya en
--      `ANULADA`, pero la regla no se gana caso a caso: un catálogo que
--      sostiene historia se trata como append-only, igual que las semillas de
--      `audit_event_type`.
--   2. Volver a estrechar el CHECK con la fila puesta FALLA: `ADD CONSTRAINT`
--      valida las filas existentes y `'ANULADA'` no pasaría. Quitar la fila y
--      quitar el CHECK son la misma decisión, no dos.
--
-- Lo que queda tras el down es un código de estado inalcanzable —ninguna
-- importación puede llegar a él sin el código que esta migración trae— y el
-- `DROP TABLE` del down de P10 se lo lleva entero cuando se baja del todo.

DROP INDEX IF EXISTS "inventory_movement_por_importacion";

ALTER TABLE "inventory_movement"
  DROP CONSTRAINT IF EXISTS "inventory_movement_import_job_id_fkey",
  DROP COLUMN IF EXISTS "import_job_id";

-- ===== MANUAL-REVERSE: END =====

-- ===== PRISMA (migrate diff) =====
-- This is an empty migration.

-- ===== HISTORIAL =====
-- No se usa `migrate resolve --rolled-back`: ese comando solo acepta
-- migraciones FALLIDAS, y aqui se revierten migraciones exitosas. Borrar la
-- fila aqui deja ademas el down.sql autocontenido y atomico junto al DDL.
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20260919234308_p16h_anulacion_de_importacion';
