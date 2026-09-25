# ADR-024 — El IVA de compra en dos niveles, y la discontinuidad que deja en el libro

**Fecha:** 2026-09-09 · **Paquete:** P16-A1 · **Estado:** aceptada

---

## Contexto

Hasta P16-A1 el libro de inventario no sabía nada de IVA. `total_cost` era «el
dinero que se movió», y el bodeguero que tecleaba el total de una factura **con**
IVA metía el impuesto entero en el costo del plato. La tarifa vivía solo en el
precio de referencia, con `company_settings.iva_compra` como valor por defecto:
el precio de un plátano nacía con el IVA del detergente.

El usuario decidió (D-16.9, U5): **el bodeguero escribe el total de la factura
con IVA**; la tarifa es del artículo de compra; la recuperabilidad es de la
company (R13). Y dejó tres cosas abiertas que este ADR cierra: qué pasa con las
compras anteriores, qué significa `total_cost` a partir de ahora, y con qué
valor nacen los artículos que ya existen.

Lo que manda por encima de todo es CLAUDE.md §0: *el producto real es la
exactitud del número*. Un neteo que se aplica dos veces, o que no se aplica, no
se ve en pantalla; se ve seis meses después en el food cost.

---

## Decisión 1 — Dos niveles, y ninguno es la company

La **tarifa** vive en `purchase_article.iva_tarifa` (obligatoria: la factura del
saco de harina dice 0 % y la del detergente 15 %) y, para las compras sin
artículo, en `item_group.iva_tarifa` (opcional: «el grupo no define» es un
estado). Por encima de las dos, la que traiga la propia petición o la fila del
archivo: quien tiene la factura delante sabe más que el catálogo.

**Nunca hay un valor por defecto.** Sin tarifa en ningún nivel, la compra —o el
precio de referencia, o la fila del CSV— se rechaza con 400 y el mensaje dice
dónde ponerla. `company_settings.iva_compra` dejó de leerse (D-16.43) y se
retira en P16-B, que es el paquete que toca `ajustes`.

La **recuperabilidad** sigue siendo de la company (R13): es una condición fiscal
del contribuyente, no del insumo.

La precedencia y la fórmula viven **una sola vez**, en `shared/domain/iva/`
(D-16.40): `pricing` e `inventory` la llaman. Dos copias son dos oportunidades de
que el costo del plato y el food cost real dejen de hablar del mismo número.

---

## Decisión 2 — `total_cost` pasa a ser el NETO, y solo en las COMPRA nuevas

Cada `COMPRA` nueva persiste los cuatro importes (D-16.10):

| Columna | Qué guarda |
|---|---|
| `total_bruto` | lo que dice la factura |
| `iva_tarifa_aplicada` | la tarifa con la que se neteó |
| `iva_recuperable_aplicado` | el ajuste de la company **en ese momento** |
| `total_cost` | el neto: `recuperable ? bruto / (1 + tarifa) : bruto` |

y `desglose_conocido = true`. Son la **foto del momento** (D-16.42): cambiar el
ajuste después no reescribe el libro, que es append-only (R3).

**Las COMPRA anteriores a P16-A1 no se rellenan** (D-16.18). Nadie sabe con qué
tarifa se pagó cada una, y una tarifa inventada sería exactamente el «0.15 por
defecto» que este paquete elimina. Quedan con `desglose_conocido = false`, los
tres campos nuevos en `NULL` y `total_cost` **tal como se tecleó**.

**Eso deja una discontinuidad, y se dice en vez de esconderse.** `compras_del_mes`
(SPEC §16) sigue sumando `total_cost`: en las filas nuevas es neto —coherente con
`costo_neto_uso`, que también es neto—, en las filas «sin desglose» es lo que se
tecleó, con o sin IVA según lo que el bodeguero hiciera ese día. En un mes que
mezcle las dos clases de fila, el food cost real está entre el que saldría con
todo bruto y el que saldría con todo neto, y no hay forma de saber dónde. La
pantalla del libro lo enseña fila a fila (`desglose: 'SIN_DESGLOSE'`, P16-C) y
el mes en que el piloto empiece a capturar con desglose es el primero comparable.

`PRODUCCION` y los demás tipos no cambian: `desglose_conocido` solo puede ser
`true` en una `COMPRA` (CHECK `inventory_movement_desglose_coherente`, D-16.41).
La **corrección** de una compra conserva el tipo y **copia los cuatro campos**
del original, así Σ(COMPRA) del mes se cancela sola en bruto y en neto; la de
una compra vieja copia «nada» y queda sin desglose, como su original.

---

## Decisión 3 — La semilla 0.15 es semilla, no verdad

`purchase_article.iva_tarifa` nace `NOT NULL` sobre una tabla con filas. Hace
falta un valor para llenarlas y se elige la tarifa general del Ecuador,
**declarada como semilla** en el propio SQL de la migración. El `DEFAULT` se
suelta en la misma migración: ningún artículo nuevo lo hereda en silencio, el
alta exige la tarifa.

Los artículos existentes se corrigen con `PUT /catalogo/articulos/:id`, que
D-16.45 adelantó a este paquete precisamente para eso. Para el piloto es un paso
del runbook: revisar los artículos exentos (alimentos sin procesar) antes de la
primera compra con desglose.

---

## Decisión 4 — «Toda COMPRA nueva nace con desglose» es garantía de aplicación

D-16.25 lo exige, y la base **no puede garantizarlo**: `desglose_conocido =
false` con los tres campos `NULL` es el estado legítimo de las compras
anteriores a P16-A1, y un `CHECK` no distingue una fila vieja de una nueva que
llegue mal. El CHECK garantiza «todo o nada, y solo en COMPRA»; nada más.

Se consideró un trigger `BEFORE INSERT` que rechazara `COMPRA` sin desglose con
`recorded_at` posterior al instante de la migración. Se descartó: las siembras
SQL de rendimiento (`scripts/lib/volumen.sql`, tres suites) y la propia prueba
de la fila «anterior a P16-A1» escriben `COMPRA` sin desglose como dueña, y
habrían tenido que falsear `recorded_at` para pasar. Un trigger que las
propias pruebas necesitan esquivar protege menos de lo que parece.

Lo que sí hay: **`exigirDesgloseEnCompra`** (`inventory/domain/compra.ts`),
llamada en `comoFila`, la única función del repositorio por la que entra toda
fila del libro. Toda ruta de aplicación —incluida la de mañana: §23 HACCP en
P16-C, el back office— pasa por ahí, y una `COMPRA` nueva sin desglose sale
como 400 `CompraSinDesgloseError` antes de tocar la base. Queda fuera, y se
dice: el SQL a mano (siembras, scripts). Si aparece una segunda ruta SQL que
escriba compras, el trigger vuelve a la mesa.

---

## Decisión 5 — Una preparación no lleva IVA de compra (D-16.51)

El revisor adversarial destapó un defecto latente que la precedencia hacía
obligatorio: un ítem `PRODUCIDO` en un grupo con tarifa 0.15 nacía con 0.15 y
`CostosDeItems` dividía su costo estándar entre 1.15. Pero ese costo estándar
**ya es neto**: sale de sumar insumos que se netearon uno a uno, y
`produccion.ts` lo dice al dar de alta el lote («PRODUCCION no se netea»).
Platos con subpreparaciones subcosteados un 13 % sin que nada avisara. Con el
default de company pasaba lo mismo desde P5; con la precedencia, además, una
preparación sin grupo exigía una tarifa que no tiene.

Se decidió: **una preparación ignora artículo y grupo y nace con tarifa `0`**;
si el cuerpo o la fila traen otra cosa, 400 con el motivo (`PreparacionConIvaError`,
`pricing/domain/preparacion.ts`). No se elige «respetar lo que venga» porque no
existe un caso legítimo de preparación con IVA de compra, y aceptar uno es
aceptar un plato mal costeado.

Los precios de referencia de preparaciones **ya existentes** con tarifa distinta
de cero no se reescriben (R5: un precio no se edita, se añade uno nuevo). Se
corrigen sugiriendo y confirmando un precio nuevo, que nace con `0`.

Es una decisión fuera del plan aprobado, tomada en modo autónomo por la opción
más conservadora para el número; queda registrada aquí y en `ESTADO.md` para
que el usuario la ratifique antes del commit del paquete.

---

## Lo que cuesta, dicho sin adornos

- **El primer mes del piloto no es comparable con el anterior** si mezcla
  compras con y sin desglose. Se dice en pantalla y en el runbook; no se arregla
  con datos.
- **Los artículos existentes llevan un 0.15 que puede ser mentira** hasta que
  alguien los revise. La revisión es un paso del runbook, no un botón.
- **Una ruta SQL futura puede escribir una COMPRA sin desglose** y la base no lo
  impedirá. La guarda está en el repositorio; el SQL a mano queda avisado aquí.
- **`company_settings.iva_compra` sigue en la tabla** hasta P16-B, sin leerse.
