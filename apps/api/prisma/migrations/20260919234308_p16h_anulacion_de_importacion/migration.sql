-- Una importación que escribió en el libro se puede deshacer COMO IMPORTACIÓN.
--
-- D-16.200. Hasta aquí, un archivo de movimientos mal armado —el mes cambiado,
-- la columna de cantidad en la unidad que no era, el archivo de otra sucursal—
-- dejaba cientos de filas en un libro que NO SE EDITA (R3). Deshacerlo era
-- corregir movimiento por movimiento desde la pantalla, a mano, sabiendo cuáles
-- eran; y si alguien se saltaba uno, el saldo quedaba mal para siempre sin que
-- nada avisara.
--
-- Dos cosas lo arreglan, y las dos son de esta migración:
--
--   1. CADA MOVIMIENTO IMPORTADO SABE DE QUÉ IMPORTACIÓN VINO. Sin ese hilo no
--      hay forma de saber qué filas deshacer: el libro no distingue lo que entró
--      por un archivo de lo que entró a mano.
--   2. LA IMPORTACIÓN PUEDE QUEDAR `ANULADA`, que es un estado y no un borrado:
--      el rastro de lo que pasó se conserva entero, que es para lo que existe
--      `import_job`.
--
-- LA ANULACIÓN NO BORRA NI UNA FILA. Emite los movimientos de signo contrario,
-- que es como este sistema corrige el libro desde P6 (R3) — por eso esta
-- migración no toca ningún trigger ni afloja ninguna regla: el mes cerrado sigue
-- rechazando, y la anulación de una importación que cae en un mes cerrado se
-- detiene con su motivo, igual que la corrección de un movimiento suelto.

-- ===== MANUAL: BEGIN =====

-- --- 1. El hilo entre el libro y su importación -----------------------------
--
-- `NULL` es lo normal: casi todo el libro se escribe a mano. La clave foránea va
-- con `ON DELETE RESTRICT` porque una importación con movimientos vivos no se
-- puede borrar — su rastro es parte de la historia de esas filas.
--
-- El índice es PARCIAL a propósito: la consulta que lo usa —«dame los
-- movimientos de esta importación»— solo mira filas importadas, y en un libro de
-- millones de filas la inmensa mayoría tiene `NULL` aquí.
ALTER TABLE "inventory_movement"
  ADD COLUMN "import_job_id" UUID;

ALTER TABLE "inventory_movement"
  ADD CONSTRAINT "inventory_movement_import_job_id_fkey"
    FOREIGN KEY ("import_job_id") REFERENCES "import_job"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "inventory_movement_por_importacion"
  ON "inventory_movement" ("company_id", "import_job_id")
  WHERE "import_job_id" IS NOT NULL;

-- --- 2. El estado nuevo, y las invariantes que lo acompañan -----------------

ALTER TABLE "import_job_status"
  DROP CONSTRAINT "import_job_status_codigo_conocido";

ALTER TABLE "import_job_status"
  ADD CONSTRAINT "import_job_status_codigo_conocido"
    CHECK ("code" IN ('SUBIDA', 'ANALIZADA', 'CONFIRMADA', 'DESCARTADA', 'ANULADA'));

-- `ON CONFLICT DO NOTHING` y el down que NO la borra son la misma decisión: un
-- catálogo al que apuntan filas de evidencia es tan append-only como ella
-- (M10, INC-011). La fila sobrevive al down, así que volver a subir la
-- migración se la encuentra puesta.
INSERT INTO "import_job_status" ("code") VALUES ('ANULADA')
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "import_job"
  ADD COLUMN "voided_at" TIMESTAMPTZ(6),
  ADD COLUMN "voided_by" UUID;

ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_voided_by_fkey"
    FOREIGN KEY ("voided_by") REFERENCES "app_user"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- LA INVARIANTE DE CONFIRMACIÓN SE AMPLÍA, NO SE AFLOJA.
--
-- Decía «confirmada si y solo si hay fecha de confirmación y filas escritas». Una
-- importación ANULADA se confirmó antes —solo se anula lo que se escribió—, así
-- que conserva las dos cosas y el «si y solo si» tiene que contar con ella. Sin
-- este cambio, marcar ANULADA violaría el CHECK y la anulación fallaría con un
-- 500 del constraint en vez de hacer su trabajo.
ALTER TABLE "import_job"
  DROP CONSTRAINT "import_job_confirmada_es_coherente";

ALTER TABLE "import_job"
  ADD CONSTRAINT "import_job_confirmada_es_coherente"
    CHECK (
      (("status" IN ('CONFIRMADA', 'ANULADA')) = ("confirmed_at" IS NOT NULL))
      AND (("status" IN ('CONFIRMADA', 'ANULADA')) = ("written_rows" IS NOT NULL))
    ),

  -- Anulada si y solo si hay fecha y autor de la anulación: el rastro de quién
  -- deshizo qué es la mitad del valor de poder deshacerlo.
  ADD CONSTRAINT "import_job_anulada_es_coherente"
    CHECK (
      (("status" = 'ANULADA') = ("voided_at" IS NOT NULL))
      AND (("voided_at" IS NULL) = ("voided_by" IS NULL))
    );

-- --- 3. El evento de auditoría ---------------------------------------------
--
-- `requires_company` en true, al revés que los de autenticación: anular una
-- importación es siempre una acción DENTRO de una company, con su sesión.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('inventory.import.voided', 'inventory', true)
ON CONFLICT ("code") DO NOTHING;

-- ===== MANUAL: END =====
