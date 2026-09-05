# P8 — Vistas analíticas

> **Objetivo del plan.** «Las seis vistas del Excel, por ubicación.»

| | |
|---|---|
| **Fecha** | 2026-09-04 |
| **Commit** | `P8: Vistas analíticas` |
| **Migración** | `20260904235107_p8_ventas_y_costos_fijos` |
| **Pruebas** | 442 unitarias (con la base apagada) + 260 de integración |

---

## Lo que se construyó

| # | Entregable del plan | Dónde |
|---|---|---|
| 1 | Food cost real y varianza (SPEC §16), **incluida la conciliación R7** | `domain/food-cost-real.ts` |
| 2 | Menu engineering Kasavana-Smith con los cuatro cuadrantes (SPEC §15) | `domain/menu-engineering.ts` |
| 3 | Punto de equilibrio, prime cost y margen de seguridad (SPEC §17), con **clasificación explícita** | `domain/punto-de-equilibrio.ts` + `fixed_cost` |
| 4 | Inventario valorizado con estados y días de cobertura (SPEC §18) | `domain/inventario-valorizado.ts` |
| 5 | Resumen gerencial | `domain/resumen.ts` |
| 6 | Proyecciones por rol: `BODEGA` solo recibe el semáforo | tres controladores, tres permisos |

Y cuatro cosas que el plan no listaba pero que el paquete necesitaba:

| | |
|---|---|
| 7 | **`product_sales`**: las unidades vendidas, que faltaban desde P6 y de las que dependen tres de las seis vistas |
| 8 | **`fixed_cost`** (T6) con su catálogo de clasificación — el campo que SPEC §17 pide por su nombre |
| 9 | **La corrección del consumo teórico**, que R7 destapó. Ver abajo |
| 10 | **`registrarEventoDeUsuario`** en `shared/application`: la cuarta repetición del mismo bloque de auditoría, que `audit:duplication` cazó |

---

## Lo que P8 encontró y no esperaba

### 1. R7 destapó un fallo que llevaba dos paquetes en el código

**La receta es del LOTE; la venta, de PORCIONES.** SPEC §14 lo dice al definir el costo —`costo_por_porcion = costo_neto_lote / rendimiento_porciones`— así que vender 100 porciones de un producto que rinde 2 consume **50** lotes, no 100.

P6 multiplicaba por las unidades sin dividir. Con un rendimiento de 4, cada venta sacaba del inventario **cuatro veces** lo que sale de la bodega.

**Ninguna de las 596 pruebas de P0–P6 lo vio**, y el motivo es simple: `rendimiento_porciones = 1` es el único valor con el que multiplicar y dividir dan lo mismo, y todos los productos de prueba lo tenían en 1.

Lo encontró la conciliación de SPEC §16, que es una identidad entre dos caminos: uno pasa por la explosión de la receta y el otro por `costo_por_porcion`. Con rendimiento 1 coinciden aunque uno esté mal. Con rendimiento 2, la conciliación daba **98,00** sobre un caso de 102 dólares.

**Es la primera vez que R7 demuestra para qué existe**, y está razonado en **ADR-011 §1**. La corrección vive en `totalConsumido`, que es el punto único que P6 y P8 comparten: dos implementaciones habrían dejado el libro descontando una cantidad y la vista mostrando otra.

### 2. El índice «exactamente 1» no salía exacto

El criterio de aceptación del paquete pide que «un producto con índice de popularidad exactamente 1 caiga en el cuadrante correcto de forma determinista». Escribiendo la fórmula del SPEC tal cual —tres operaciones encadenadas, cada una redondeando a escala 12— ese producto daba **`0.999999999999`** y caía en `CABALLO` en vez de `ESTRELLA`.

No es un error de presentación: es una recomendación de negocio invertida —de «mantenlo, sostiene la carta» a «rediseñalo, tiene poco margen»— por un residuo en el decimal doce.

Se arregla reordenando los factores para que haya **una sola división**: `(210 × 3) / (900 × 0.7) = 630/630 = 1`. La lo cazó la propia prueba del criterio de aceptación, la primera vez que se ejecutó.

### 3. El consumo se podía contar dos veces

El Excel no tiene movimientos de consumo: lo calcula desde la receta. Este sistema **sí puede tenerlos** (P6, `POST /inventario/consumos`), y son el mismo consumo por el mismo camino.

Traducir SPEC §18 literalmente —sumar los movimientos del libro *y* restar el consumo teórico— descontaba el consumo dos veces: 40 kg de stock teórico donde había 70. Un número perfectamente creíble que dice que falta mercancía que está en la estantería.

Se resuelve excluyendo `CONSUMO_POR_VENTA` de los agregados, y el invariante que lo fija es una prueba: **el stock teórico da lo mismo esté o no registrado el consumo por venta.**

### 4. Dos ciclos que `audit:arch` paró en seco

`contexto.ts` ↔ `vistas.ts`: el contexto usaba `totalesDeLaCarta` y las vistas usaban el contexto. `dependency-cruiser` lo rechazó, y con razón — un ciclo hace imposible razonar sobre el orden de inicialización. Se rompió moviendo lo común al archivo de abajo.

Y el ciclo que **no** llegó a existir: `analytics` necesita el libro y el conteo, y en vez de consultar `inventory_movement` los pide por dos casos de uso que `inventory` expone en `para-analitica.ts`. La flecha va en un solo sentido, como en todo el sistema.

### 5. La cuarta repetición del bloque de auditoría

`audit:duplication` cazó el mismo `auditoria.record({outcome: 'success', actorType: 'USER', ...})` en `periods`, en dos sitios de `inventory` y en `analytics`. Es el umbral de `OPTIMIZACION.md` §1 —la tercera repetición—, así que se extrajo a `shared/application/eventos-de-usuario.ts`.

No recibe la sesión sino sus dos identificadores: `SesionActiva` es un tipo de `iam`, y que `shared` dependiera de un módulo de negocio invertiría la dirección de las dependencias por una comodidad de firma.

---

## Prueba manual

Con `docker compose up -d db pgbouncer` y `npm run dev`, autenticado como `ADMIN`:

```bash
# 1. Las unidades vendidas del mes, EN LOTE (es lo que hace posible la grilla)
curl -X POST localhost:3000/analitica/ventas -b cookies.txt \
  -H 'content-type: application/json' -d '{
    "locationId":"<local>","anio":2026,"mes":3,
    "ventas":[{"productId":"<empanada>","unidades":"320"}]}'

# 2. T6: los costos del mes, con su CLASIFICACION (no por el texto)
curl -X POST localhost:3000/analitica/costos-fijos -b cookies.txt \
  -H 'content-type: application/json' -d '{
    "locationId":"<local>","anio":2026,"mes":3,
    "costos":[
      {"concepto":"Nomina","clasificacion":"MANO_DE_OBRA","importe":"3000.00"},
      {"concepto":"Arriendo","clasificacion":"OTRO_FIJO","importe":"1200.00"},
      {"concepto":"Comision tarjeta","clasificacion":"VARIABLE","importe":"0.03"}]}'

# 3. R7 — la conciliacion TIENE que dar cero
curl 'localhost:3000/analitica/food-cost-real?locationId=<local>&anio=2026&mes=3' \
  -b cookies.txt
# -> { ..., "diferenciaConciliacion": "0.00" }

# 4. Los cuatro cuadrantes
curl 'localhost:3000/analitica/menu-engineering?locationId=<local>&anio=2026&mes=3' \
  -b cookies.txt

# 5. El resumen gerencial, con sus semaforos
curl 'localhost:3000/analitica/resumen?locationId=<local>&anio=2026&mes=3' -b cookies.txt
```

**Y las dos comprobaciones que más importan**, autenticado como `BODEGA`:

```bash
curl 'localhost:3000/analitica/inventario?locationId=<local>&anio=2026&mes=3' -b bodega.txt
# -> 403. Lleva stock teorico y consumo, de donde se despeja la receta (§4.3)

curl 'localhost:3000/analitica/reposicion?locationId=<local>&anio=2026&mes=3' -b bodega.txt
# -> 200 [{ "itemId":"...", "nombre":"Cebolla", "semaforo":"REPONER" }]
#    Tres campos, y NINGUNO es una cantidad (SPEC §4)
```

---

## Lo que P8 deja preparado para P9 y P10

| Para | Qué queda listo | Qué falta |
|---|---|---|
| **P9** — consolidado | Las seis vistas se calculan sobre un contexto único por (ubicación, mes). Agregarlas es sumar, no recalcular | Exponer el **estado del período** por ubicación: el consolidado puede sumar meses cerrados con meses abiertos |
| **P9** — comparativa | `product_sales` cuelga del maestro `product`, así que comparar el mismo plato entre locales es un `GROUP BY product_id` | La vista en sí |
| **P10** — importación | `POST /analitica/ventas` ya recibe un lote, que es lo que D9 pide: «sin importar si viene de digitación, importación o un sistema externo» | El parser, la previsualización y la deduplicación |
| **P12** — la grilla | El endpoint es de reemplazo y el mes anterior se lee con un `GET`: es exactamente lo que «una grilla con el período anterior precargado» necesita | La pantalla |
