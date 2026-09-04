# Auditoría de P7 — Períodos y conteo físico

```
AUDITORÍA P7

A. Arquitectura      ✅ A1-A6   · módulo `periods` sin dependencias de negocio
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30  · §4.3 extendida al conteo, por endpoint
D. Base de datos     ✅ D1-D14  · EXPLAIN ANALYZE adjunto abajo
E. Reglas de negocio ✅ E1-E23  (E11 y E23 aún no aplican: P8 y P9)
F. Frontend          — no aplica: P7 no toca frontend
G. Pruebas           ✅ G1-G7 · 659 pruebas en verde (413 unitarias + 246 integración)
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

EXPLAIN ANALYZE (240.000 movimientos, 240 períodos cerrados, 500 líneas de conteo):
  saldo hasta el corte:      Index Scan usando ..._company_id_location_id_occurred_at_idx, 5,66 ms
  guarda del mes cerrado:    Index Scan usando period_company_id_location_id_starts_at_idx, 0,096 ms
  conciliación congelada:    Bitmap Index Scan sobre ..._company_id_count_id_idx, 0,165 ms

p95 sobre HTTP:
  GET  /conteos/:id              88,4 ms  contra 300 de presupuesto
  POST /inventario/movimientos   52,3 ms  con 240 períodos cerrados en la tabla
```

Detalle en `evidencia/explain-analyze.txt`.

---

## Los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | 30 reglas sobre **228 archivos** (203 en P6). **Ninguna regla nueva**, y está razonado abajo |
| `audit:arch` | ✅ | 202 módulos, 841 dependencias, cero violaciones. `periods` no importa ningún módulo de negocio |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca. Cazó un `MES` exportado y sin uso |
| `audit:complexity` | ✅ | Obligó a objetos de parámetros en `Periodo` y `EscriturasDeConteo`, y a extraer `comoSeLlama` |
| `audit:duplication` | ✅ | **0 clones.** Cazó las tres búsquedas de período, que eran la misma consulta con otro filtro |
| `audit:migrations` | ✅ | M1–M11. **M11 volvió a parar la primera ejecución**, como en P6 |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 413 unitarias (sin base) + 246 de integración |

### Por qué P7 **no** añade ninguna regla a `audit:forbidden`

La regla de oro del índice de incidencias dice que lo automatizable se automatiza. Se buscó qué automatizar y la respuesta honesta es que la garantía de P7 ya está en la base, no en el escáner:

- **«Toda escritura del libro llama a la guarda»** no es expresable como patrón prohibido: el escáner busca lo que *no* debe aparecer, y esto es «A sin B». Lo que sí lo cubre es el **trigger**, que alcanza incluso a la escritura que alguien olvide instrumentar — y hay una prueba que inserta directamente en la tabla para medirlo.
- **La convención de fechas a las `12:00Z`** (INC-013) no se puede automatizar sin falsos positivos: hay `T00:00:00Z` legítimos en el repositorio. Escribir una regla ruidosa que se desactivaría en una semana es peor que no escribirla.

Lo que sí se movió es el **contador de archivos**: 203 → 228. Cuando el alcance de un check cambia, ese número tiene que moverse; si no se mueve, no cambió (INC-007, caso 9).

### M11 volvió a hacer su trabajo

La migración de P7 añade **20 restricciones y tres triggers**. En la primera ejecución:

```
20260904223303_p7_periodos_y_conteo
   [M11] anade restricciones (CHECK o RAISE) y no tiene seccion en
   docs\sistema\guardas-de-dominio.md. ...
```

Las 20 se clasificaron una a una **antes del primer endpoint**. Resultado: **cuatro 🔴**, y tres de ellas son triggers que una petición corriente alcanza —cerrar el mes y seguir comprando es lo que va a pasar todos los meses—. Es lo contrario de P6, donde los triggers quedaron ⚪ por inalcanzables. Ninguna llegó a producir un 500 en ninguna prueba.

---

## La prueba del guardián

| # | Qué se rompió | Qué falló | Evidencia |
|---|---|---|---|
| 1 | Se retiró la sección de P7 de `guardas-de-dominio.md` | **M11**, igual que en la primera ejecución real | `guardian-1-m11-guardas-de-dominio.txt` |
| 2 | `exigirLibroEscribible` deja de llamar a la guarda del período | 6 pruebas, y **todas con 500 donde esperaban 409** | `guardian-2-la-guarda-frente-al-trigger.txt` |
| 3 | Un ítem sin contar vale **cero** en el inventario físico | 3 de 659, y **lo interesante es cuáles no** | `guardian-3-el-item-que-nadie-conto.txt` |
| 4 | `count.read` → `count.write` en la conciliación, y los valores en el DTO básico | Las 2 de confidencialidad frente a `BODEGA` | `guardian-4-confidencialidad-frente-a-bodega.txt` |

### El guardián 2 demuestra lo contrario de lo que parece

Con la guarda retirada **ningún movimiento entró** en un mes cerrado: el trigger los rechazó todos. La integridad no dependía de la guarda. Lo que cambió fue el **código de respuesta**: 500 en vez de 409, que es INC-012 en vivo.

```
el trigger    GARANTIZA — cubre las cinco escrituras y la sexta que alguien
              escriba mañana sin acordarse de llamar a nada
la guarda     EXPLICA   — convierte un P0001 del driver en un 409 con un
                          mensaje que dice cómo seguir
```

Y una prueba pasó igualmente: la que inserta directamente en la tabla. Esa mide la garantía; las otras seis miden la explicación.

### El guardián 3 es el que más enseña

Valorar en cero lo que nadie contó rompe **3 pruebas de 659**. Siguen en verde:

- la diferencia por línea y su valorización
- **la cobertura, que sigue diciendo `0.500000000000`**
- el cierre del mes, la reapertura, los permisos
- las cinco de confidencialidad frente a `BODEGA`

Y el número que cambia es **plausible**: `consumo_real` pasa de −3,00 a +17,00. No es un `NaN` ni un cero sospechoso; es una cifra que un dueño de restaurante leería sin parpadear, y que dice que se consumieron 17 dólares de mercancía que siguen en el estante.

**El indicador de cobertura existe precisamente para avisar de que un conteo parcial no se lee como uno completo, y no detecta esto.** Es la tercera vez que aparece la misma forma de fallo:

| | Invariante que se cumple | Desglose que no |
|---|---|---|
| **P5** | R7 da cero | el desglose del costo está mal |
| **P6** | el saldo cuadra | el tipo del movimiento está mal |
| **P7** | la cobertura dice 50 % | el inventario final está a la mitad |

Lo único que lo caza es el número absoluto contra un caso calculado a mano. Por eso las dos pruebas de integración que fallan afirman **cifras concretas** —37,00 y −3,00— y no relaciones entre ellas.

---

## Los criterios de aceptación del plan, uno por uno

| Criterio | Cómo se comprueba |
|---|---|
| **Un movimiento con fecha en período cerrado se rechaza** | Por las **cinco** rutas del libro —compra, corrección, transferencia, producción, consumo— con `409` y no con 500. Y por una sexta que no pasa por la aplicación: un `INSERT` directo en la tabla, que el trigger rechaza igual. Más el caso frontera: el instante exacto de `finEn` **sí** entra, porque ya es del mes siguiente |
| **La respuesta cruda del endpoint de conteo autenticado como `BODEGA` no contiene stock teórico, diferencia ni valorización** | Sobre `JSON.stringify` del cuerpo, buscando seis cadenas prohibidas en la hoja **y** en la lista. Más `403` en la conciliación y `403` en el cierre del mes |
| **Un conteo parcial produce food cost real con su indicador de cobertura** | Se entrega la **mitad física**, que es la que P7 puede entregar: `inventario_inicial`, `compras_del_mes`, `inventario_final_fisico` y `CONSUMO_REAL` de SPEC §16, encadenados mes a mes, con `cobertura` al lado. **La otra mitad —`venta_neta_mes`— necesita la tabla de unidades vendidas, que es de P8** por la propia división del plan. Está dicho abajo, no escondido |

### Y lo que el plan no pedía pero R8 sí (E12)

| Endpoint | Qué se comprueba con `BODEGA` |
|---|---|
| `GET /conteos/:id` | 403 |
| `POST /conteos/:id/cierre-de-periodo` | 403 — falta `period.close` |
| `GET /conteos/:id/hoja` | 200 —es su trabajo— **y la respuesta cruda no contiene `teorico`, `diferencia`, `valor`, `costo`, `consumo` ni `cobertura`** |
| `GET /conteos` | 200 y la misma comprobación sobre el JSON crudo |
| `POST /conteos/:id/confirmacion` | 204 **con cuerpo exactamente `{}`**, aunque acabe de calcular la conciliación entera |

---

## Sección E — el estado de las reglas

| # | Regla | Estado tras P7 |
|---|---|---|
| E13 | R8 — conteo a ciegas | ✅ **Nueva en P7** |
| E12 | R8 — confidencialidad sobre respuesta cruda | ✅ Extendida a los cinco endpoints de conteo |
| E4 | R2 — el inventario no mezcla ubicaciones | ✅ Reforzada: **el período también es por ubicación** |
| E5 · E6 | R3 — append-only y saldo reconstruido | ✅ Intactas. El conteo **no** escribe en el libro |
| E11 | R7 — conciliación con dataset completo | ⬜ P8 |
| E23 | R2 — el consolidado suma exactamente | ⬜ P9 |

Las demás siguen verdes desde su paquete: las 246 pruebas de integración incluyen las 213 de P0–P6, sin cambios.

---

## Sección H — dónde quedó cada documento

| # | Documento | Qué se hizo |
|---|---|---|
| H1 | `docs/pasos/P7/CONSTRUCCION.md` | Nuevo |
| H2 | `docs/apis/app-cliente.md` | Sección **Períodos y conteo físico (P7)**: ocho endpoints y la tabla de permisos que separa contar de conciliar |
| H3 | `docs/sistema/FUNCIONAMIENTO.md` | Sección **El mes contable y el conteo físico**, con su Mermaid de estados |
| H4 | `docs/sistema/modelo-datos.md` | Sección de P7 con su diagrama, las cinco filas nuevas de índices, y la nota de que **P7 no añadió ninguno sobre el libro** |
| H5 | `docs/sistema/configuracion.md` | **Actualizado:** `shared/infrastructure/config/periods.ts` es configuración versionada nueva (D6, D11) |
| H6 | `docs/decisiones/ADR-010` | Las nueve decisiones que el SPEC no escribe |
| H7 | `docs/runbooks/` | **— no aplica:** P7 no introduce nada operable nuevo. Su migración es reversible (`migrate:verify` en verde) y se despliega por el procedimiento que `despliegue.md` ya describe |
| H8 | `docs/CHANGELOG.md` | Entrada de P7 |
| H9 | `docs/pruebas/casos-conocidos.md` | **P7 no añade casos, y se explica por qué ahí mismo:** este archivo verifica fórmulas del Excel contra valores calculados a mano, y el Excel **no tiene dimensión temporal** (SPEC §3). No hay un `CONSUMO_REAL` del Excel contra el que contrastar hasta que P8 tenga las unidades vendidas |
| H10 | `docs/incidencias/` | **INC-013 nueva**, con su ficha y su fila en el índice |
| H11 | — | La prevención de INC-013 **es** una prueba: la propiedad de los doce meses en tres zonas. La parte del dato de prueba queda como convención, y está dicho por qué no es automatizable |
| H12 | — | INC-007 no reapareció. INC-012 tampoco, y el motivo vuelve a ser M11 |
| H13 | — | Los cuatro guardianes, con salida literal |
| H14 | Este documento | |

También se actualizó `docs/sistema/guardas-de-dominio.md` con las 20 restricciones nuevas y sus cuatro 🔴, y `docs/sistema/seguridad.md` con las cinco filas nuevas de la matriz de roles.

---

## Lo que esta auditoría **no** demuestra

1. **Nadie ha leído nunca un evento de `audit_log`.** Ni esta suite ni ninguna anterior: la tabla tiene `FORCE ROW LEVEL SECURITY` y **no existe política de `SELECT` para ningún rol**, tampoco el dueño. Es lo que SEGURIDAD.md §10 pide, y significa que los eventos de P0 a P7 se escriben y su contenido no está verificado. **Es trabajo de P11**, y queda con nombre en `ESTADO.md`.
2. **El `consumo_real` no está contrastado contra el Excel.** La aritmética se prueba con casos calculados a mano en la suite, pero el Excel no tiene períodos, así que no hay una celda contra la que compararlo. La verificación real llega con P8 y las unidades vendidas.
3. **La cobertura no detecta un error en el inventario final.** El guardián 3 lo demuestra. Lo que discrimina es el valor absoluto.
4. **El presupuesto se midió en esta máquina.** El p95 depende del hardware; lo que no depende es el plan, y por eso hay una prueba que falla ante un `Seq Scan` sobre el libro.
5. **La lista de campos prohibidos para `BODEGA` sigue sin estar demostrada completa.** Se comprueba que seis cadenas concretas no aparecen. Cada endpoint nuevo que devuelva algo derivado del libro necesita su propia comprobación — y P8 devuelve seis vistas.
