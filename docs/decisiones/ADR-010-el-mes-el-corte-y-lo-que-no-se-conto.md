# ADR-010 — El mes, el corte y lo que no se contó

| | |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-04 |
| **Paquete** | P7 — Períodos y conteo físico |
| **Contexto** | SPEC §3, §16 y §18 · D6 y D7 · CLAUDE.md §4.3 |

> **Qué decide este ADR.** Las ocho cosas que P7 tuvo que resolver y que el SPEC no escribe. El SPEC dice que hacen falta períodos («el Excel no tiene dimensión temporal») y que el conteo puede ser parcial, pero no dice de quién es el período, dónde vive la frontera del mes, ni qué significa exactamente no haber contado un ítem.

---

## 1. El período es de una UBICACIÓN, no de la company

**Decisión.** `period` lleva `location_id`. Cada ubicación cierra su mes por separado.

**Por qué.** D6 dice que el mes «se cierra manualmente al cargar el conteo físico», y el conteo se hace por ubicación (R2: el inventario nunca mezcla ubicaciones). Un período de company obligaría a que las diez ubicaciones de una cadena contaran el mismo día para poder cerrar; en la práctica, ninguna cerraría nunca.

**Qué se rompe con la contraria.** El cierre pasa a ser un acto coordinado entre personas que no se hablan. Y la primera ubicación que se retrasa bloquea el food cost real de todas.

**Qué cuesta.** El consolidado de P9 tiene que decir *qué* ubicaciones están cerradas, porque puede sumar meses en estados distintos. Es una columna más en esa vista, no un problema de modelo: SPEC §18 ya dice que todo se calcula por ubicación y que el consolidado es la agregación.

---

## 2. La frontera del mes se guarda como DOS INSTANTES

**Decisión.** `period.starts_at` y `period.ends_at` son `timestamptz`, resueltos **una sola vez** al abrir el período, con la zona de `config/periods.ts`. El intervalo es semiabierto: `[starts_at, ends_at)`.

**Por qué.** `occurred_at` es un instante absoluto, y preguntar «¿de qué mes es?» exige una zona horaria. Las 02:00 UTC del 1 de abril son las 21:00 del 31 de marzo en Guayaquil: **marzo, no abril**. Si la zona se aplicara en cada consulta, cambiarla algún día —o desplegar en otro país— movería de mes movimientos ya cerrados y auditados.

Resolviéndola al abrir, todo lo demás es una comparación de instantes: en SQL, en el trigger y en TypeScript. La misma comparación, escrita tres veces, sin aritmética de zonas en ninguna.

**Qué se rompe con la contraria.** Guardar solo `(año, mes)` y calcular `date_trunc('month', occurred_at AT TIME ZONE ...)` en cada consulta: la frontera deja de ser un dato y pasa a ser una función de la configuración actual. Un mes cerrado dejaría de contener los mismos movimientos que contenía al cerrarlo.

**Efecto colateral bueno.** La consulta caliente —«¿hay un mes cerrado que cubra esta fecha?», que hace **toda** escritura del libro— es un rango sobre un índice, no una expresión por fila.

---

## 3. La ausencia de fila es el estado ABIERTO

**Decisión.** Un mes del que nadie se ha ocupado no tiene fila en `period`. La fila se crea cuando alguien abre un conteo o cierra el mes.

**Por qué.** La alternativa —exigir que alguien «abra» el mes antes de poder registrar nada— falla cerrado en el sitio equivocado: una company recién creada no podría anotar su primera compra, y el día 1 de cada mes el sistema dejaría de funcionar solo.

Cerrar es un acto explícito. Bloquear el libro también debe serlo.

**Qué se rompe con la contraria.** Nada de seguridad —esto no es una barrera de aislamiento— y mucho de operación: un sistema que se para solo cada 30 días.

---

## 4. El conteo NO ajusta el libro

**Decisión.** Confirmar un conteo no escribe ningún movimiento. El saldo del libro sigue diciendo lo que decía.

**Por qué.** Es la decisión de la que depende que el conteo signifique algo. SPEC §18 calcula `diferencia = conteo_fisico − stock_teorico`; si al confirmar se emitiera un `AJUSTE` por la diferencia, esa resta daría **cero siempre**, y la señal que el conteo existe para producir desaparecería en el mismo acto de registrarla.

El libro dice lo que *debería* haber. El conteo dice lo que *hay*. Su resta es el hallazgo, y no se puede tener el hallazgo y además hacerlo desaparecer.

**Qué se rompe con la contraria.** El food cost real de SPEC §16 deja de poder calcularse: `CONSUMO_REAL = inicial + compras − final_fisico` necesita que `final_fisico` sea una observación independiente del libro, no una copia suya.

**Qué cuesta.** Dos números que se parecen y no son el mismo, y hay que nombrarlos distinto siempre:

| | |
|---|---|
| **saldo del libro** | `SUM(quantity)` sobre `inventory_movement`. Lo de P6 |
| **stock teórico del período** | El saldo del libro **hasta el corte** del conteo |
| **inventario físico** | Lo contado donde se contó, lo teórico donde no |

---

## 5. Un ítem no contado vale su TEÓRICO, no cero

**Decisión.** En un conteo parcial (D7), un ítem sin línea no genera diferencia y aporta **su valor teórico** al inventario final.

**Por qué.** Es lo que «no genera diferencia» significa. Si valiera cero, no haber mirado un estante equivaldría a declarar que su contenido se consumió entero, y el consumo real de SPEC §16 se dispararía por una omisión de captura. Un dato que falta no es un dato que vale cero.

**Qué se rompe con la contraria.** Todo conteo parcial —o sea, todos— produciría un food cost real inflado, y el error crecería con lo que se dejara sin contar. Nadie lo notaría: el número seguiría siendo plausible.

**Cómo se sabe cuánto fiarse.** La cobertura de D7: `valor verificado ÷ valor total`. **Viaja siempre pegada** a los números que dependen de ella. Un consumo real calculado sobre el 12 % del valor no es un consumo real; es una estimación, y quien la lea tiene derecho a saberlo sin preguntar.

Se mide sobre el **valor**, no sobre el número de ítems: contar 40 ítems baratos y dejar el jamón sin contar es una cobertura mala aunque sean 40 de 41.

---

## 6. Confirmar CONGELA el teórico y el costo de cada línea

**Decisión.** Al confirmar se materializa una línea por cada ítem con saldo o con conteo —incluidas las de lo que nadie contó, con `quantity = NULL`— y se guardan en ella `theoretical_quantity` y `unit_cost`. Los tres valores agregados van en la cabecera.

**Por qué.** El costo de uso sale de precios **con vigencia** (R5). Un precio nuevo con `valid_from` retroactivo cambiaría el valor de un inventario que ya se informó. Es la misma razón por la que P6 congela el costo estándar de una producción (ADR-009 §4): **el valor de un inventario no puede cambiar porque alguien toque una tabla de precios.**

**Qué se rompe con la contraria.** La diferencia de un mes cerrado dejaría de ser un número y pasaría a ser una consulta cuyo resultado depende de cuándo se haga.

**Efecto colateral bueno.** La conciliación de un conteo confirmado es **una lectura de una tabla**. P8 no tiene que recalcular nada para el inventario valorizado de un mes cerrado.

---

## 7. Un solo conteo confirmado por período, con una columna anulable única

**Decisión.** `physical_count.confirmed_period_id` es una copia de `period_id` que solo existe cuando el conteo está `CONFIRMADO`, con índice único. Dos `CHECK` la atan a su original.

**Por qué la restricción.** `inventario_final_fisico` de SPEC §16 es **el** conteo del mes. Con dos confirmados, el food cost real de ese período dependería de cuál eligiera cada consulta.

**Por qué así y no con un índice parcial.** `CREATE UNIQUE INDEX ... WHERE status = 'CONFIRMADO'` diría lo mismo y sería más directo, pero Prisma no sabe declarar índices parciales: tendría que vivir en el bloque `MANUAL` de la migración y podría aparecer como deriva en `migrate:verify`, que es el check que garantiza que el esquema aplicado y `schema.prisma` no discrepan. La columna anulable es la misma restricción expresada con lo que la herramienta sí modela.

**Lo que hace falta además.** Un índice único produce `23505`, que sin guarda sale como **500** (INC-012). Lo detiene `ConteoDelPeriodoYaConfirmadoError`, con su prueba de 409 — exactamente el mismo patrón que `MovimientoYaCorregidoError` en P6.

---

## 8. Cerrar el mes es un paso del conteo, no un endpoint suelto

**Decisión.** No existe `POST /periodos/cierre`. El cierre es `POST /conteos/:id/cierre-de-periodo`, exige `count.write` **y** `period.close`, y requiere que el conteo esté confirmado.

**Por qué, en el negocio.** Es lo que D6 describe: «se cierra manualmente al cargar el conteo físico». Un mes que se sella sin la medición que lo mide no puede producir food cost real **nunca**: `inventario_final_fisico` se queda sin dato y ese período queda cerrado y ciego.

**Por qué, en la arquitectura.** `inventory` depende de `periods` —toda escritura del libro pregunta si el mes está cerrado—, así que la flecha tiene que ir en un solo sentido. Si el cierre viviera en `periods` y tuviera que comprobar el conteo, `periods` miraría hacia `inventory` y habría un ciclo: `audit:arch` lo pararía, y con razón. Poner el cierre donde vive su precondición resuelve las dos cosas a la vez.

**Los dos permisos y no uno.** `BODEGA` cuenta, pero no sella el mes.

---

## 9. `BODEGA` cuenta y no concilia

**Decisión.** `BODEGA` recibe `count.write` y `period.read`. **No** recibe `count.read`.

**Por qué.** La conciliación lleva stock teórico, diferencia y valorización de la diferencia: tres de los datos prohibidos de CLAUDE.md §4.3, y desde el stock teórico se despeja el consumo, y desde el consumo la receta.

Es la misma asimetría que P6 instaló sobre el saldo, y tiene la misma consecuencia no evidente: **ninguna escritura devuelve lo que acaba de calcular.** Confirmar un conteo calcula la conciliación entera y responde `204` sin cuerpo.

**Efecto colateral favorable, y el SPEC lo pide expresamente.** `BODEGA` cuenta **a ciegas**, sin saber cuánto debería haber. Quien conoce el número esperado tiende a ajustar el conteo hacia él, así que la restricción de confidencialidad **mejora la calidad del dato de inventario** (SPEC §4).

Para que sea ciego de verdad, la hoja lista **todos** los ítems almacenables, tengan saldo o no. Si trajera solo los que el libro conoce, la presencia de una fila ya diría «de esto hay algo» y su ausencia diría «cero».

---

## Consecuencias

- **P8** hereda la conciliación congelada: el inventario valorizado de un mes cerrado es una lectura, no un cálculo. Y hereda la obligación de llevar la cobertura pegada a todo número que dependa del conteo.
- **P9** tiene que exponer el estado del período por ubicación en el consolidado: puede estar sumando meses cerrados con meses abiertos.
- **P11** hereda un pendiente concreto: **no hay forma de leer `audit_log` desde una prueba**, ni siquiera con el rol dueño de la tabla, porque `FORCE ROW LEVEL SECURITY` y la ausencia de política de `SELECT` lo impiden a propósito (SEGURIDAD.md §10). Los eventos `period.closed` y `period.reopened` se escriben y **nadie los ha verificado leyéndolos**. Ese es el trabajo del back office.
- **La zona horaria de los períodos es configuración versionada** (`shared/infrastructure/config/periods.ts`). Cambiarla no reescribe la historia: los meses ya abiertos conservan la frontera con la que se abrieron.
