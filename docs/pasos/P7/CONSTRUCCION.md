# P7 — Períodos y conteo físico

> **Objetivo del plan.** «Poder cerrar un mes y compararlo con el siguiente.»

| | |
|---|---|
| **Fecha** | 2026-09-04 |
| **Commit** | `P7: Períodos · conteo físico` |
| **Migración** | `20260904223303_p7_periodos_y_conteo` |
| **Pruebas** | 413 unitarias (con la base apagada) + 246 de integración |

---

## Lo que se construyó

| # | Entregable del plan | Dónde |
|---|---|---|
| 1 | Período mensual abierto/cerrado; cerrado es de solo lectura (D6) | módulo `periods` + trigger sobre el libro |
| 2 | Conteo físico por ubicación, **parcial permitido**, con porcentaje del valor contado (D7) | `inventory/domain/conciliacion.ts` |
| 3 | **Conteo a ciegas para `BODEGA`** (R8): la hoja no recibe stock teórico ni derivados | dos casos de uso, dos permisos, dos DTO |
| 4 | Reapertura solo por `OWNER`, con motivo obligatorio y registrada | `ReabrirPeriodo` + `period.reopen` |

Y tres cosas que el plan no listaba pero que el paquete necesitaba:

| | |
|---|---|
| 5 | **`exigirLibroEscribible`**: las tres comprobaciones de toda escritura del libro, reunidas. `grep` da la lista completa de formas de escribir en él |
| 6 | El **consumo real de SPEC §16** —`inicial + compras − final físico`— con su cobertura al lado. Es la mitad física del food cost real, y P8 hereda la otra |
| 7 | `saldos(..., hasta)` y `comprasEntre(...)` en el puerto del libro: el corte del conteo y `compras_del_mes` |

---

## Las decisiones, y qué se rompe si se eligen al revés

Están razonadas completas en **ADR-010**. En una línea cada una:

| Decisión | Qué se rompe con la contraria |
|---|---|
| El período es de una **ubicación** | Las diez ubicaciones de una cadena tendrían que contar el mismo día para cerrar el mes |
| La frontera se guarda como **dos instantes** | Cambiar la zona horaria movería de mes movimientos ya cerrados y auditados |
| **La ausencia de fila es «abierto»** | El sistema se pararía solo el día 1 de cada mes |
| El conteo **no ajusta el libro** | `diferencia = conteo − teórico` daría cero siempre: el hallazgo desaparece al registrarlo |
| Un ítem sin contar vale **su teórico**, no cero | Todo conteo parcial inflaría el food cost real, de forma plausible |
| Confirmar **congela** teórico y costo por línea | Un precio retroactivo reescribiría el inventario de un mes ya informado |
| **Un solo confirmado por período** | `inventario_final_fisico` dependería de cuál eligiera cada consulta |
| Cerrar es un **paso del conteo** | Un mes sellado sin medición no puede producir food cost real nunca |
| `BODEGA` cuenta y **no** concilia | Con el stock teórico despeja el consumo, y de ahí la receta |

---

## Lo que P7 encontró y no esperaba

### 1. Un instante UTC del día 1 pertenece al mes anterior — y me lo encontré yo

Escribiendo la prueba de la corrección puse una compra en `2026-09-01T00:00:00Z` y la vi rechazada por «período cerrado» sin que septiembre estuviera cerrado. **Estaba en agosto**: las 00:00 UTC del 1 de septiembre son las 19:00 del 31 de agosto en Guayaquil.

Es exactamente el fallo que este paquete existe para prevenir, encontrado desde dentro. Queda como **INC-013**, con dos prevenciones de distinta fuerza:

- **Automatizada:** `periodos.spec.ts` recorre los doce meses de 2026 en tres zonas —una sin horario de verano, una del hemisferio norte y una del sur— y exige que cada frontera vuelva a caer en su propio mes. Un desfase mal medido rompe eso por una hora, que es el tamaño exacto del error.
- **Convención, no check:** las fechas de prueba llevan hora `12:00Z`, que cae en el mismo día natural en toda América. No es automatizable sin falsos positivos —hay fechas `T00:00:00Z` perfectamente legítimas—, y decirlo es más honesto que inventar una regla ruidosa.

### 2. El `down.sql` no podía soltar una función que un trigger seguía usando

`migrate:verify` lo paró en el segundo paso:

```
ERROR: cannot drop function rechazar_edicion_de_conteo_confirmado()
       because other objects depend on it
DETAIL: trigger physical_count_confirmado_no_se_edita on table physical_count
```

El bloque `MANUAL-REVERSE` va **primero**, y las tablas se borran después, en el bloque de Prisma: mientras tanto los triggers siguen vivos. Hubo que soltarlos a mano antes que sus funciones.

**No se registra como incidencia** porque su prevención ya existía y funcionó: el paso 2 de `migrate:verify` —«escalera: ida y vuelta entera»— es literalmente esta comprobación. La herramienta hizo su trabajo el primer día.

### 3. La siembra del test de rendimiento chocó contra su propia garantía

Sembrar el conteo confirmado y luego sus 500 líneas falló con «Ese conteo ya está confirmado y no admite cambios», **ejecutando como dueño de la tabla**. El trigger `physical_count_line_solo_en_borrador` no distingue roles.

Hay que sembrar en `BORRADOR`, insertar las líneas y confirmar al final — que es exactamente el orden que el repositorio se ve obligado a seguir, y por el mismo motivo. La prueba de rendimiento acabó documentando el orden mejor que el comentario que ya estaba en el repositorio.

### 4. Ninguna prueba puede leer `audit_log`, ni siquiera como dueño

Quise comprobar que `period.reopened` guarda su motivo. No se puede: `audit_log` tiene `FORCE ROW LEVEL SECURITY` y **no existe política de `SELECT` para nadie** —ni para la aplicación, ni para el migrator—. Es lo que SEGURIDAD.md §10 pide: «el acceso al log de auditoría es de solo lectura, restringido al back office».

Consecuencia concreta: los eventos de P0 a P7 **se escriben y nadie los ha verificado leyéndolos**. Ese es trabajo de **P11**, y queda anotado en `ESTADO.md` como pendiente con nombre.

### 5. El check de plan que decía lo contrario de lo que pasaba

Escribí que la guarda del período usaría `Seq Scan` por ser una tabla diminuta. **Usa `Index Scan`** — el `EXPLAIN` está en la evidencia. La prueba seguía pasando porque mide tiempo y no plan, así que el comentario habría quedado ahí, falso, para siempre.

Corregido, y la prueba sigue midiendo tiempo a propósito: `period` es pequeña, y en una company de una sola ubicación un `Seq Scan` será la elección **correcta**. Exigir el índice rompería la prueba por un plan que está bien.

---

## Prueba manual

Con `docker compose up -d db pgbouncer` y `npm run dev`, autenticado como `ADMIN`:

```bash
# 1. Abrir el conteo de marzo. El CORTE es el fin de marzo, no hoy.
curl -X POST localhost:3000/conteos -b cookies.txt \
  -H 'content-type: application/json' \
  -d '{"locationId":"<bodega>","anio":2026,"mes":3,"note":null}'
# -> 201 { "id": "..." }

# 2. La hoja: TODOS los items almacenables, y lo que se lleva anotado.
#    Sin stock teorico. Es lo que ve BODEGA.
curl localhost:3000/conteos/<id>/hoja -b cookies.txt
# -> { "conteo": {...}, "filas": [{ "itemId":"...", "nombre":"Cebolla",
#      "unidadDeUso":"kg", "cantidad": null }, ...] }

# 3. Anotar. Es un PUT: la grilla se guarda entera.
curl -X PUT localhost:3000/conteos/<id>/lineas -b cookies.txt \
  -H 'content-type: application/json' \
  -d '{"lineas":[{"itemId":"<cebolla>","cantidad":"8.5"}]}'

# 4. La conciliacion, ANTES de confirmar: previsualizacion para el gerente.
curl localhost:3000/conteos/<id> -b cookies.txt
# -> diferencia, valorizacion, cobertura y consumo real

# 5. Confirmar: congela teorico y costo en cada linea. Devuelve 204 y NADA MAS.
curl -X POST localhost:3000/conteos/<id>/confirmacion -b cookies.txt

# 6. Cerrar el mes. Exige count.write Y period.close.
curl -X POST localhost:3000/conteos/<id>/cierre-de-periodo -b cookies.txt

# 7. Y a partir de aqui, marzo es de solo lectura
curl -X POST localhost:3000/inventario/movimientos -b cookies.txt \
  -H 'content-type: application/json' -d '{
    "locationId":"<bodega>","itemId":"<cebolla>","tipo":"COMPRA",
    "cantidad":"5","costoTotal":"10.00","purchaseArticleId":null,
    "occurredAt":"2026-03-20T12:00:00.000Z","note":null}'
# -> 409 "El periodo 2026-03 de esa ubicacion esta cerrado y no admite
#         movimientos. Para modificarlo hay que reabrirlo primero."

# 8. Reabrir: SOLO el OWNER, y con motivo
curl -X POST localhost:3000/periodos/<periodId>/reapertura -b owner.txt \
  -H 'content-type: application/json' -d '{"motivo":"falto una factura"}'
```

**Y la comprobación que más importa**, autenticado como `BODEGA`:

```bash
curl localhost:3000/conteos/<id>/hoja -b bodega.txt   # -> 200, a ciegas
curl localhost:3000/conteos/<id>      -b bodega.txt   # -> 403
# La conciliacion lleva stock teorico, y de ahi se despeja la receta (§4.3)
```

---

## Lo que P7 deja preparado para P8 y P9

| Para | Qué queda listo | Qué falta |
|---|---|---|
| **P8** — food cost real (SPEC §16) | `inventario_inicial`, `compras_del_mes`, `inventario_final_fisico` y `CONSUMO_REAL`, encadenados mes a mes y congelados | `venta_neta_mes`, que necesita **la tabla de unidades vendidas**. Y `consumo_teorico`, que sale de la receta |
| **P8** — inventario valorizado (SPEC §18) | La conciliación de un mes cerrado es **una lectura**, no un cálculo | `stock_teorico` anclado en el conteo anterior, `dias_cobertura` y el punto de reorden |
| **P8** — semáforo de `BODEGA` | Los permisos ya separan contar de conciliar | El punto de reorden, que sale del consumo teórico |
| **P9** — consolidado | El estado del período por ubicación | Exponerlo: el consolidado puede estar sumando meses cerrados con meses abiertos, y tiene que decirlo |
| **P11** — back office | Los eventos `period.closed`, `period.reopened`, `count.created` y `count.confirmed` se escriben | **Leerlos.** Hoy no existe ningún rol que pueda hacer `SELECT` sobre `audit_log` |
