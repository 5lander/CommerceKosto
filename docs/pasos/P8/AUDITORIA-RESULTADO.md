# Auditoría de P8 — Vistas analíticas

```
AUDITORÍA P8

A. Arquitectura      ✅ A1-A6   · `analytics` no consulta ninguna tabla ajena
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30  · §4.3 extendida a las seis vistas
D. Base de datos     ✅ D1-D14
E. Reglas de negocio ✅ E1-E23  · **E11 (R7) cerrada con dataset completo**
F. Frontend          — no aplica: P8 no toca frontend
G. Pruebas           ✅ G1-G7 · 702 pruebas en verde (442 unitarias + 260 integración)
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10
```

---

## Los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | 30 reglas sobre **251 archivos** (228 en P7) |
| `audit:arch` | ✅ | 222 módulos, 973 dependencias. **Paró un ciclo real**: ver abajo |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | Obligó a partir `componer` en tres y a objetos de parámetros en los dos controladores |
| `audit:duplication` | ✅ | **0 clones.** Cazó cuatro, incluida la cuarta repetición del bloque de auditoría |
| `audit:migrations` | ✅ | M1–M11. **M11 paró la migración por tercera vez consecutiva** |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 442 unitarias (sin base) + 260 de integración |

### `audit:arch` paró un ciclo que no era teórico

```
error sin-dependencias-circulares:
  analytics/application/casos-de-uso/contexto.ts →
  analytics/application/casos-de-uso/vistas.ts →
  analytics/application/casos-de-uso/contexto.ts
```

`contexto` usaba `totalesDeLaCarta` de `vistas`, y `vistas` usaba `contexto`. Se rompió moviendo lo compartido al archivo de abajo. Y el ciclo **entre módulos** que no llegó a existir —`analytics` necesita el libro y el conteo— se evitó pidiéndolos por dos casos de uso que `inventory` expone, en vez de consultar sus tablas.

### M11, por tercera vez

La migración de P8 añade seis restricciones y dos índices únicos. M11 la paró antes del primer endpoint, y la clasificación dio **dos 🔴**: los dos índices únicos, que sin guarda habrían subido como `23505` → 500. Es la vía por la que INC-012 se cuela cuando ya no quedan `CHECK` alcanzables.

---

## La prueba del guardián

| # | Qué se rompió | Qué falló | Evidencia |
|---|---|---|---|
| 1 | El consumo deja de dividirse por el rendimiento por lote *(volver al código de P6)* | **1 prueba de 702** | `guardian-1-el-rendimiento-por-lote.txt` |
| 2 | El índice de popularidad se calcula desde `popularidad` *(la fórmula literal del SPEC)* | La del criterio de aceptación: `0.999999999999` | `guardian-2-el-indice-exactamente-uno.txt` |
| 3 | `CONSUMO_POR_VENTA` entra en los agregados del libro | El invariante del stock teórico: 40 donde había 70 | `guardian-3-el-consumo-contado-dos-veces.txt` |
| 4 | La vista de inventario baja a `replenishment.read`, y el semáforo gana un campo | Las 2 de confidencialidad frente a `BODEGA` | `guardian-4-confidencialidad-frente-a-bodega.txt` |

### El guardián 1 es el hallazgo del paquete

Volver al código de P6 —quitar la división por `rendimiento_porciones`— deja **442 pruebas unitarias en verde, 246 de integración de P0–P7 en verde, y falla UNA sola** de las ~700 del proyecto.

Esa prueba detecta que el consumo teórico, y con él lo que el libro descuenta del inventario, es **el doble** de lo que debería. Y no sobre un caso rebuscado: sobre un producto que rinde 2 porciones por lote, que es la mitad de la carta de cualquier restaurante.

**El fallo llevaba dos paquetes en el código con 596 pruebas en verde encima.** Lo encontró R7, que es exactamente para lo que CLAUDE.md §6 la exige: «es la mejor defensa contra un motor de costeo silenciosamente roto».

Y lo que R7 **no** detecta sigue siendo lo de siempre, y hay una prueba unitaria que lo enseña: un consumo teórico equivocado *en los dos lados* deja la conciliación en cero. R7 caza componentes que se cuentan en un lado y no en el otro. El rendimiento por lote era exactamente eso.

---

## Los criterios de aceptación del plan, uno por uno

| Criterio | Cómo se comprueba |
|---|---|
| **La conciliación da exactamente 0 con un dataset completo, como prueba automatizada que corre en cada build (R7)** | Dos pruebas de integración, de punta a punta y con números seguibles a mano: una con rendimiento 1 y otra con **rendimiento 2**, que es la que destapó el fallo de P6. Los dos caminos —consumo + empaque + provisión, y venta neta − margen— pasan por el sistema entero: catálogo, precios, receta, motor de costeo y ventas del mes |
| **Un producto con índice de popularidad exactamente 1 cae en el cuadrante correcto de forma determinista** | Unitaria y de integración. 210 unidades de 900 con tres productos activos y la regla en 0.70 dan **`1` exacto**, y el cuadrante es `ESTRELLA`. El determinismo lo da la aritmética decimal; el «cuadrante correcto», no redondear por el camino |
| **Cada endpoint tiene su test de confidencialidad frente a `BODEGA` (R8)** | 403 en las cinco vistas —una prueba por endpoint, con `it.each`— más 403 en la carga de ventas, más la comprobación sobre la **respuesta cruda** del semáforo: seis cadenas prohibidas que no aparecen, y `semaforo` que sí |

### Lo que el plan no pedía y salió

**El invariante del doble conteo.** El stock teórico da lo mismo esté o no registrado el consumo por venta en el libro. Es una propiedad, no un caso, y protege contra las dos configuraciones que un cliente real puede tener: el que integra su punto de venta y descuenta cada plato, y el que solo carga la cifra del mes.

---

## Sección E — el estado de las reglas

| # | Regla | Estado tras P8 |
|---|---|---|
| **E11** | **R7 — conciliación con dataset completo** | ✅ **Cerrada en P8.** Era el último criterio pendiente desde P0 |
| E12 | R8 — confidencialidad sobre respuesta cruda | ✅ Extendida a los siete endpoints de analítica |
| E15 | R10 — el `PRODUCIDO` al precio de referencia | ✅ Intacta |
| E23 | R2 — el consolidado suma exactamente | ⬜ P9 |

Las catorce reglas de CLAUDE.md §6 tienen ahora prueba automatizada, salvo la parte de R2 que corresponde al consolidado de P9.

---

## Sección H — dónde quedó cada documento

| # | Documento | Qué se hizo |
|---|---|---|
| H1 | `docs/pasos/P8/CONSTRUCCION.md` | Nuevo |
| H2 | `docs/apis/app-cliente.md` | Sección **Analítica (P8)**: nueve endpoints y la tabla de permisos |
| H3 | `docs/sistema/FUNCIONAMIENTO.md` | Sección **Las seis vistas**, con su Mermaid |
| H4 | `docs/sistema/modelo-datos.md` | Sección de P8 con su diagrama y las filas nuevas de índices |
| H5 | `docs/sistema/configuracion.md` | **— no aplica:** P8 no añade configuración. Usa los parámetros de D3 que ya viven en `company_settings` |
| H6 | `docs/decisiones/ADR-011` | Las siete decisiones, empezando por la corrección de P6 |
| H7 | `docs/runbooks/` | **— no aplica:** P8 no introduce nada operable nuevo |
| H8 | `docs/CHANGELOG.md` | Entrada de P8 |
| H9 | `docs/pruebas/casos-conocidos.md` | **CC-R7 sube al nivel que le faltaba**: dataset completo, a través del sistema entero. CC-008 (menu engineering con índice 1) **se cierra** |
| H10 | `docs/incidencias/` | **Ninguna ficha nueva.** El fallo del rendimiento no es una incidencia sino un defecto de diseño, y su sitio es el ADR — pero la lección sí entra en el índice, en «áreas frecuentes» |
| H11 | — | La prevención del fallo **es** la prueba de R7 con rendimiento ≠ 1, que ahora corre en cada build |
| H12 | — | INC-007 no reapareció. INC-012 tampoco: M11 volvió a pararlo |
| H13 | — | Los cuatro guardianes, con salida literal |
| H14 | Este documento | |

También se actualizó `docs/sistema/guardas-de-dominio.md` con las restricciones nuevas y `docs/sistema/seguridad.md` con las filas de analítica.

---

## Lo que esta auditoría **no** demuestra

1. **Las vistas no están contrastadas contra el Excel celda a celda.** La aritmética se prueba con casos calculados a mano y R7 cierra sobre el sistema entero, pero el Excel **no tiene dimensión temporal** (SPEC §3): no hay una hoja «V_FOOD_COST_REAL de marzo» contra la que comparar. Lo que sí sale del Excel son los nueve casos conocidos del motor de costeo, que P8 no toca.
2. **El presupuesto de rendimiento de las vistas no se midió.** CLAUDE.md §5 fija 400 ms para el costeo de 200 productos y 800 ms para el consolidado de P9; las vistas de P8 se apoyan en el primero, ya medido en P5, pero **el coste de armar el contexto —cinco consultas más el costeo— no tiene medición propia**. Es lo primero que P9 debería medir, porque el consolidado lo multiplica por el número de ubicaciones.
3. **El rendimiento del ÍTEM sigue sin confirmarse contra el Excel**, y ahora importa más: afecta al `consumo_teorico` que P8 ya publica. Es la duda abierta desde P6, y P8 la deja igual de abierta pero con más consecuencias.
4. **Nadie ha leído todavía un evento de `audit_log`** — P8 añade dos tipos más al catálogo y sigue sin haber rol que pueda hacer `SELECT`. Pendiente de P11, sin cambios desde P7.
