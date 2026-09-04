# Auditoría de P6 — Inventario: libro mayor append-only

```
AUDITORÍA P6

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30
D. Base de datos     ✅ D1-D14  · EXPLAIN ANALYZE adjunto abajo
E. Reglas de negocio ✅ E1-E23  (E11, E13 y E23 aún no aplican: P8, P7 y P9)
F. Frontend          — no aplica: P6 no toca frontend
G. Pruebas           ✅ G1-G7 · 596 pruebas en verde (383 unitarias + 213 integración)
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

EXPLAIN ANALYZE (1.212.376 movimientos en la tabla, 12.000 en la ubicación):
  saldos (SUM agrupado):  Index Scan usando inventory_movement_company_id_location_id_occurred_at_idx, 93,2 ms
  libro paginado de ítem: Index Scan Backward usando ..._location_id_item_id_occurred__idx, 0,155 ms
  p95 sobre HTTP: 60,8 ms contra 300 de presupuesto
```

Detalle en `evidencia/explain-analyze.txt`.

---

## Los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | **30 reglas sobre 203 archivos.** Dos nuevas (append-only de `inventory_movement`) y **14 archivos más que en P5**: las migraciones, que no se escaneaban desde P0 |
| `audit:arch` | ✅ | 181 módulos, 737 dependencias, cero violaciones |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | Obligó a extraer `anulacionDe` y `comoLote`, y a convertir `registrarEvento` en objeto de parámetros |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11. **M11 falló en la primera ejecución**, como se diseñó: ver abajo |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 383 unitarias (sin base) + 213 de integración |

### M11 hizo su trabajo a la primera

La migración de P6 añade **18 restricciones**. En la primera ejecución de `audit:migrations`:

```
20260904203551_p6_inventario
   [M11] anade restricciones (CHECK o RAISE) y no tiene seccion en
   docs\sistema\guardas-de-dominio.md. Cada restriccion alcanzable desde la API
   necesita una guarda de dominio que la explique, o el error sale como
   INTERNAL_ERROR 500 en vez de 400. Ver docs/incidencias/INC-012
```

M11 nació en P5 de INC-012 y **paró la primera migración a la que se enfrentó**. Las 18 restricciones se clasificaron una a una antes de escribir el primer endpoint. Es la razón por la que INC-012 no reapareció en el paquete donde `ESTADO.md` la daba por segura.

---

## La prueba del guardián

INC-007 exige volver a forzarlo cada vez que cambia el **alcance** de un check. P6 lo cambia en dos sitios: `inventory_movement` entra en `TABLAS_APPEND_ONLY` y hay una migración nueva.

| # | Qué se rompió | Qué falló | Evidencia |
|---|---|---|---|
| 1 | `update`/`deleteMany` sobre `inventoryMovement` en código, y `UPDATE`/`DELETE` sobre `inventory_movement` en la migración | **Las dos reglas nuevas… a la segunda pasada.** La primera falló en 2 sitios de 4 | `guardian-1-append-only.txt` |
| 2 | `GET /saldos` y `/movimientos` pasan a exigir `inventory.write`; el `POST` devuelve el saldo resultante | Las 3 pruebas de confidencialidad frente a `BODEGA` | `guardian-2-confidencialidad-bodega.txt` |
| 3 | La corrección se emite como `AJUSTE` en vez de conservar el tipo | 3 pruebas, y **lo interesante es cuáles NO** | `guardian-3-correccion-de-otro-tipo.txt` |
| 4 | *(no hace falta romper nada: son pruebas permanentes que atacan la fila como la dueña)* | Los 5 `CHECK` y la FK compuesta del signo | `guardian-4-signo-en-la-base.txt` |

### El guardián 1 encontró un fallo de P0

Primera pasada: **2 infracciones cuando debían ser 4.** La regla SQL no disparó porque su glob —`prisma/migrations/**/*.sql`— está anclado a la raíz y las migraciones viven en `apps/api/prisma/migrations/`.

**Desde P0, `no-select-star` y `append-only-sql-audit_log` no habían examinado una sola migración.** Arreglado con una constante compartida; el contador del informe pasó de **189 a 203 archivos**, que es la medida de que el arreglo hizo algo.

Registrado como **INC-007, recurrencia 9**. Lo cazó la regla que dejó escrita la recurrencia 8.

### El guardián 3 es el que más enseña

Al emitir la corrección como `AJUSTE` fallan 3 pruebas de 74. **Siguen en verde**, con R3 rota:

- «el saldo vuelve a cero tras la corrección»
- «reconstruir el libro da la misma proyección» — **el criterio de aceptación de P6**
- las 34 de transferencia, producción y confidencialidad

Porque el saldo cuadra igual: `+10` y `−10` suman cero se llamen como se llamen. Lo que no cuadra es la agregación **por tipo**, de donde sale `compras_del_mes` (SPEC §16): el mes cerraría contando 4 unidades de compras que nadie hizo, sin que ningún saldo se moviera.

**Es la misma forma de fallo que P5 encontró con R7**, y conviene que quede junto a ella: un invariante que se cumple —el saldo— tapando uno que no —el desglose—. El detector no puede ser el número agregado.

---

## Los criterios de aceptación del plan, uno por uno

| Criterio | Cómo se comprueba |
|---|---|
| **No existe `UPDATE` ni `DELETE` sobre la tabla de movimientos, verificado por `audit:forbidden`** | Dos reglas nuevas, guardián forzado y capturado. Y las otras dos capas: privilegio y trigger de sentencia, con sus pruebas en `append-only.spec.ts` |
| **Una transferencia deja el total de la company intacto y cambia los saldos de las dos ubicaciones** | Unitaria: el par suma cero **por construcción** —la entrada es `salida.negated()`—. Integración: `SUM(quantity)` del ítem sigue en 10 tras mover 4 de una ubicación a otra, y los dos saldos son 6 y 4 |
| **El saldo de una ubicación es independiente del de otra (R2)** | Unitaria e integración: comprar en una deja `null` en la otra, no cero |
| **Reconstruir el saldo desde el libro da el mismo número que la proyección** | Se leen los movimientos **crudos** con `pg` —sin pasar por el repositorio, que es la capa que se está verificando—, se pliegan con `proyectarSaldos` del dominio, y se compara con `GET /inventario/saldos`. Hasta el último de los 12 decimales |

### Y lo que el plan no pedía pero R8 sí (E12)

Por cada endpoint de inventario hay prueba de confidencialidad frente a `BODEGA`:

| Endpoint | Qué se comprueba |
|---|---|
| `GET /inventario/saldos` | 403 |
| `GET /inventario/movimientos` | 403 |
| `POST /inventario/producciones` | 403 |
| `POST /inventario/movimientos` | 201 —es su trabajo— **y la respuesta cruda no contiene `cantidad`, `saldo`, `costoTotal`, `consumo` ni `stock`**; sus claves son exactamente `["id"]` |

---

## Sección E — el estado de las catorce reglas

| # | Regla | Estado tras P6 |
|---|---|---|
| E4 | R2 — el inventario no mezcla ubicaciones | ✅ **Nueva en P6** |
| E5 | R3 — no hay `UPDATE`/`DELETE` sobre movimientos | ✅ **Nueva en P6**, tres capas |
| E6 | R3 — el saldo reconstruido coincide con la proyección | ✅ **Nueva en P6** |
| E12 | R8 — confidencialidad frente a `BODEGA` sobre respuesta cruda | ✅ Extendida a los cuatro endpoints de inventario |
| E15 | R10 — el `PRODUCIDO` se costea con su precio de referencia, no con el último lote | ✅ **Nueva en P6** |
| E16 | R10 — el movimiento de producción registra el costo real y su varianza | ✅ **Nueva en P6** |
| E11 | R7 — conciliación con dataset completo | ⬜ P8 |
| E13 | R8 — conteo a ciegas | ⬜ P7 |
| E23 | R2 — el consolidado suma exactamente | ⬜ P9 |

Las demás siguen verdes desde su paquete.

---

## Sección H — dónde quedó cada documento

| # | Documento | Qué se hizo |
|---|---|---|
| H1 | `docs/pasos/P6/CONSTRUCCION.md` | Nuevo |
| H2 | `docs/apis/app-cliente.md` | Sección **Inventario (P6)**: seis endpoints, la tabla de capacidades y el cambio de contrato de `PUT /catalogo/items/:id` |
| H3 | `docs/sistema/FUNCIONAMIENTO.md` | Sección **El libro de inventario**, con su Mermaid |
| H4 | `docs/sistema/modelo-datos.md` | Sección de P6 + las cinco filas nuevas de la tabla de índices |
| H5 | `docs/sistema/configuracion.md` | **— no aplica:** P6 no añade variables de entorno ni configuración. Los parámetros de costeo siguen en `company_settings` (D3) |
| H6 | `docs/decisiones/ADR-009` | Las cinco decisiones que el SPEC no escribe |
| H7 | `docs/runbooks/` | **— no aplica:** P6 no introduce nada operable nuevo. Su migración se despliega por el procedimiento que `despliegue.md` ya describe, y es reversible (`migrate:verify` en verde) |
| H8 | `docs/CHANGELOG.md` | Entrada de P6 |
| H9 | `docs/pruebas/casos-conocidos.md` | **P6 no añade casos, y es correcto:** este archivo verifica fórmulas del Excel, y el libro no calcula ninguna. Lo dicho queda escrito ahí |
| H10 | `docs/incidencias/` | **INC-007 sube a 9** con el caso completo. No hubo ninguna incidencia nueva que registrar |
| H11 | — | La incidencia del paquete **es** una verificación: el glob arreglado hace que dos reglas examinen 14 archivos que no miraban |
| H12 | — | INC-007 tiene su prevención desde el caso 8 (`sin-caracteres-de-control`) y la regla de proceso desde el 3. El caso 9 añade la suya: **vigilar el contador de archivos examinados** |
| H13 | — | Los cuatro guardianes documentan lo construido, con salida literal |
| H14 | Este documento | |

También se actualizó `docs/sistema/seguridad.md` con las tres filas de inventario de la matriz de roles y el porqué de la asimetría de `BODEGA`, y `docs/sistema/guardas-de-dominio.md` con las 18 restricciones nuevas.

---

## Lo que esta auditoría **no** demuestra

Merece escribirse, porque un informe en verde invita a creer más de lo que dice:

1. **La lista de campos prohibidos para `BODEGA` no está demostrada completa.** Se comprueba que los cinco nombres que hoy tienen sentido no aparecen. Cada endpoint nuevo que devuelva algo derivado del libro necesita su propia comprobación: P7 con el conteo y P8 con las vistas.
2. **El saldo no detecta un tipo de movimiento equivocado.** El guardián 3 lo demuestra. Lo que discrimina es la agregación por tipo, y su prueba es una sola.
3. **El presupuesto se midió en esta máquina.** El p95 depende del hardware; lo que no depende es el plan, y por eso hay una prueba que falla ante un `Seq Scan`.
4. **La explosión del consumo no aplica el rendimiento.** Es lo que SPEC §4.3 escribe —`consumo ÷ unidades vendidas` = cantidad de la receta— y está anotado como duda para el usuario en `ESTADO.md`: afecta al stock teórico de P8.
