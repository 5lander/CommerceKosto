# P6 — Inventario: libro mayor append-only

> **Objetivo del plan.** «Saber cuánto hay y por qué, sin poder mentir.»

| | |
|---|---|
| **Fecha** | 2026-09-04 |
| **Commit** | `P6: Inventario · libro mayor append-only` |
| **Migración** | `20260904203551_p6_inventario` |
| **Pruebas** | 383 unitarias (con la base apagada) + 213 de integración |

---

## Lo que se construyó

| # | Entregable del plan | Dónde |
|---|---|---|
| 1 | `inventory_movement` append-only con los **siete** tipos del SPEC §7 | migración + `domain/movimiento.ts` |
| 2 | Saldo por (ubicación, ítem) como **proyección**, nunca campo mutable (R3) | `domain/saldo.ts` + `groupBy` en el repositorio |
| 3 | Transferencias como **par atómico** | `domain/transferencia.ts` + `inventory_transfer` |
| 4 | Producción con **costo real del lote frente al estándar** (R10) | `domain/produccion.ts` + `inventory_production` |
| 5 | **Interruptor por preparación**: con stock o sin stock | `domain/explosion.ts` + `llevaStock` conmutable en `catalog` |
| 6 | Corrección por movimiento de signo contrario; nunca edición | `domain/correccion.ts` |

Y dos cosas que el plan no listaba pero que el paquete necesitaba:

| | |
|---|---|
| 7 | `exigirUbicacionEnAlcance` **se muda de `recipes` a `iam`**, que es su sitio: es autorización de sesión, no una regla de recetas. Segundo módulo que la necesita, así que duplicarla o importar un error de dominio ajeno eran las dos alternativas malas |
| 8 | El **arreglo del glob de migraciones** en `audit:forbidden`, que el guardián destapó. Ver abajo |

---

## Las decisiones, y qué se rompe si se eligen al revés

Están razonadas completas en **ADR-009**. En una línea cada una:

| Decisión | Qué se rompe con la contraria |
|---|---|
| La cantidad lleva **signo** | Sin él, el saldo deja de ser una suma y cada consulta futura repite un `CASE` por tipo |
| El signo lo garantiza una **FK compuesta `(type, direction)`** | Sin ella, declarar `('COMPRA','SALIDA')` cuela una cantidad negativa saltándose el `CHECK` |
| Se guarda el **total**, no el unitario | Con el unitario, `compras_del_mes` (SPEC §16) pierde centavos y deja de cuadrar con la factura |
| La corrección **conserva el tipo** | Como `AJUSTE`, el mes cierra contando compras que nadie hizo |
| La producción se valora al **precio de referencia** | Con la receta vigente, editar una receta reescribiría el valor de lotes de hace meses |
| `BODEGA` escribe y **no lee** | Con el saldo, despeja el consumo y de ahí la receta |

### La duda abierta que P6 tenía que resolver: el rendimiento por lote

`ESTADO.md` la traía marcada como «la más accionable». **Se decidió no añadir columna.**

La receta de una preparación ya se expresa **por unidad de uso**, así que producir 5 litros es `receta × 5`: matemáticamente está completo, y el movimiento de producción funciona sin nada nuevo. Una columna de rendimiento por lote sería ergonomía de **captura** —para no obligar a dividir entre 5 al escribir la receta— y crearía dos fuentes para el mismo número.

Es aditiva si algún día se quiere, y no invalida historial: las recetas seguirían siendo por unidad de uso. **Queda a decisión del usuario**, sin bloquear nada.

---

## Lo que P6 encontró y no esperaba

### 1. El glob de migraciones no casaba con nada, y llevaba así desde P0

Al forzar el guardián de las dos reglas append-only nuevas —obligatorio al ampliar el alcance de un check, según INC-007— el resultado fue:

```
audit:forbidden  FALLO — 2 infraccion(es)
```

**Dos, y tenían que ser cuatro.** La regla SQL no apareció.

El patrón decía `prisma/migrations/**/*.sql`; las rutas que el escáner compara son relativas a la raíz: `apps/api/prisma/migrations/...`. Consecuencia: **desde P0, `no-select-star` y `append-only-sql-audit_log` no habían examinado una sola migración.**

Arreglado con una constante compartida. La medida de que el arreglo hizo algo es el contador del propio informe: **de 189 archivos escaneados a 203.**

Es **INC-007, recurrencia 9**, y la cazó la regla que dejó escrita la recurrencia 8: *un check que falla no está verificado; hay que mirar en cuántos sitios falla.*

### 2. La prueba del plan de ejecución no medía nada

El primer intento de exigir «la agregación del saldo usa el índice» fallaba, y el plan tenía razón: con una sola ubicación en la tabla, **la tabla entera es el resultado** y `Seq Scan` es la elección correcta.

Se arregló sembrando 19 ubicaciones de ruido, que es la condición realista de una tabla multi-ubicación. Sin ellas la prueba pasaba o fallaba por un motivo que no tiene que ver con el índice. Es la misma lección de INC-007 aplicada a un **dato** en vez de a un glob.

### 3. El mismo número salía con dos formas

`_sum` de Prisma devuelve el decimal normalizado —`"8.5"`— mientras que leer la columna devuelve `"8.500000000000"`. El saldo y el movimiento que lo produce salían distintos por la misma API. Todo pasa ahora por la escala de almacenamiento, que además es lo que permite comparar los dos caminos —el `SUM` de PostgreSQL y el pliegue en TypeScript— sin normalizar nada por medio.

### 4. INC-012 **no** reapareció, y el motivo importa

`ESTADO.md` avisaba de que P6 era «el candidato claro» a repetirla, porque el libro append-only es trigger puro. No pasó, por dos razones:

- Los triggers append-only resultaron **inalcanzables desde la API**: no existe ruta que edite un movimiento, y lo que sostiene que siga siendo así no es la disciplina de nadie sino `audit:forbidden`. Una guarda de runtime protegería contra código que no compila.
- Las **18 restricciones nuevas** se clasificaron una a una en `guardas-de-dominio.md` **antes** de escribir el primer endpoint. M11 lo exigió en la primera ejecución, tal como se diseñó en P5.

Lo que sí era alcanzable y habría dado 500 es otra cosa: **corregir dos veces el mismo movimiento**, que choca contra un índice único (`23505`, no un `CHECK`). Lo detiene `MovimientoYaCorregidoError`, y tiene su prueba de 409.

---

## Prueba manual

Con `docker compose up -d db pgbouncer` y `npm run dev`, autenticado como `ADMIN`:

```bash
# 1. Comprar 10 kg. Se captura en POSITIVO: el signo lo pone el tipo.
curl -X POST localhost:3000/inventario/movimientos -b cookies.txt \
  -H 'content-type: application/json' -d '{
    "locationId":"<bodega>","itemId":"<cebolla>","tipo":"COMPRA",
    "cantidad":"10","costoTotal":"25.00","purchaseArticleId":"<articulo>",
    "occurredAt":"2026-03-15T00:00:00.000Z","note":null}'
# -> 201 { "id": "..." }   y NADA MAS: el saldo no viaja en una escritura

# 2. Una merma, también en positivo
curl -X POST localhost:3000/inventario/movimientos -b cookies.txt \
  -H 'content-type: application/json' -d '{
    "locationId":"<bodega>","itemId":"<cebolla>","tipo":"MERMA",
    "cantidad":"1.5","costoTotal":null,"purchaseArticleId":null,
    "occurredAt":"2026-03-15T00:00:00.000Z","note":"se pasó"}'

# 3. El saldo: 10 - 1,5 = 8,5
curl 'localhost:3000/inventario/saldos?locationId=<bodega>' -b cookies.txt
# -> [{ "itemId":"...", "nombre":"Cebolla", "unidadDeUso":"kg",
#        "cantidad":"8.500000000000" }]

# 4. Corregir la compra. NO se edita: se inserta la fila que la anula.
curl -X POST localhost:3000/inventario/movimientos/<id-compra>/correccion \
  -b cookies.txt -H 'content-type: application/json' -d '{"note":"otra bodega"}'

# 5. El saldo baja a -1,5 y LAS DOS FILAS SIGUEN AHI
curl 'localhost:3000/inventario/movimientos?locationId=<bodega>' -b cookies.txt
# -> dos movimientos tipo COMPRA, uno +10 y otro -10, el segundo con
#    "corrigeA" apuntando al primero

# 6. Intentar corregir otra vez -> 409, no un 500 del indice unico
curl -X POST localhost:3000/inventario/movimientos/<id-compra>/correccion \
  -b cookies.txt -H 'content-type: application/json' -d '{"note":null}'
```

**Y la comprobación que más importa**, autenticado como `BODEGA`:

```bash
curl 'localhost:3000/inventario/saldos?locationId=<bodega>' -b bodega.txt
# -> 403. Con el saldo despejaria el consumo, y de ahi la receta (CLAUDE.md §4.3)
```

---

## Lo que P6 deja preparado para P7 y P8

| Para | Qué queda listo | Qué falta |
|---|---|---|
| **P7** — conteo físico | El libro contra el que comparar, y el patrón de confidencialidad frente a `BODEGA` ya instalado por endpoint | `period`, y el rechazo de movimientos con fecha en período cerrado (D6). **`occurred_at` ya existe y es la fecha que manda** |
| **P8** — vistas | `compras_mes` y `mermas_ajustes` de SPEC §18 son agregaciones por tipo sobre el libro, y se cancelan solas con las correcciones | **La tabla de unidades vendidas.** P6 registra la *consecuencia* de una venta sobre el stock, no la cifra de ventas: son datos distintos, con períodos distintos |
| **P8** — semáforo de `BODEGA` | Los permisos ya están repartidos para que el semáforo sea el único dato que reciba | El punto de reorden, que sale del consumo teórico de SPEC §18 |
