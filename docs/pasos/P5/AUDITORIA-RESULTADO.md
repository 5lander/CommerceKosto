# P5 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-09-04 | Claude Code | `P5: Motor de costeo` |

```
AUDITORÍA P5

A. Arquitectura      ✅ A1-A6  · el motor corre con la base APAGADA
B. Código            ✅ B1-B12 · 0 clones
C. Seguridad         ✅ C1-C30 · E12 activa sobre el costeo, respuesta cruda
D. Base de datos     ✅ D1-D14 · D14 es nueva, y nace de INC-012
E. Reglas de negocio ✅ R6, R10, R12, R14 ACTIVAS · R4 aplicada · R7 por el motor
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 505 pruebas en verde
H. Documentación     ✅ H1-H14 · ADR-008 · INC-012 · **hueco de P3/P4 cerrado**

npm run audit        exit=0, doce checks · 28 reglas de `forbidden`, M1-M11
Pruebas              343 unitarias (base APAGADA) + 162 de integración
Rendimiento          p95 136,8 ms sobre 200 productos y 1.600 líneas (presupuesto 400)
```

---

## Los cinco criterios de aceptación

| Criterio | Dónde | Qué se comprueba |
|---|---|---|
| **Las pruebas del motor corren con PostgreSQL apagado** | `casos-conocidos.spec.ts`, proyecto `unit` | 45 pruebas. El guardián de P0 falla si alguna abre una conexión |
| **Todos los casos de `casos-conocidos.md` dan el resultado del Excel** | Ídem | CC-001, 002, 003 contra `V_COSTEO`; CC-004, 005, 006, 007, 009 y CC-R7 |
| **La suma de control da exactamente 1 (R6)** | Ídem | Y además: es cierta **por construcción**, no por suerte — ver abajo |
| **AP y EP con resultados distintos y ambos correctos (R4)** | CC-004 | `EP 0.461538461538` (el Excel lo tiene) frente a `AP 0.30` (a mano desde §13) |
| **Rendimiento 0 no divide por cero** | CC-009 | Cuatro bordes: porciones 0, factor 0, rendimiento 0 y **PVP ausente** |

---

## Y los siete ítems que `ESTADO.md` dejó escritos para P5

| # | Qué pedía | Estado |
|---|---|---|
| 1 | **R7 da exactamente 0**, como prueba automatizada en cada build | ✅ `0.00` con canario a `1e-6`, **a través del motor** y no con valores transcritos |
| 2 | **R6: `mc% + food_cost% = 1`** | ✅ Cierta por construcción, con prueba de que el complemento no esconde un error |
| 3 | **R14: `venta_neta = pvp / (1 + iva_venta)`** | ✅ Activa. El food cost va sobre venta neta, no sobre PVP |
| 4 | **R12: la merma no se cobra dos veces** | ✅ Activa. Y el combo **no** vuelve a aplicarla: prueba dedicada |
| 5 | **Retirar la lista blanca de knip para `shared/domain/**`** | ✅ **No existía.** Ver la nota de abajo |
| 6 | **`EXPLAIN ANALYZE` con volumen sintético realista** | ✅ p95 136,8 ms · dos planes verificados · prueba que falla ante un `Seq Scan` |
| 7 | **Correr el motor contra CC-001..CC-R7** | ✅ Los nueve casos escribibles hoy. CC-008 es de P8 |

### Sobre el ítem 5, dicho con precisión

**La lista blanca de knip nunca llegó a existir.** El plan la aprobó como deuda con fecha de pago en P5; al construir P0 resultó innecesaria —un export con pruebas no es código muerto para knip— y `ESTADO.md` ya lo anotaba. Se verificó que `knip.json` no la tiene y que `audit:deadcode` pasa sin ninguna excepción para `shared/domain/**`.

No se retiró nada: **no había nada que retirar**, y decirlo así es más útil que apuntarse una tarea cumplida.

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `costing/domain` no importa infraestructura. 172 módulos, 660 dependencias, cero violaciones |
| A2 | ✅ | `CostearCarta` y `CostearUnProducto` no importan NestJS ni Prisma |
| A3 | ✅ | Las tres fórmulas —producto, cascada, combo— son dominio puro |
| A4 | ✅ | Objeto de parámetros por constructor. `costing` **no tiene repositorio propio** |
| A5 | ✅ | `costing` lee el catálogo por `ListarItems`, los precios por `CostosDeItems` y las recetas por `LeerCarta`. **Cero accesos a tablas ajenas** — el diff no tiene un solo `tx.` |
| A6 | ✅ | **343 unitarias con PostgreSQL apagado** |

**El criterio arquitectónico del proyecto entero, comprobado sobre el componente que lo motivaba.** CLAUDE.md §2: «el motor de costeo debe ser ejecutable y probable con la base de datos apagada, alimentado solo con objetos en memoria». Las 45 pruebas del motor lo son.

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B1–B3 | ✅ | Sin `any`, sin `@ts-ignore`, sin `eslint-disable`. 28 reglas de `audit:forbidden` |
| B4 | ✅ | Ninguna función pasa de 40 líneas ni de 3 parámetros. Las que crecieron se partieron |
| B8 | ✅ | Tipos de dominio: `Money`, `Ratio`, `Count`. **Ningún decimal viaja como `number`** |
| B9 | ✅ | `CicloEnCascadaError` e `ItemFueraDelCatalogoError` extienden `ErrorDeDominio` — la lección de P4 aplicada desde el principio |
| B12 | ✅ | **0 clones.** Tres se encontraron y se resolvieron dando nombre a la forma repetida, no copiando menos |

**La decisión de forma que más peso tiene**: el lado de venta es una **unión** (`Vendible | SinPrecio`), no un objeto con campos anulables. Con anulables, quien consume puede olvidarse de mirar uno; con la unión, no compila hasta que decide.

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1–C3 | ✅ | P5 no crea tablas. La columna nueva hereda el RLS de `product` |
| C4–C6 | ✅ | Todo por `TenantTransaction`. `costing` no toca la base en absoluto |
| C8 | ✅ | Los parámetros de consulta de `/costeo` pasan por esquema, igual que un cuerpo |
| C24 | ✅ | Escalada horizontal: `GERENTE_LOCAL` costea su ubicación y recibe **403** sobre otra |
| **E12** | ✅ **activa** | **`BODEGA` no tiene `costing.read`**. 403 en las dos rutas, y sobre la **respuesta cruda** no aparece `costoTotalUnidad`, `foodCostPct`, `margenContribucion`, `costoPorPorcion` ni `costoNetoLote` |

**La clave foránea del empaque es compuesta** contra `item(id, company_id)`. Sin la segunda columna, una fila podría apuntar al ítem de otro tenant: **RLS filtra lo que se lee, no lo que se referencia.**

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | `migrate:verify` en verde con sus cuatro pasos, sobre bases limpias |
| D3 | ✅ | FK compuesta `product(packaging_item_id, company_id)` → `item(id, company_id)` |
| D7 | ✅ | Índice nuevo **con su consulta delante**, y con su plan verificado |
| D9 | ✅ | **Sin N+1, y es el punto del paquete.** Ocho consultas fijas, no dependen del tamaño de la carta |
| D10 | ✅ | Sin `SELECT *` |
| D12 | ✅ | El filtro de estado va en el `WHERE`; **cuál precio está vigente lo decide el dominio** (R5), no un `DISTINCT ON` |
| **D14** | ✅ **nueva** | **Nace de INC-012.** `docs/sistema/guardas-de-dominio.md` con las restricciones de P0–P5, y M11 que exige la sección |

### `EXPLAIN ANALYZE`, con volumen y no con veinte filas

```
Bitmap Index Scan on recipe_por_ubicacion_y_vigencia (actual time=0.024..0.025 rows=200)
  Buffers: shared hit=1                                    Execution Time: 0.340 ms

Bitmap Index Scan on reference_price_company_id_status_idx (actual time=0.025 rows=300)
  Buffers: shared hit=2                                    Execution Time: 0.302 ms
```

Plan completo en `evidencia/explain-analyze.txt`. **Y hay una prueba que falla si aparece un `Seq Scan`**: el tiempo depende de la máquina, el plan no.

---

## E. Reglas de negocio

| # | Resultado | Evidencia |
|---|---|---|
| **R6** | ✅ **activa** | Cierta por construcción. Y probada con la identidad de importes, que **sí** se puede romper |
| **R10** | ✅ **activa** | La cascada usa precios de referencia, no lotes. Razonado en ADR-008 |
| **R12** | ✅ **activa** | El combo no vuelve a aplicar la merma. Prueba dedicada |
| **R14** | ✅ **activa** | `venta_neta = pvp / (1 + iva_venta)`, sobre la que se calcula el food cost |
| **R4** | ✅ aplicada | CC-004: `0.461538461538` frente a `0.30`. Distintos y ambos correctos |
| **R13** | ✅ | CC-007: cambian **3 de 11 ítems**, y el empaque cambia igual que un ítem |
| **R5 / E8** | ✅ | Costear con fecha del mes pasado usa el precio de entonces. Probado de punta a punta |
| **R7** | ✅ · con matiz | `0.00` y canario. **Pero ver abajo: R7 no detecta un costo equivocado** |

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | **505 en verde** |
| G2 | ✅ | 343 unitarias con la base apagada |
| G5 | ✅ | Cinco guardianes forzados y capturados. Ver abajo |
| G7 | ✅ | Cero datos reales de clientes. El Excel no está versionado |

### Los cinco guardianes de P5

| # | Sabotaje | Qué debe pasar | Qué pasó |
|---|---|---|---|
| 1 | **R4 invertida** (`EP` ↔ `AP`) | Fallan los casos del Excel | ✅ 12 pruebas en rojo. **Y CC-R7 sigue en verde** |
| 2 | **Cascada sin memorizar** | El rombo de 25 niveles no termina | ✅ `EXIT=124` a los 120 s. Con memorización, 1,5 s |
| 3 | **Sin provisión de merma** | R7 se rompe | ✅ 11 pruebas en rojo, R7 con `6.23` |
| 4 | **M11 sin el documento** | `audit:migrations` falla | ✅ 5 migraciones marcadas |
| 5 | **Un retroceso en una regex** | `audit:forbidden` falla | ✅ Señala archivo, línea y columna |

Las salidas literales están en `evidencia/`.

### El hallazgo del guardián 1, que merece su propio apartado

**Con R4 invertida fallan 12 pruebas, y ninguna es CC-R7.** La conciliación sigue dando `0.00` con el motor calculando mal el costo de cada línea.

No es un fallo de la prueba: es lo que R7 **es**. Su identidad —`costo_ventas_teorico == venta_neta_mes − mc_mes`— se sostiene cualquiera que sea el costo, porque el costo aparece en los dos lados.

**R7 detecta deriva aritmética y términos que faltan** (el guardián 3 lo confirma). **No detecta un costo equivocado.** Lo que caza un costo equivocado son los casos conocidos, y por eso sus valores esperados tienen que salir del Excel y no de este código.

**Consecuencia para P8**, donde R7 corre con el dataset completo: una R7 verde no es evidencia de que el motor esté bien. Es evidencia de que las escalas aguantan.

### Dos pruebas que valen por lo que evitan

**El rombo de 25 niveles** (`4026531.84`). Sin memorización serían 2³⁰ visitas y la suite no termina — comprobado, no supuesto. Y no se conforma con terminar: exige el número exacto, porque un recorrido que se saltara ramas terminaría igual de rápido y daría otro.

**CC-005 parte A.** La cascada tiene que reproducir el `0.20` que el Excel tenía **escrito a mano**, y con él CC-002 entero sigue cuadrando. Es la prueba de que cambiar de dónde sale un número no cambió el número.

---

## H. Documentación

| # | Resultado |
|---|---|
| H1 | `CONSTRUCCION.md` y este documento |
| H2 | **ADR-008** — el empaque, la precedencia de la cascada y el combo, con lo que cada decisión cuesta |
| H3 | **INC-012** nueva, con prevención automatizada (M11) · **INC-007** sube a 8 con prevención que ataca la causa |
| **H4** | ⚠️ **Se encontró un hueco de dos paquetes, y se cerró.** `docs/apis/app-cliente.md` y `docs/sistema/modelo-datos.md` no tenían ni una línea de P3 ni de P4. Los tres tramos —P3, P4 y P5— se escribieron en este commit |
| H5–H7 | `guardas-de-dominio.md` nuevo · CHANGELOG · ESTADO |

**Sobre H4, sin adornos:** P3 y P4 marcaron H4 en verde sin estarlo. No es una omisión menor: `docs/apis/` es la superficie que un frontend va a leer en P12, y el modelo de datos es lo que alguien consulta antes de escribir una migración. Documentar solo P5 sobre ese hueco habría sido peor que el hueco.

---

## Veredicto

**P5 cierra.** El motor de costeo existe, es dominio puro, corre con la base apagada y reproduce los números que el Excel ya tenía calculados — incluidos los que antes estaban escritos a mano.

**Lo que P5 deja instalado para P6 y P8:**

- El costo por unidad de uso de todo ítem a una fecha, con cascada.
- El costeo completo de un producto y de una carta, dentro del presupuesto y con el plan verificado.
- `guardas-de-dominio.md` y M11, justo antes del paquete donde el libro append-only es trigger puro.
- Y la advertencia sobre R7, que P8 necesita saber antes de apoyarse en ella.

**Lo que P5 no resuelve y hay que decir:** el rendimiento por lote de una subpreparación no existe, las recetas de preparaciones se expresan por unidad de uso, y eso es incómodo de capturar. Merece confirmación del usuario antes de P6.
