-- P16-C — la version de la carga del mes, y el evento de editar una ubicacion.
--
-- LA VERSION DEL PERIODO (D-16.121, ADR-023) no cuenta todas las escrituras del
-- mes: cuenta las de sus DOS CARGAS POR REEMPLAZO, las unidades vendidas y los
-- costos fijos. Un movimiento del libro crea el periodo pero no lo sube, ni lo
-- suben el cierre ni la reapertura: ninguno de los tres deja obsoleta la rejilla
-- de ventas que alguien tiene abierta. Las filas existentes nacen en 1, que es
-- tambien la version con la que se lee un mes que todavia no tiene fila
-- (D-16.122).

-- AlterTable
ALTER TABLE "period" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- ===== MANUAL: BEGIN =====
-- La version empieza en 1 y solo sube, siempre como `version + 1` en la misma
-- sentencia que comprueba la esperada. Un cero solo lo pondria SQL a mano.
ALTER TABLE "period" ADD CONSTRAINT "period_version_positiva" CHECK ("version" >= 1);

-- Sin GRANT nuevo: `costeo_app` ya tiene UPDATE sobre `period` (P7, cerrar y
-- reabrir), y la columna nueva lo hereda.

-- `PUT /ubicaciones/:id` (D-16.127). Idempotente, como las semillas anteriores.
INSERT INTO "audit_event_type" ("code", "domain", "requires_company") VALUES
  ('location.updated', 'location', true)
ON CONFLICT ("code") DO NOTHING;
-- ===== MANUAL: END =====
