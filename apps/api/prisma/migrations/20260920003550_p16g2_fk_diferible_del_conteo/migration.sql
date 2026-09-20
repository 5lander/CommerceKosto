-- La clave foránea de la línea de conteo pasa a ser DIFERIBLE — D-16.198.
--
-- EL PROBLEMA, QUE ENCONTRÓ EL SIMULACRO. Restaurar un solo tenant reinserta su
-- historia tal como estaba, y un tenant con un mes cerrado tiene, por fuerza, un
-- conteo CONFIRMADO: el cierre del período pasa por él. Pero
-- `physical_count_line_solo_en_borrador` rechaza escribir líneas de un conteo
-- confirmado —y hace bien, es su trabajo—, así que **un cliente con más de un
-- mes de uso no se podía restaurar solo**. Que es justo el caso para el que
-- existe la restauración por tenant.
--
-- POR QUÉ NO SE ARREGLÓ COMO LOS PERÍODOS. A un período cerrado se le da la
-- vuelta dentro de la transacción —abrir, insertar, volver a cerrar— porque sus
-- `CHECK` admiten el estado intermedio. Los del conteo no: son bicondicionales
-- (`(status = 'CONFIRMADO') = (confirmed_at IS NOT NULL)` y dos más), y encima
-- `physical_count_confirmado_no_se_edita` prohíbe devolverlo a borrador. Las dos
-- cosas están bien puestas y ninguna se toca aquí.
--
-- LA SALIDA ES EL ORDEN, OTRA VEZ: las líneas entran ANTES que su conteo. El
-- guardián se ejecuta igual —no se desactiva nada— y deja pasar porque el
-- conteo todavía no está; quien comprueba que cada línea acabó teniendo el suyo
-- es esta clave foránea, al COMMIT. Para eso tiene que ser diferible.
--
-- `INITIALLY IMMEDIATE` ES LA MITAD IMPORTANTE. La comprobación sigue siendo
-- inmediata para todo el mundo: la aplicación nunca difiere nada, y una línea
-- huérfana escrita por la API falla en el acto, como hasta hoy. Solo la
-- transacción de la restauración pide `SET CONSTRAINTS ... DEFERRED`, y solo
-- para esta clave. Decisión del usuario, con su contra escrito en
-- `scripts/lib/tenant.mjs`: durante esa ventana el guardián de la línea pasa en
-- vacío, y es la clave foránea la que sostiene la coherencia.
--
-- PRISMA NO SABE DECLARAR `DEFERRABLE`, así que esto vive en el bloque MANUAL y
-- `schema.prisma` no cambia: la forma de la relación es la misma.

-- ===== MANUAL: BEGIN =====

ALTER TABLE "physical_count_line"
  DROP CONSTRAINT "physical_count_line_count_id_company_id_fkey";

ALTER TABLE "physical_count_line"
  ADD CONSTRAINT "physical_count_line_count_id_company_id_fkey"
    FOREIGN KEY ("count_id", "company_id") REFERENCES "physical_count"("id", "company_id")
    ON UPDATE CASCADE ON DELETE RESTRICT
    DEFERRABLE INITIALLY IMMEDIATE;

-- ===== MANUAL: END =====
