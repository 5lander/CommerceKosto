# P16-B — Resultado de la auditoría

**Fecha:** 2026-09-12 · **Paquete:** P16-B — API · pricing + recipes/products + costing + concurrencia optimista
**Veredicto:** `npm run audit` **exit 0** sobre el árbol que se commitea, **889 unitarias** y **515 + 5 de integración** en verde, **una migración verificada 4/4**, **doce guardianes** ejecutados (dos de ellos destaparon pruebas que no medían y se rehicieron), bundle de `apps/web` dentro de presupuesto y `npm run bench` ejecutado **sobre el código de este paquete** —que hasta hoy no estaba garantizado: INC-007, caso 12— con el consolidado fuera de límite por la misma deuda abierta de P16-A1.

---

## Los doce checks

| Check | Estado | Evidencia |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api`, la interfaz del back office, `tools` y `apps/web`. Código 0. Paró una vez: `exactOptionalPropertyTypes` en `destinoDeConsulta` (el tipo pasó a `string \| undefined`) |
| `audit:lint` | ✅ | Código 0. Paró en la primera corrida completa: un `number` dentro de un template literal en la prueba de la fila bloqueada (`String(i + 1)`) |
| `audit:forbidden` | ✅ | **46 reglas sobre 477 archivos** (eran 45 / 455). La nueva es `regex-de-numero-solo-en-el-vocabulario`; guardián abajo |
| `audit:arch` | ✅ | **386 módulos, 1712 dependencias**, 0 violaciones (eran 368 / 1608). Sin reglas nuevas: el semáforo compartido vive en `shared/domain` y lo importan `analytics` y `costing` sin depender el uno del otro |
| `audit:deadcode` | ✅ | knip, código 0. Obligó a borrar `menorOIgual` de `apps/web/src/lib/decimales.ts`, que se quedó sin consumidor cuando el color dejó de decidirse en el navegador |
| `audit:complexity` | ✅ | Forzó dos extracciones: `presupuestoDeGuardarReceta` (bench) y `ReemplazarComponentes` con `registrarCambioDeProducto` |
| `audit:duplication` | ✅ | **Found 0 clones.** Paró con el evento `product.updated` repetido en tres casos de uso (→ `registrarCambioDeProducto`) |
| `audit:migrations` | ✅ | M1–M11 · **17 migraciones** reversibles y con RLS (eran 16). Sin tabla nueva (M6 no aplica); sus tres `CHECK` con sección en `guardas-de-dominio.md` (M11) |
| `audit:secrets` | ✅ | Código 0 |
| `audit:deps` | ✅ | Las 4 aceptadas y documentadas. **Sin dependencia nueva** |
| `audit:sec-headers` | ✅ | **19 pruebas** en verde (501 saltadas por `--testNamePattern`, que es como funciona el check). Las cabeceras no se tocaron; el 409 nuevo sale por el mismo `ErrorFilter` |
| `audit:tests` | ✅ | **889 unitarias** con la base apagada (eran 870) + **520 de integración: 515 en verde y 5 saltadas con motivo** (INC-016; eran 460 + 5) en 33 archivos |

```
npm run audit        (costeo-api parado, INC-016)
> audit:types        EXIT 0
> audit:lint         EXIT 0
> audit:forbidden    audit:forbidden  OK — 46 reglas sobre 477 archivos
> audit:arch         ✔ no dependency violations found (386 modules, 1712 dependencies cruised)
                     audit:arch  OK — reglas de capa respetadas y guardian verificado
> audit:deadcode     EXIT 0   (knip: Configuration hints (8), como en P16-A2)
> audit:complexity   EXIT 0
> audit:duplication  Found 0 clones.
> audit:migrations   audit:migrations  OK — 17 migracion(es) reversibles y con RLS
> audit:secrets      EXIT 0
> audit:deps         audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
> audit:sec-headers  Test Files  2 passed | 31 skipped (33) · Tests  19 passed | 501 skipped (520)
> audit:tests        Test Files  65 passed (65) · Tests  889 passed (889)
                     Test Files  33 passed (33) · Tests  515 passed | 5 skipped (520)
                     audit:tests  OK — unitarias (sin base) e integracion en verde
EXIT 0
```

### El guardián de la regla nueva de `audit:forbidden`

`regex-de-numero-solo-en-el-vocabulario` (`tools/audit/rules/core.rules.mjs`) prohíbe `.regex(` en
todo `*.dto.ts`: los números del borde se declaran con `decimales-del-borde.ts`. Sabotaje, captura y
reversión:

```
# añadido a apps/api/src/modules/recipes/infrastructure/http/recetas.dto.ts:
#   export const colada = z.string().regex(/^\d+$/u);
npm run audit:forbidden
FALLO — 1 infraccion(es)
  recetas.dto.ts:138  export const colada = z.string().regex(/^\d+$/u);

# revertido
npm run audit:forbidden
OK — 46 reglas sobre 461 archivos
```

(El recuento de archivos del guardián es el de ese momento de la construcción; el de cierre, arriba.)

### Los guardianes de las 🔴 (INC-007)

Un script muta el código, corre **solo** la prueba afectada (`vitest run --project integration <archivo> -t <patrón>`),
guarda la salida y restaura; el `git diff --stat` de `apps/api/src` es **idéntico antes y después**
(`39 files changed, 1132 insertions(+), 313 deletions(-)` en cada corrida).

| # | Sabotaje | Salida |
|---|---|---|
| G1 | `actualizarItem` sin la versión en el `WHERE` | `× … dos escrituras con la misma versión` · `expected 200 to be 409` · `Tests 1 failed \| 39 skipped` |
| G2 | `subirVersionDeProducto` sin la versión en el `WHERE` | 4 × `expected 200 to be 409` (ubicación, empaque, agregado, componentes) · `Tests 4 failed \| 2 passed \| 18 skipped` |
| G3 | Comprobación de `basadaEn` desactivada | 2 × `expected 201 to be 409` (dos guardados, propagación) |
| G4 | PVP y rendimiento con `decimalNoNegativo` y sin `exigirPositivos` | 2 × `expected 500 to be 400` |
| G5 | Precio con `decimalConSigno` y sin `PrecioNoPositivoError` | `expected [ 500, 500 ] to deeply equal [ 400, 400 ]` |
| G6 | El lote no sube la versión del combo | `expected 1 to be 2` |
| G7 | Presentación con `decimalConSigno` | **`Tests 1 passed`** — no medía la capa del título: `problemaDeConversion` la paraba desde P2 |
| G7′ | Lo mismo + `presentacion_no_positiva` desactivada | `expected 500 to be 400` → la prueba se **retituló** («esquema (P16-B) y dominio (P2) delante del CHECK») |
| G8 | `costoTotal` con `decimalConSigno` | `expected [ 400, 500 ] to deeply equal [ 400, 400 ]` — la `MERMA` daba 500; la `COMPRA` la para `desglosarCompra` |
| G9 | `guardarVersion` sin `bloquearDestino` | `expected [ 201, 201, 201, 201, 201 ] to deeply equal [ 201, 409, 409, 409, 409 ]` |
| G10 | `subirVersionDeProducto` como leer-comparar-escribir, contra la prueba de «diez a la vez» con `Promise.all` | **`Tests 1 passed`** con estados `[200,409,409,409,409,409,409,409,409,409]` — la prueba no producía la carrera |
| G10′ | El mismo sabotaje, contra la prueba rehecha (fila bloqueada + `pg_locks`) | `expected [ 200, 200, 200, 200, 200 ] to deeply equal [ 200, 409, 409, 409, 409 ]` |

**Dos de doce en verde con el sabotaje puesto**, y los dos se trataron como lo que son: pruebas que
afirmaban más de lo que medían. Ninguna llegó al commit con su título original.

---

## La migración, verificada contra bases reales

```
npm run migrate:deploy
17 migrations found in prisma/migrations
No pending migrations to apply.

npm run migrate:verify
[migrate:verify] preparando bases limpias
[migrate:verify] 1/4  ida completa
[migrate:verify] 2/4  escalera: ida y vuelta entera
  OK  el down deshace exactamente lo que hizo el up
[migrate:verify] 3/4  repeticion: up -> down -> up
  OK  up -> down -> up es idempotente
[migrate:verify] 4/4  sin deriva entre las migraciones y schema.prisma
  OK  el esquema aplicado coincide con schema.prisma
  OK  toda tabla tiene ENABLE + FORCE ROW LEVEL SECURITY
[migrate:verify] las migraciones son reversibles, verificado contra bases reales.
```

`20260912191330_p16b_versiones_y_ajustes` — `product.version` e `item.version` con su `CHECK`, la
retirada de `company_settings.iva_compra` (columna, `CHECK` recreado sin ella y semilla), y
`reference_price(company_id, status)` → `(company_id, status, id)`.

**Lo que se escribió a mano, y por qué.** `migrate:new` generó un `down` con `ADD COLUMN iva_compra …
NOT NULL` sin `DEFAULT`, que falla sobre cualquier tabla con filas, y un `up` que al soltar la columna
habría soltado **entero** el `CHECK` de fracciones —PostgreSQL elimina el `CHECK` que nombra una
columna soltada— dejando seis ratios sin restricción y sin aviso. El `up` suelta el `CHECK` a propósito
y lo recrea sin la columna; el `down` añade la columna con `DEFAULT 0.15`, suelta el `DEFAULT` y recrea
el `CHECK` y la función con ella. **Probado sobre la base de desarrollo sembrada** (INC-011): el `down`
se ejecutó dos veces en el paquete, la segunda para plegar el índice en la migración.

---

## Consultas del camino crítico — `EXPLAIN ANALYZE`

Sobre `costeo_bench` (volumen del bench), como `costeo_app` con el tenant fijado. Detalle y discusión
en `CONSTRUCCION.md`.

```
### sugeridos — página a mitad, con cursor · índice de P3 (company_id, status), 120.500 confirmados + 3.000 sugeridos
Index Scan using reference_price_pkey on reference_price  (actual time=0.026..0.038 rows=50.00 loops=1)
  Index Cond: (id > '01a0974f-…'::uuid)
  Filter: ((company_id = '00000001-…'::uuid) AND (status = 'SUGGESTED'::text))
Execution Time: 0.112 ms

### la misma · índice de P16-B (company_id, status, id)
Index Scan using reference_price_company_id_status_id_idx on reference_price  (actual time=0.041..0.052 rows=50.00 loops=1)
  Index Cond: ((company_id = '00000001-…'::uuid) AND (status = 'SUGGESTED'::text) AND (id > '01a0974f-…'::uuid))
Execution Time: 0.176 ms

### ultimaVersion — PUT /recetas, bajo el candado
Sort  Sort Key: created_at DESC, id DESC  Sort Method: top-N heapsort  Memory: 25kB
  ->  Index Scan using recipe_company_id_product_id_location_id_valid_from_idx on recipe  (rows=34.00)
Execution Time: 0.091 ms

### propagacionesDe — GET /recetas/propagacion, 50 de 400
Index Scan using recipe_propagation_company_id_product_id_propagated_at_idx on recipe_propagation  (rows=50.00)
Execution Time: 0.076 ms

### subirVersionDeProducto — UPDATE … WHERE id AND company_id AND version (deshecho con ROLLBACK)
Update on product  ->  Seq Scan on product  (200 filas; Rows Removed by Filter: 199)
Execution Time: 0.424 ms
```

Cada plan lleva el `One-Time Filter: (current_company() = …)` de RLS: se midió como corre, no como
dueño de la tabla.

---

## `npm run bench` — el presupuesto de §5

**Primero, lo que cambió en el propio medidor.** La primera corrida de P16-B reventó con `Cannot read
properties of undefined (reading 'toFixed')`: `scripts/bench.mjs` lanzaba `apps/api/dist/bench.js`
**sin compilarlo**, y el archivo era del 2026-09-10 16:45 (`grep -c ultimaVersionId dist/bench.js` →
`0`). Desde este paquete el script compila la API antes de crear la base; tras la corrida,
`dist/bench.js` es de las 15:27 del 2026-09-12 y contiene `ultimaVersionId`. **INC-007, caso 12.**

Base propia: 200 productos, 700 ítems, 14.000 líneas de receta, 48.000 ventas, 219.000 movimientos.
p95 de 30 corridas.

| Medición | P16-A1 | P16-A2 | **P16-B** | Límite |
|---|---|---|---|---|
| suelo del entorno (validar sesión) | 6,5 ms | 8,1 ms | **10,0 ms** | — |
| costeo de la carta (200 productos, 1.400 líneas) | 89,6 | 120,9 | **87,2** ✅ | 400 |
| inventario valorizado (500 ítems) | 146,2 | 193,9 | **161,0** ✅ | 300 |
| **consolidado de company (10 ubicaciones)** | 940,9 | 944,0 | **919,4** ❌ | 800 |
| guardar una receta (con validación de ciclos) | 87,4 | 95,7 | **83,7** ✅ | 150 |

**Las columnas de P16-A1 y P16-A2 no se pueden atribuir con certeza al código de su commit**: medían el
`dist` que hubiera en disco. La de P16-B sí. Con esa salvedad dicha, **P16-B no empeora nada**: el
costeo de la carta —que ahora calcula el semáforo y une las líneas del desglose— y el guardado de receta
—que ahora toma un candado consultivo y lee la última versión— salen por debajo de la medición anterior.

**Y el consolidado sigue rojo, y el umbral no se sube.** 919,4 ms contra 800. Es la deuda de P16-A1
(vistas materializadas de períodos cerrados, ADR-012 §7), **decisión del usuario**, abierta en
`ESTADO.md` con estos números.

---

## `npm run medir-bundle` — el presupuesto de I9

El paquete toca `apps/web` (`costeo/page.tsx` y `lib/decimales.ts`). Tras `npm run build --workspace @costeo/web` (EXIT 0):

```
  presupuesto: piso 200 KiB · pantalla 350 KiB, en gzip

  ok      126.9 KiB gzip    428.6 KiB bruto  (piso, comun a todas)
  ok      138.4 KiB gzip    463.1 KiB bruto  /costeo
  ok      133.8 KiB gzip    450.0 KiB bruto  /entrar
  ok      138.7 KiB gzip    464.7 KiB bruto  /inventario
  ok      138.6 KiB gzip    463.8 KiB bruto  /menu
  ok      130.8 KiB gzip    443.3 KiB bruto  /
  ok      133.8 KiB gzip    450.2 KiB bruto  /sucursal
  ok      138.4 KiB gzip    463.0 KiB bruto  /ventas

medir-bundle  OK
```

`/costeo` baja 0,3 KiB brutos: se fueron los umbrales y la comparación del navegador.

---

## Checklist manual de `docs/AUDITORIA.md`

| Sección | Comprobado |
|---|---|
| **A · Arquitectura** | **A1**: el dominio nuevo —`shared/domain/indicadores/semaforo.ts`, `shared/domain/errors/conflicto-de-version.ts`, `recipes/domain/componentes-de-combo.ts`, el positivo del lote de precios— no importa framework, ORM ni `process.env`, y sus pruebas corren con la base apagada. **A2**: `PreciosPendientes`, `LeerProducto`, `UbicacionesDeProducto`, `ProductosDeUbicacion`, `LeerComponentes`, `ReemplazarComponentes`, `ListarPropagaciones` reciben puertos por constructor. **A3**: `escribirConVersion` y `bloquearDestino` son infraestructura sin reglas: la decisión 409/404 la toma el caso de uso con la unión `DesenlaceVersionado`. **A5**: `recipes` **no escribe** `item` —el testigo de la receta existe precisamente por eso—, y la bandeja de precios lee nombres por los puertos de `catalog`. **A6**: el motor de costeo recibe el semáforo y el simulador como funciones puras (`semaforoPorBandas`, `ladoDeVenta`) y `casos-conocidos.spec.ts` sigue corriendo sin base. `audit:arch` en verde |
| **B · Código** | **B1–B3** por los checks. **B4–B6**: dos extracciones forzadas por `complexity`. **B7**: `COMPONENTES_MAXIMOS`, `PROPAGACIONES_POR_CONSULTA`, `PENDIENTES_MAXIMOS`/`PENDIENTES_POR_DEFECTO`, `EN_ESPERA`, `ESPERA_MAXIMA_MS`; ningún literal suelto. **B8**: dinero y cantidades como cadena en el borde y `Money`/`Ratio` dentro; la versión es `number` porque es un contador, no una magnitud. **B9**: `ConflictoDeVersionError` (código nuevo en el `Record` exhaustivo), `PrecioNoPositivoError`, `EmpaqueNoEncontradoError`. **B10**: ningún `catch` que trague. **B12**: las cinco consultas crudas a esquema `.strict()`; `version` y `basadaEn` validados en el campo (INC-008) |
| **C · Seguridad** | **C1–C3**: sin tabla nueva; el tenant sigue saliendo de la sesión. **C4 (IDOR)**: ficha, ubicaciones y componentes de un producto de otra company → 404 con el mismo texto; **el 404 se decide antes que el 409** (una versión vieja sobre un producto ajeno no confirma que existe). **C5–C6 (§4.3)**: `BODEGA` no tiene `product.read`, `recipe.read` ni `costing.read`; la carta de una ubicación (que lleva PVP) se prueba sobre respuesta cruda; `costos.lineas` sale `null` sin `recipe.read` (unitaria sobre la serialización). **C4 por ubicación**: `GET /productos/:id/ubicaciones` filtra por alcance y la carta exige la ubicación en alcance (D-16.113). **C7/C15**: el único `$queryRaw` nuevo es el candado, con plantilla etiquetada (parámetros, no concatenación). **C18**: cinco esquemas de consulta más, estrictos. **C24**: DTO explícitos; el 409 lleva `{code, message}` y nada más (prueba). **C28**: `product.updated` gana la versión en su detalle; ningún tipo de evento nuevo. **Sin cambio: C8–C14, C16–C17, C19–C23, C25–C27, C29–C30** |
| **D · Base de datos** | **D1**: una migración, `down` en espejo, `migrate:verify` 4/4, `down` probado sobre base sembrada. **D2**: tres `CHECK` (dos nuevos, uno recreado) con sección en `guardas-de-dominio.md`. **D6–D7**: un índice sustituido con su consulta y su `EXPLAIN` delante; ninguno añadido sin consulta. **D8**: `EXPLAIN ANALYZE` de las cuatro consultas nuevas, arriba. **D9**: sin N+1 — la bandeja son cuatro lecturas fijas en paralelo; los componentes, dos. **D10**: sin `SELECT *`. **D11**: la bandeja pagina **por cursor**; las propagaciones van acotadas a 50. **D13**: sin llamadas externas en transacción; el candado es de transacción y muere con ella. **D14 (M11)**: siete filas de P2–P6 pasan a 🔴 con su prueba citada, dos de ellas **cuarta recurrencia de INC-012**, y una sección nueva para la migración |
| **E · Reglas de negocio** | **R5**: la bandeja no confirma nada; `vigente` usa `precioVigenteA`, la misma función del costeo. **R6/R14**: el simulador usa `ladoDeVenta`, así que la suma de control y la venta neta del PVP simulado salen de la misma fórmula que las reales. **R7**: conciliación en verde. **R9**: sin cambio en ciclos; los componentes de combo no pueden anidar combos. **R11**: propagar y revertir siguen sobrescribiendo con previsualización; ahora pasan por el candado. **R13**: se retira la tarifa de compra por company que D-16.43 dejó sin lector. **R8**: arriba, en C5–C6 |
| **F · Frontend** | Aplica: `costeo/page.tsx` pinta `semaforoFoodCost` y **deja de decidir el color** (se borran los umbrales y la comparación, D-16.3). Ni un token visual nuevo. **I9** en verde. **F7/F9**: sin pantalla nueva; la verificación a 360 px es del armazón |
| **G · Pruebas** | **G1**: 889 + 515 (5 saltadas con motivo). **G2–G3**: +19 unitarias, todas sin base. **G4**: aislamiento entre companies y ubicaciones en verde; el IDOR de las rutas nuevas, probado. **G5**: `BODEGA` sobre respuesta cruda en la carta. **G6**: `casos-conocidos.md` sin cambio — ninguna fórmula tocada. **G7**: datos sintéticos. **INC-007**: doce guardianes, arriba |
| **H · Documentación** | **H1**: `CONSTRUCCION.md` completo. **H2**: `docs/apis/app-cliente.md` con las ocho rutas nuevas, los contratos cambiados (200 `{version}`, `basadaEn`, `GET /recetas` con forma nueva, `vigente`, `semaforoFoodCost`, `lineas`, `?pvp=`, `ivaCompra` fuera de ajustes, los ceros, el empaque 400) y la corrección del parámetro `origen`. **H3**: `FUNCIONAMIENTO.md` con la sección de concurrencia y su `sequenceDiagram`. **H4**: `modelo-datos.md` con el bloque de P16-B, la fila en «Entidades por paquete» y el índice actualizado. **H5**: `configuracion.md` sin cambio: ninguna variable de entorno nueva. **H6**: **ADR-023** con su fila en el índice. **H8**: entrada en `CHANGELOG.md`. **H10–H12**: **INC-012 → 4** e **INC-007 → 12**, con sus secciones y sus filas en el índice, y la prevención automatizada **en este paquete** (regla con guardián; el bench que compila). **H14**: este archivo |
| **I · Optimización** | **I1–I3** por los checks. **I4**: sin abstracción de una sola implementación; `escribirConVersion` tiene dos consumidores (catálogo y recetas). **I6**: los `Promise.all` nuevos son de cardinalidad fija (cuatro y dos). **I8**: bench arriba. **I9**: bundle arriba. **I10**: la optimización medida es un índice que sustituye a otro, con los dos planes delante |

---

## Lo que queda dicho, no escondido

- **La deuda de D-16.20 sigue en `product_location`**: fijar el PVP de un local deja obsoleto el
  formulario del otro. Aceptada por el usuario, con su señal en ADR-023.
- **Artículos y grupos no llevan versión** (D-16.103): un cambio perdido ahí es posible, y es la señal.
- **Los `@Param` siguen sin `ParseUUIDPipe`** —22 hoy, 18 al cerrar P16-A2 por el mismo `grep`—.
  P16-A2 lo mandó a «P16-B/C» y **este paquete no lo pagó**; queda para P16-C.
- **Los números de bench de P16-A1 y P16-A2 medían el `dist` que hubiera en disco.** No se sabe qué
  código midieron; los de P16-B, sí.
- **El consolidado sigue en rojo** (919,4 ms / 800) y **CI no ejecuta el bench**: las dos decisiones
  siguen siendo del usuario.
- **`GET /recetas` cambió de forma** sin versión de API. Hoy no la consume ningún cliente; el día que
  haya uno externo, un cambio así necesita aviso.
