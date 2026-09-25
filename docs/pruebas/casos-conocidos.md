# Casos conocidos del dominio

> **Los valores esperados NO se calculan aquí. Se leen del Excel.**
> La fuente es `Modelo_Costeo_Auditado_SNACKLAB.xlsx`, hoja `V_COSTEO`, que ya tiene el resultado calculado para cada producto. Si quien escribe el motor calculara también el resultado esperado, no habría verificación: habría dos veces el mismo error.
> Es el insumo de P5 y el ítem B2 de `docs/FASE0-CHECKLIST.md`.

## Procedencia y trazabilidad

| Campo | Valor |
|---|---|
| Archivo fuente | `Modelo_Costeo_Auditado_SNACKLAB.xlsx` |
| Fecha de extracción | 2026-08-27 |
| Método | Lectura directa del XML de la hoja de cálculo, tomando el **valor en caché de cada fórmula**, sin recalcular nada |
| Hojas leídas | `PARAMETROS`, `T1_INSUMOS`, `T2_PRODUCTOS`, `T3_RECETAS`, `T4_EMPAQUES`, `V_COSTEO` |

**Verificación de que la extracción está completa.** Para cada caso se comprobó que la suma de las líneas de receta extraídas reproduce el `Costo bruto del lote` y el `COSTO NETO del lote` que `V_COSTEO` ya tenía calculado. Si faltara una línea, los totales no cuadrarían:

| Caso | Bruto del lote reconstruido | `V_COSTEO` | Neto del lote reconstruido | `V_COSTEO` |
|---|---|---|---|---|
| CC-001 | 0.51 | 0.51 ✅ | 0.51 | 0.51 ✅ |
| CC-002 | 0.93701 | 0.93701 ✅ | 1.09854846 | 1.098548462 ✅ |
| CC-003 | 74.48613217 | 74.48613217 ✅ | 85.30496033 | 85.30496032 ✅ |

## Parámetros de la company (hoja `PARAMETROS`)

Aplican a los tres casos. Coinciden con los valores semilla de `DECISIONES.md` D3.

| Parámetro | Valor |
|---|---|
| `iva_venta` | `0.15` |
| `iva_compra_recuperable` | `SI` (true) |
| `merma_no_atribuible` | `0.02` |
| `dias_operativos_mes` | `22` |
| `dias_cobertura_objetivo` | `7` |
| `regla_popularidad` | `0.70` |

## Formato de cada caso

```
### CC-00X — {nombre descriptivo}

**Qué prueba:** {la regla o el borde que cubre}
**Origen:** {PRD-XXX del Excel, hoja y fila}

**Entradas** — todas leídas del Excel
**Resultado esperado** — leído de V_COSTEO, no calculado aquí
```

---

## CC-001 — Producto simple, un solo ítem, rendimiento 1

**Qué prueba:** el camino más corto de la cadena de costo. Un ítem, base EP, rendimiento 1.0 en el ítem y 1 porción por lote. Sirve de línea base: si CC-001 falla, no tiene sentido mirar los demás.
**Origen:** `PRD-001` · `T2_PRODUCTOS` fila 6 · `V_COSTEO` fila 6.

**Entradas**

Producto — `T2_PRODUCTOS`
| Campo | Valor |
|---|---|
| Código | `B01` — Tamal de pollo |
| Categoría | POWER BREAKFAST |
| Rendimiento (porciones) | `1` |
| Empaque | `EMP-E` |
| PVP c/IVA | `1.80` |

Empaque — `T4_EMPAQUES`
| `EMP_ID` | Precio de compra | % IVA compra | Costo neto |
|---|---|---|---|
| `EMP-E` — Bolsa kraft antigrasa | `0.05` | `0.15` | `0.04347826087` |

Ítems — `T1_INSUMOS`
| `INS_ID` | Nombre | Tipo | Precio compra | % IVA | Precio neto | Factor conv. | Unidad de uso | Costo bruto/uso | Rendimiento | Costo neto/uso |
|---|---|---|---|---|---|---|---|---|---|---|
| `INS-135` | Tamal de pollo (unidad) | `INS` | `0.51` | `0.00` | `0.51` | `1.0` | `unid` | `0.51` | `1.00` | `0.51` |

Líneas de receta — `T3_RECETAS`
| `REC_ID` | Ítem | Cantidad | Base | Estado | Costo de la línea |
|---|---|---|---|---|---|
| `REC-0001` | `INS-135` | `1.0` | `EP` | `ACTIVA` | `0.51` |

**Resultado esperado** — leído de `V_COSTEO` fila 6

| Campo | Valor esperado |
|---|---|
| `costo_bruto_lote` | `0.51` |
| `costo_neto_lote` | `0.51` |
| `costo_por_porcion` | `0.51` |
| `costo_con_merma` | `0.5202` |
| `empaque_neto` | `0.04347826087` |
| **`COSTO_TOTAL_UNIDAD`** | **`0.5636782609`** |
| `iva_en_precio` | `0.2347826087` |
| `venta_neta` | `1.565217391` |
| **`MARGEN_CONTRIBUCION`** | **`1.00153913`** |
| `mc_pct` | `0.6398722222` |
| **`FOOD_COST_PCT`** | **`0.3601277778`** |
| `suma_control` | **`1`** |
| `multiplicador` | `2.776792188` |
| `impacto_merma` | `0` |

---

## CC-002 — Rendimiento < 1 y línea EXCLUIDA

**Qué prueba:** tres cosas a la vez, y por eso es el caso más valioso de los tres.

1. **Un ítem con rendimiento `0.65`** (`INS-113`, plátano maduro): dividir por el rendimiento **encarece** el insumo, de `0.20` a `0.3076923077`. El costo neto del lote (`1.098548462`) es **mayor** que el bruto (`0.93701`). Si el motor implementa la condicional AP/EP al revés, este caso da `0.93701` y el food cost sale ~4 puntos por debajo del real.
2. **Una línea `EXCLUIDA`** (`INS-057`, huevo): no debe sumar nada al costo. Cubre lo que la tabla de cobertura pedía como CC-004.
3. **Una subpreparación** (`INS-131`, salsa de queso, tipo `SUB`): en el Excel tiene costo escrito a mano. En el SaaS será un ítem `PRODUCIDO` con receta propia, y su costo saldrá de la cascada. **Este caso fija el valor que la cascada debe reproducir** cuando P5 la implemente.

**Origen:** `PRD-006` · `T2_PRODUCTOS` fila 11 · `V_COSTEO` fila 11.

**Entradas**

Producto: `S08` — Wuafle de Maduro Lojano · POWER BREAKFAST · rendimiento `1` porción · empaque `EMP-E` (`0.04347826087` neto) · PVP c/IVA `3.50`

Ítems — `T1_INSUMOS`
| `INS_ID` | Nombre | Tipo | Precio compra | % IVA | Precio neto | Factor | Ud. uso | Costo bruto/uso | **Rendimiento** | Costo neto/uso |
|---|---|---|---|---|---|---|---|---|---|---|
| `INS-113` | Platano maduro | `INS` | `0.20` | `0.00` | `0.20` | `1.0` | `unid` | `0.20` | **`0.65`** | `0.3076923077` |
| `INS-074` | Mantequilla | `INS` | `3.80` | `0.00` | `3.80` | `1.0` | `kg` | `3.80` | `1.00` | `3.80` |
| `INS-017` | Azucar blanca | `INS` | `0.89` | `0.00` | `0.89` | `1.0` | `kg` | `0.89` | `1.00` | `0.89` |
| `INS-057` | Huevo | `INS` | `0.12` | `0.00` | `0.12` | `1.0` | `unid` | `0.12` | `1.00` | `0.12` |
| `INS-131` | Salsa de queso | **`SUB`** | `0.20` | `0.00` | `0.20` | `1.0` | `unid` | `0.20` | `1.00` | `0.20` |
| `INS-048` | Decoracion del wuafle | `INS` | `0.15` | `0.00` | `0.15` | `1.0` | `unid` | `0.15` | `1.00` | `0.15` |
| `INS-122` | Queso mozzarella | `INS` | `5.50` | `0.00` | `5.50` | `1.0` | `kg` | `5.50` | `1.00` | `5.50` |

Líneas de receta — `T3_RECETAS`
| Ítem | Cantidad | Base | Estado | Costo de la línea |
|---|---|---|---|---|
| `INS-113` | `1.5` | `EP` | `ACTIVA` | `0.4615384615` |
| `INS-074` | `0.03` | `EP` | `ACTIVA` | `0.114` |
| `INS-017` | `0.009` | `EP` | `ACTIVA` | `0.00801` |
| `INS-057` | `0.0` | `EP` | **`EXCLUIDA`** | **`0`** |
| `INS-131` | `1.0` | `EP` | `ACTIVA` | `0.2` |
| `INS-048` | `1.0` | `EP` | `ACTIVA` | `0.15` |
| `INS-122` | `0.03` | `EP` | `ACTIVA` | `0.165` |

**Resultado esperado** — leído de `V_COSTEO` fila 11

| Campo | Valor esperado |
|---|---|
| `costo_bruto_lote` | `0.93701` |
| **`costo_neto_lote`** | **`1.098548462`** ← mayor que el bruto |
| `costo_por_porcion` | `1.098548462` |
| `costo_con_merma` | `1.120519431` |
| `empaque_neto` | `0.04347826087` |
| **`COSTO_TOTAL_UNIDAD`** | **`1.163997692`** |
| `iva_en_precio` | `0.4565217391` |
| `venta_neta` | `3.043478261` |
| **`MARGEN_CONTRIBUCION`** | **`1.879480569`** |
| `mc_pct` | `0.6175436156` |
| **`FOOD_COST_PCT`** | **`0.3824563844`** |
| `suma_control` | **`1`** |
| `multiplicador` | `2.614677231` |
| **`impacto_merma`** | **`0.1723977989`** ← el plato cuesta 17,24 % más de lo que el modelo anterior creía |

---

## CC-003 — Rendimiento por lote de 185 porciones

**Qué prueba:** el lote grande. Once líneas, cantidades para el lote entero (18,14 kg de plátano para 185 empanadas), y **tres ítems con rendimiento < 1** simultáneamente (`0.68`, `0.92`, `0.87`, `0.82`). Es el caso donde una división mal escalada se nota: el costo por porción es `0.4611078936` y un error en el decimal doce se propaga a 185 unidades.

También es el caso que ejercita magnitudes muy distintas en la misma suma —de `0.00832` a `59.7826087`— que es exactamente donde el punto flotante deriva y la aritmética decimal exacta no.

**Origen:** `PRD-018` · `T2_PRODUCTOS` fila 23 · `V_COSTEO` fila 23.

**Entradas**

Producto: `S02` — Empanada de Verde con Pollo · SNACK ATTACK · rendimiento **`185`** porciones · empaque `EMP-E` (`0.04347826087` neto) · PVP c/IVA `2.50`

Ítems y líneas — `T1_INSUMOS` + `T3_RECETAS`, todas base `EP`, todas `ACTIVA`
| `INS_ID` | Nombre | Precio compra | % IVA | Costo bruto/uso | **Rend.** | Costo neto/uso | Cantidad | Costo de la línea |
|---|---|---|---|---|---|---|---|---|
| `INS-112` | Platano dominico | `0.66` | `0.00` | `0.66` | **`0.68`** | `0.9705882353` | `18.14` | `17.60647059` |
| `INS-100` | Pechuga de pollo | `4.40` | `0.00` | `4.40` | **`0.92`** | `4.782608696` | `12.5` | `59.7826087` |
| `INS-072` | Manteca | `4.00` | **`0.15`** | `3.47826087` | `1.00` | `3.47826087` | `0.9` | `3.130434783` |
| `INS-004` | Achiote | `4.42` | **`0.15`** | `3.843478261` | `1.00` | `3.843478261` | `0.4` | `1.537391304` |
| `INS-125` | Sal | `0.39` | `0.00` | `0.39` | `1.00` | `0.39` | `0.1` | `0.039` |
| `INS-029` | Cebolla paitena | `0.95` | `0.00` | `0.95` | **`0.87`** | `1.091954023` | `0.9` | `0.9827586207` |
| `INS-109` | Pimientos (mezcla) | `2.50` | `0.00` | `2.50` | **`0.82`** | `3.048780488` | `0.5` | `1.524390244` |
| `INS-063` | Laurel | `12.88` | `0.00` | `12.88` | `1.00` | `12.88` | `0.002` | `0.02576` |
| `INS-046` | Cubos maggi | `8.38` | **`0.15`** | `7.286956522` | `1.00` | `7.286956522` | `0.09` | `0.655826087` |
| `INS-043` | Comino | `8.32` | `0.00` | `8.32` | `1.00` | `8.32` | `0.001` | `0.00832` |
| `INS-081` | Oregano | `12.00` | `0.00` | `12.00` | `1.00` | `12.00` | `0.001` | `0.012` |

> Los cuatro ítems con `% IVA compra = 0.15` (manteca, achiote, cubos maggi) ejercitan de paso el descuento de IVA recuperable: `4.00 / 1.15 = 3.47826087`.

**Resultado esperado** — leído de `V_COSTEO` fila 23

| Campo | Valor esperado |
|---|---|
| `costo_bruto_lote` | `74.48613217` |
| `costo_neto_lote` | `85.30496032` |
| `rendimiento_porciones` | `185` |
| **`costo_por_porcion`** | **`0.4611078936`** |
| `costo_con_merma` | `0.4703300515` |
| `empaque_neto` | `0.04347826087` |
| **`COSTO_TOTAL_UNIDAD`** | **`0.5138083124`** |
| `iva_en_precio` | `0.3260869565` |
| `venta_neta` | `2.173913043` |
| **`MARGEN_CONTRIBUCION`** | **`1.660104731`** |
| `mc_pct` | `0.7636481763` |
| **`FOOD_COST_PCT`** | **`0.2363518237`** |
| `suma_control` | **`1`** |
| `multiplicador` | `4.230980681` |
| `impacto_merma` | `0.1452462067` |

---

## CC-R7 — Mini-conciliación con los tres casos anteriores

**Qué prueba:** la regla R7. `ROUND(costo_ventas_teorico − costo_ventas_segun_costeo, 2)` debe dar **exactamente 0**. Es la mejor defensa contra un motor de costeo silenciosamente roto, y por eso una versión reducida corre ya en **P0**, dentro del módulo de aritmética, antes de que el motor exista: demuestra que las escalas y el redondeo sostienen R7.

**Sobre las unidades vendidas.** El Excel **no tiene dimensión temporal**: `T2_PRODUCTOS` trae `Unidades vendidas mes = 0` para los 48 productos, y por eso `V_COSTEO` muestra `0` en las tres columnas del mes. Los períodos son una extensión del SaaS (SPEC §3). Las unidades de este caso son, por tanto, **el único dato que no sale del Excel**, y se declaran aquí explícitamente:

| Producto | Unidades del mes |
|---|---|
| `PRD-001` Tamal de pollo | `120` |
| `PRD-006` Wuafle de Maduro Lojano | `85` |
| `PRD-018` Empanada de Verde con Pollo | `340` |

Todo lo demás —`costo_por_porcion`, `empaque_neto`, `venta_neta`, `MARGEN_CONTRIBUCION`— son los valores de `V_COSTEO` transcritos arriba.

**Fórmulas** (SPEC §16, sin reinterpretar):

```
empaque_teorico_mes   = Σ(empaque_neto × unidades_mes)
provision_merma_mes   = Σ(costo_por_porcion × merma_no_atribuible × unidades_mes)
consumo_teorico       = Σ(costo_por_porcion × unidades_mes)
costo_ventas_teorico  = consumo_teorico + empaque_teorico_mes + provision_merma_mes

costo_ventas_v_costeo = venta_neta_mes_total − mc_mes_total
                      = Σ(venta_neta × unidades_mes) − Σ(margen_contribucion × unidades_mes)

DIFERENCIA_CONCILIACION = ROUND(costo_ventas_teorico − costo_ventas_v_costeo, 2)
```

**Resultado esperado**

| Aserción | Valor |
|---|---|
| `DIFERENCIA_CONCILIACION` | **`0.00`** — es el contrato de R7 |
| `abs(diferencia)` sin redondear | **`≤ 0.000001`** — el canario |

> **El canario es lo que de verdad protege.** El contrato sigue en verde mientras la deriva sea menor que medio centavo, así que un motor que empieza a derivar puede pasar la prueba durante meses y romperse un día en producción. El canario se rompe **cinco órdenes de magnitud antes**, en el commit que introdujo la deriva. No es opcional.

**Por qué no hay más números esperados en esta ficha.** El valor esperado de R7 es cero por álgebra: `costo_ventas_v_costeo` desarrollado es `Σ costo_por_porcion·u + Σ costo_por_porcion·merma·u + Σ empaque·u`, que es término a término `costo_ventas_teorico`. Publicar aquí las sumas intermedias calculadas a mano no añadiría verificación —serían mis números comprobando mis números—; el contrato es la identidad, y las entradas vienen del Excel.

---

## CC-004 — El mismo ítem en base AP y en base EP

**Qué prueba:** R4, la condicional que SPEC §13 llama «la más frágil del modelo». Los dos casos con **resultados distintos y ambos correctos**.
**Origen:** construido. `T3_RECETAS` tiene sus 293 líneas **todas en base `EP`**, así que la mitad AP no se puede extraer del Excel: se deriva de `INS-113` (CC-002) aplicando la fórmula de SPEC §13 a mano.

**Por qué se parte de CC-002 y no de un ítem inventado.** La mitad `EP` de este caso **ya está verificada por el Excel** —`V_COSTEO` da `0.4615384615` para esa línea— así que lo único calculado a mano es la mitad `AP`, que es una multiplicación. Un ítem inventado habría dejado las dos mitades sin corroborar.

**Entradas** — el ítem, leído del Excel

| Campo | Valor | Procedencia |
|---|---|---|
| Ítem | `INS-113` Plátano maduro | `T1_INSUMOS` |
| Precio de compra | `0.20` | `T1_INSUMOS` |
| % IVA compra | `0.00` | `T1_INSUMOS` |
| Factor de conversión | `1.0` | `T1_INSUMOS` |
| **Rendimiento** | **`0.65`** | `T1_INSUMOS` |
| `costo_bruto_uso` | `0.20` | `T1_INSUMOS` |
| `costo_neto_uso` | `0.3076923077` | `T1_INSUMOS` |

**Entradas** — la línea, la misma cantidad en las dos bases

| Cantidad | Base | Estado |
|---|---|---|
| `1.5` | `EP` | `ACTIVA` |
| `1.5` | `AP` | `ACTIVA` |

**Resultado esperado**

| Base | Fórmula (SPEC §13) | Valor esperado | Procedencia |
|---|---|---|---|
| `EP` | `1.5 × costo_neto_uso` = `1.5 × 0.307692307692…` | **`0.461538461538`** | **`V_COSTEO` lo tiene: `0.4615384615`** |
| `AP` | `1.5 × costo_bruto_uso` = `1.5 × 0.20` | **`0.30`** | Calculado a mano desde SPEC §13 |
| — | diferencia entre las dos | **`0.161538461538`** | |

> **Qué pasa si R4 se implementa al revés.** La línea cuesta `0.30` en vez de `0.4615…`: un **35 % menos**. Nada se rompe, nada avisa, y el food cost del plato sale casi cuatro puntos por debajo del real. Por eso este caso existe y por eso el motor lo corre siempre.

> **La trampa que este caso evita.** Con rendimiento `1.00` los dos números coinciden y **pasa cualquier implementación, incluida la invertida**. `INS-113` se eligió justamente por tener rendimiento `0.65`.

---

## CC-005 — Subpreparación anidada, costeada en cascada

**Qué prueba:** que un ítem `PRODUCIDO` con receta propia produce **el mismo número** que el costo escrito a mano del Excel, y que al subir un insumo ese número **se mueve**. Es el problema que el LEEME declara como deuda conocida (SPEC §5): *«tienen costo escrito a mano y no se recalculan si sube un insumo»*.
**Origen:** parte de `INS-131` (Salsa de queso), la subpreparación de CC-002, que en el Excel tiene costo `0.20` escrito a mano. La receta es **construida**: el Excel no tiene ninguna.

**El destino: `INS-131`** — `SUB` en el Excel, ítem `PRODUCIDO` en el SaaS. Unidad de uso `unid`, rendimiento `1.00`.

**La receta de la subpreparación** — se expresa **por unidad de uso**, no por lote

| Ítem | Precio | % IVA | Rend. | `costo_neto_uso` | Cantidad | Base | Estado | Costo de la línea |
|---|---|---|---|---|---|---|---|---|
| `INS-122` Queso mozzarella | `5.50` /kg | `0.00` | `1.00` | `5.50` | `0.032` | `EP` | `ACTIVA` | `0.176` |
| `INS-057` Huevo | `0.12` /unid | `0.00` | `1.00` | `0.12` | `0.2` | `EP` | `ACTIVA` | `0.024` |

**Parte A — la cascada reproduce el número del Excel**

| Campo | Valor esperado |
|---|---|
| `costo_neto_uso` de `INS-131` derivado | **`0.200000`** |
| El costo escrito a mano en `T1_INSUMOS` | `0.20` |
| CC-002 recalculado con la cascada | **idéntico**: `costo_neto_lote` `1.098548462` y todo lo demás |

> **Ésta es la aserción fuerte del caso.** La cascada no se compara contra un número que yo haya calculado: se compara contra el `0.20` que el Excel ya tenía, y contra el `1.098548462` que `V_COSTEO` ya tenía. Si la cascada estuviera mal, CC-002 dejaría de cuadrar.

**Parte B — sube un insumo y el plato se mueve**

El queso mozzarella pasa de `5.50` a `6.00` el kilo. Precio nuevo, fila nueva, confirmado (R5).

| Campo | Antes | Después | Cómo se obtiene |
|---|---|---|---|
| Línea del queso en la salsa | `0.176` | `0.192` | `6.00 × 0.032` |
| `costo_neto_uso` de `INS-131` | `0.200000` | **`0.216000`** | `0.192 + 0.024` |
| Línea de `INS-131` en CC-002 | `0.20` | **`0.216`** | cantidad `1.0` |
| `costo_bruto_lote` de CC-002 | `0.93701` | **`0.95301`** | `0.93701 − 0.20 + 0.216` |
| `costo_neto_lote` de CC-002 | `1.098548462` | **`1.114548462`** | `1.098548462 − 0.20 + 0.216` |
| `costo_con_merma` | `1.120519431` | **`1.136839431`** | `1.114548462 × 1.02` |
| **`COSTO_TOTAL_UNIDAD`** | `1.163997692` | **`1.180317692`** | `+ 0.04347826087` |

> **En el modelo del Excel este movimiento no habría ocurrido.** El costo de la salsa seguiría siendo `0.20` hasta que alguien lo cambiara a mano, y el plato seguiría pareciendo más barato de lo que es. La cascada es la que convierte una subida de precio en un margen actualizado.

**Sobre `PRODUCIDO` y el precio de referencia.** `INS-131` puede tener las dos cosas: una receta propia y un precio de referencia confirmado. **Cuando hay receta, manda la receta**; el precio de referencia es el costo estándar de una preparación que todavía no la tiene —que es exactamente cómo llegan las 24 filas `SUB` en la migración del Excel. El razonamiento completo está en `docs/decisiones/ADR-008`.

---

## CC-006 — Combo de dos productos simples

**Qué prueba:** SPEC §8, «el combo usa las porciones reducidas, no los productos de carta», y que el costo del combo es la **suma de sus componentes ya costeados**, sin volver a cobrar la merma y sin prorratear el descuento.
**Origen:** construido. Los dos componentes son productos reales y sus costos están **leídos de `V_COSTEO`**; lo único calculado aquí es la suma. Candidatos reales del Excel para el mismo patrón: `PRD-038`, `PRD-039`, `PRD-040`, `PRD-048`.

**Entradas**

| Campo | Valor |
|---|---|
| Combo | `PRD-C01` — Tamal + Empanada |
| Tipo | `COMBO` |
| PVP c/IVA | `4.00` |
| Empaque propio | ninguno |

| Componente | Cantidad | `COSTO_TOTAL_UNIDAD` | Procedencia |
|---|---|---|---|
| `PRD-001` Tamal de pollo | `1` | `0.5636782609` | `V_COSTEO` fila 6 (CC-001) |
| `PRD-018` Empanada de Verde con Pollo | `1` | `0.5138083124` | `V_COSTEO` fila 23 (CC-003) |

**Resultado esperado**

| Campo | Valor esperado | Cómo se obtiene |
|---|---|---|
| **`COSTO_TOTAL_UNIDAD`** | **`1.0774865733`** | `0.5636782609 + 0.5138083124` — suma exacta de dos valores del Excel |
| `venta_neta` | `3.478260869565` | `4.00 / 1.15` |
| `iva_en_precio` | `0.521739130435` | `4.00 − venta_neta` |
| **`MARGEN_CONTRIBUCION`** | **`2.400774296265`** | `venta_neta − costo_total_unidad` |
| `mc_pct` (2 dec.) | `0.69` | |
| **`FOOD_COST_PCT`** (2 dec.) | **`0.31`** | |
| `suma_control` | **`1`** | R6 |
| `multiplicador` (2 dec.) | `3.23` | |

**Las tres reglas que este caso fija, y que el SPEC no escribe:**

1. **El combo no vuelve a aplicar la provisión de merma.** Cada componente ya la lleva dentro de su `COSTO_TOTAL_UNIDAD`. Aplicarla otra vez sería cobrar la merma dos veces, que es justo lo que R12 prohíbe.
2. **El combo no divide por `rendimiento_porciones`.** Un combo es una unidad; sus componentes ya vienen costeados por porción.
3. **El combo suma el empaque de sus componentes y añade el suyo si lo tiene.** Aquí no tiene, así que el total es la suma limpia. Un combo servido en bandeja añadiría la bandeja **una vez**.

> **El descuento no se prorratea** (SPEC §8). El combo compite en menu engineering como ítem propio: su PVP de `4.00` es menor que la suma de los PVP sueltos (`1.80 + 2.50 = 4.30`), y esa diferencia es del combo, no de los componentes. En P8 se verá como un cuadrante propio.

---

## CC-007 — `iva_recuperable = false`: el costo sube exactamente el IVA de cada precio

**Qué prueba:** R13 y el criterio E20. Y una segunda cosa que ninguna otra prueba cubre: que **la tasa de IVA es la de cada precio, no una de la company**.
**Origen:** los once ítems de CC-003 (`PRD-018`), que traen **tres tasas distintas conviviendo**: `0.15` en tres ítems y `0.00` en los otros ocho.

**Entradas.** Las mismas de CC-003, cambiando un único parámetro de la company: `iva_compra_recuperable` de `SI` a `NO`.

**Resultado esperado — la identidad, ítem por ítem**

Para cada uno de los once ítems, con la fórmula de SPEC §12:

```
costo_neto_uso(no recuperable) = costo_neto_uso(recuperable) × (1 + iva_compra DE ESE PRECIO)
```

| Ítem | % IVA de su precio | `costo_neto_uso` recuperable | `costo_neto_uso` NO recuperable | ¿Cambia? |
|---|---|---|---|---|
| `INS-072` Manteca | **`0.15`** | `3.47826087` | **`4.00`** | **sí** |
| `INS-004` Achiote | **`0.15`** | `3.843478261` | **`4.42`** | **sí** |
| `INS-046` Cubos maggi | **`0.15`** | `7.286956522` | **`8.38`** | **sí** |
| `INS-112` Plátano dominico | `0.00` | `0.9705882353` | `0.9705882353` | no |
| `INS-100` Pechuga de pollo | `0.00` | `4.782608696` | `4.782608696` | no |
| `INS-125` Sal | `0.00` | `0.39` | `0.39` | no |
| `INS-029` Cebolla paiteña | `0.00` | `1.091954023` | `1.091954023` | no |
| `INS-109` Pimientos | `0.00` | `3.048780488` | `3.048780488` | no |
| `INS-063` Laurel | `0.00` | `12.88` | `12.88` | no |
| `INS-043` Comino | `0.00` | `8.32` | `8.32` | no |
| `INS-081` Orégano | `0.00` | `12.00` | `12.00` | no |

**Y el empaque cambia igual que los ítems** (R13: «afecta el costo de ítems y empaques por igual»):

| | recuperable | NO recuperable |
|---|---|---|
| `EMP-E` Bolsa kraft (`0.05`, IVA `0.15`) | `0.04347826087` | **`0.05`** |

**Las dos aserciones que discriminan**

| # | Aserción | Qué implementación mata |
|---|---|---|
| 1 | **Cambian exactamente 3 de los 11 ítems** | La que usa una tasa única de company: movería los once |
| 2 | El delta del lote es `0.79854782608699`, que a la escala 12 del motor es `0.798547826087` | `(3.60 − 3.130434783) + (1.768 − 1.537391304) + (0.7542 − 0.655826087)`, y **nada más** |

> **Corrección a CC-003.** Su nota decía «los cuatro ítems con `% IVA compra = 0.15`» y a continuación nombraba **tres**. Son tres: manteca, achiote y cubos maggi. El error estaba en la prosa, no en la tabla, que siempre listó los once ítems con su tasa correcta.

---

## CC-009 — Los bordes que no pueden dividir por cero

**Qué prueba:** que ningún borde produce `NaN`, `Infinity` ni un cero que parezca un resultado. El SPEC escribe dos guardas explícitas; la tercera no la escribe y hace falta igual.
**Origen:** construido. No hay caso real en el Excel, y ése es justamente el motivo de escribirlo.

**Borde 1 — `rendimiento_porciones = 0`** (guarda de SPEC §14)

Un producto con receta y sin rendimiento capturado. Es el estado normal de un producto a medio configurar.

| Campo | Valor esperado |
|---|---|
| `costo_por_porcion` | **`0`** — la guarda del SPEC, no una excepción |
| `costo_con_merma` | `0` |
| `COSTO_TOTAL_UNIDAD` | `0.04347826087` — solo el empaque |
| Excepción lanzada | **ninguna** |

**Borde 2 — `factor_conversion = 0` y `rendimiento = 0`** (guardas de SPEC §12)

| Entrada | `costo_bruto_uso` | `costo_neto_uso` |
|---|---|---|
| `factor_conversion = 0` | **`0`** | `0` |
| `rendimiento = 0` | `0.51` | **`0`** |

**Borde 3 — sin PVP: la guarda que el SPEC no escribe**

`product_location.pvp` es anulable, y un producto sin PVP es lo normal antes de fijar precio. Pero `venta_neta = 0` haría que `mc_pct = margen / 0` y `multiplicador = venta_neta / costo`.

| Campo | Valor esperado |
|---|---|
| Los costos (`costo_por_porcion`, `costo_con_merma`, `COSTO_TOTAL_UNIDAD`) | **se calculan igual**: no dependen del PVP |
| `venta_neta`, `mc_pct`, `FOOD_COST_PCT`, `suma_control`, `multiplicador` | **ausentes**, con el motivo dentro |
| Excepción lanzada | **ninguna** |

> **Ausentes, no cero.** Un `food_cost_pct = 0` se lee como «este plato no cuesta nada», que es lo contrario de lo que pasa. El motor devuelve una unión: o el bloque de venta entero, o el motivo por el que no hay. R6 (`mc% + food_cost% = 1`) se exige **solo** cuando hay bloque de venta, porque sin venta neta la suma de control no significa nada.

**Borde 4 — `costo_bruto_lote = 0`** (guarda de SPEC §14)

| Campo | Valor esperado |
|---|---|
| `impacto_merma` | **`null`**, tal como el SPEC lo escribe. No `0`, que se leería como «esta receta no tiene merma» |

---

## CC-IVA-01..04 — El IVA de compra en dos niveles (P16-A1, D-16.9)

**Qué prueba:** la primera línea de SPEC §12 aplicada al **total de la factura que teclea el bodeguero**, y la precedencia con la que se elige la tarifa: cuerpo > artículo > grupo, sin valor por defecto. Es la fórmula que ya cubría CC-007 para el precio de referencia, ahora compartida con el libro de inventario (`shared/domain/iva/neteo.ts`, D-16.40).
**Origen:** construidos y **calculados a mano antes que el código**, el 2026-09-09. No hay caso en el Excel: el Excel no tiene libro de inventario, y sus precios ya entran neteados por `T1`.

**Parámetro fijo:** `bruto = 115.00` (una factura con IVA del 15 % sobre 100.00).

| Caso | `tarifa` | `iva_recuperable` | `neto = recuperable ? bruto / (1 + tarifa) : bruto` | **Esperado** |
|---|---|---|---|---|
| **CC-IVA-01** | `0.15` | `true` | `115.00 / 1.15` | **`100.00`** exacto (`100.000000000000` a escala 12) |
| **CC-IVA-02** | `0.15` | `false` | `115.00` — el IVA es costo (R13) | **`115.00`** |
| **CC-IVA-03** | `0` | `true` y `false` | `115.00 / 1` y `115.00` | **`115.00`** en los dos: con tarifa cero, recuperar o no da lo mismo |
| **CC-IVA-04** | cuerpo `0.08`, artículo `0.15`, grupo `0.12` | `true` | la precedencia elige **`0.08`**; con bruto `108.00`: `108.00 / 1.08` | tarifa aplicada **`0.08`**, neto **`100.00`** |

**Y lo que persiste el libro (D-16.10), en CC-IVA-01:** `total_bruto = 115.000000000000`, `iva_tarifa_aplicada = 0.150000000000`, `iva_recuperable_aplicado = true`, `total_cost = 100.000000000000`, `desglose_conocido = true`.

**Las aserciones que discriminan**

| # | Aserción | Qué implementación mata |
|---|---|---|
| 1 | CC-IVA-02 devuelve `115.00`, no `100.00` | La que netea siempre e ignora R13 |
| 2 | CC-IVA-04 aplica `0.08` y no `0.15` | La que lee el artículo antes que el cuerpo, o la que sigue leyendo `company_settings.iva_compra` |
| 3 | Sin cuerpo, sin artículo y sin grupo, la compra **se rechaza** (400) | La que rellena con `0.15` «por defecto» — que es exactamente lo que D-16.9 prohíbe |

Se prueban en `shared/domain/iva/neteo.spec.ts` y `precedencia.spec.ts` (dominio puro, base apagada) y de punta a punta en `test/integracion/iva-de-compra.spec.ts`, leyendo la fila con la dueña.

---

---

## CC-010 · CC-011 · CC-012 · CC-013 — Un mes con el vocabulario completo del libro (D-16.201, D-16.202)

**Qué prueban:** los **tres agregados de dinero** del modelo —`compras_del_mes`, `CONSUMO_REAL` y la
valorización del inventario— sobre **un único mes que usa todo el vocabulario del libro**: compra,
corrección de compra, transferencia, producción, merma, ajuste y consumo por venta. Los tres se
alimentan del mismo dataset, así que un número que se mueva en uno se ve en los otros.

**Por qué existen (D-16.201).** Cierran **la clase de INC-029**, no su instancia. El saldo tenía dos
definiciones vigilándose —el `SUM` de PostgreSQL y `proyectarSaldos`— y el dinero **no tenía
ninguna**: vivía dentro de una consulta, en infraestructura, sin un solo número esperado escrito en
ninguna parte. Por esa grieta pasó una compra corregida que seguía contando su importe. Estos casos
ponen el número esperado por delante del código.

**Origen:** construidos y **calculados a mano antes de escribir el pliegue**, el 2026-09-20.

**Qué cubre el Excel, y qué no:** cubre **las fórmulas** —SPEC §16 y §18, verificadas una a una
contra el archivo en P8 (ver la tabla del final de este documento)— y **no cubre los resultados**,
por tres razones que ya estaban escritas: el Excel **no tiene dimensión temporal** (SPEC §3), **no
tiene correcciones, transferencias ni producción** (son la extensión de P6) y **tiene todas las
unidades vendidas en cero**, así que sus vistas de período están vacías en el propio archivo. Lo
contrastable —cada fórmula— está contrastado; lo demás se calcula aquí y se dice que es de aquí.

### El dataset: Local Centro, marzo 2026, ítem «Arroz» en kg

**Costo neto de uso del arroz: `1.00 / kg`** — igual al neto de la primera compra, a propósito: con
el precio de referencia y el precio pagado coincidiendo, cada número de estos casos se puede
comprobar en kilos y en dólares a la vez.

| # | Fecha | Tipo | Cantidad (con signo) | `total_cost` (magnitud) | Nota |
|---|---|---|---|---|---|
| 1 | 03-03 | `COMPRA` | `+100` | `100.00` | 100 kg a 1,00 netos |
| 2 | 03-10 | `COMPRA` | `+50` | `50.00` | |
| 3 | 03-11 | `COMPRA` | `−50` | `50.00` | **la corrección de la #2**: mismo tipo, cantidad contraria, importe en positivo (R3, ADR-009 §3) |
| 4 | 03-12 | `TRANSFERENCIA_SALIDA` | `−20` | `null` | **no lleva importe**: mueve stock, no dinero. La otra pata entra en Bodega Norte, que es otro libro |
| 5 | 03-15 | `PRODUCCION` | `−8` | `8.00` | el arroz que se fue a una preparación |
| 6 | 03-20 | `MERMA` | `−2.5` | `null` | |
| 7 | 03-28 | `AJUSTE` | `+0.5` | `null` | |
| 8 | 03-31 | `CONSUMO_POR_VENTA` | `−22` | `null` | la receta × las unidades vendidas |

**Y dos datos que no son movimientos:** el conteo confirmado de **febrero** fue **40 kg**, y el
conteo físico de **marzo** fue **86 kg**.

---

### CC-010 — `compras_del_mes` y las cantidades de SPEC §18

**Entrada:** los ocho movimientos de arriba.

| Salida | Esperado | De dónde sale |
|---|---|---|
| `importeDeCompras` | **`100.00`** | `+100.00 + 50.00 − 50.00` — el importe lleva **el signo de su cantidad** |
| `compras` (cantidad) | **`100.000000000000`** kg | `+100 + 50 − 50` |
| `mermasYAjustes` | **`−2.000000000000`** kg | `−2.5 + 0.5` |
| `otros` | **`−28.000000000000`** kg | `−20` transferencia `− 8` producción |

**Las aserciones que discriminan**

| # | Aserción | Qué implementación mata |
|---|---|---|
| 1 | `importeDeCompras` vale `100.00`, **no `200.00`** | La que suma `total_cost` sin mirar el signo de la cantidad: cuenta la compra corregida **dos veces**. Es INC-029 exactamente |
| 2 | `importeDeCompras` vale `100.00`, **no `208.00` ni `92.00`** | La que suma el dinero de **todos** los tipos: el consumo de una producción lleva importe y no es una compra. `208` es sumarlo todo sin signo; `92`, sumarlo todo con signo |
| 3 | El `CONSUMO_POR_VENTA` no aparece en ningún agregado | La que lo suma en `otros` — y deja el stock teórico corto por el consumo entero del mes |
| 4 | Barajar los ocho movimientos no cambia ni un dígito | La que acumula con punto flotante, donde el orden sí importa |

Probado en `apps/api/src/modules/inventory/domain/agregados.spec.ts`, **con la base apagada**.

---

### CC-011 — `CONSUMO_REAL` y su varianza (SPEC §16, reescrito por D-16.202)

**Entrada** — `inventario_inicial = 40 × 1.00`, `compras_del_mes = 100.00` (de CC-010),
`transferencias enviadas = 20 × 1.00`, `salidas a producción = 8 × 1.00`,
`inventario_final_fisico = 86 × 1.00`, `consumo_teorico = 22 × 1.00`.

| Salida | Esperado | De dónde sale |
|---|---|---|
| `CONSUMO_REAL` | **`26.00`** | `40.00 + 100.00 − 20.00 − 8.00 − 86.00` |
| `CONSUMO_TEORICO` | **`22.00`** | 22 kg de receta × 1,00 |
| `VARIANZA_USD` | **`4.00`** | `26.00 − 22.00` |

**El desglose, con el ajuste en línea propia** (D-16.202) — y es lo que la pantalla 25 enseña:

| Línea | | De dónde sale |
|---|---|---|
| Merma registrada | **`2.50`** | el movimiento `MERMA` del mes, atribuible y con su fecha |
| Ajustes | **`−0.50`** | el `AJUSTE` de `+0,5 kg`: **suma stock, así que resta varianza** |
| Sin explicar | **`2.00`** | la diferencia del conteo — lo que el libro no explica |
| **Varianza** | **`4.00`** | `2.50 − 0.50 + 2.00` |

**Por qué el ajuste es línea propia y no parte de «sin explicar»:** un ajuste es una corrección que
alguien registró, con su nota y su autor; «sin explicar» es precisamente lo que nadie registró.
Meterlos juntos borraría la diferencia entre «se corrigió» y «falta», que es la única pregunta que
un dueño se hace mirando esta cifra.

#### Y la identidad que lo ata al inventario — **R15**

```
varianza (§16)  =  −mermas_y_ajustes (§18)  −  diferencia_de_conteo (§18)
     4.00       =        −(−2.00)           −        (−2.00)
```

**No es una coincidencia del dataset: es álgebra.** Despejando el stock teórico de §18 dentro del
`consumo_real` de §16, el término de transferencias y producción **se cancela entero**, y lo que
queda es exactamente lo que el libro no explica:

```
consumo_real = inicial + compras + otros − conteo_fisico
conteo_fisico = (inicial + compras + mermasYAjustes + otros − consumo_teorico) + diferencia
⇒ consumo_real − consumo_teorico = −mermasYAjustes − diferencia
```

Por eso R15 se prueba **sobre este mismo dataset y sobre el caso conocido de R7**: si las dos vistas
del mismo libro dejan de cuadrar, una está mal y da igual cuál.

> **Lo que este caso destapó, y que ya está decidido.** Con la fórmula anterior —`inicial + compras
> − final`, la del Excel— la varianza de este mes salía **32,00**, de los cuales **28,00 eran
> transferencia y producción**: stock que salió del local sin consumirse en él. El Excel no los
> tiene (SPEC §3), así que la fórmula no los restaba. Fue la **duda abierta #16**, decidida por el
> usuario el 2026-09-20 con la opción (a) extendida: **D-16.202**, que se construye en **P16-J**,
> justo antes de la pantalla 25.

> ⚠️ **Hasta P16-J, el sistema todavía da `54.00` y `32.00`**, y su prueba lo fija a propósito: un
> caso conocido dice lo que el número **debe** valer, y la prueba de hoy dice lo que **vale**, para
> que el cambio se vea cuando llegue. Cuando P16-J entre, las dos cifras se encuentran aquí.

> **Y su `varianza_precio` es CERO POR CONSTRUCCIÓN.** El arroz de este caso se compra a `1,00`,
> que es exactamente su costo de uso, así que `Σ(total_cost − cantidad × costo_de_uso) = 0` y la
> varianza entera es de **uso**. Es deliberado: mantiene el caso base legible. El mes con el precio
> pagado distinto del de referencia es **CC-013**, y es el que enseña que la identidad de R15 vive
> en cantidades y no en dólares.

Probado en `apps/api/src/modules/analytics/domain/vistas.spec.ts`, con la base apagada.

---

### CC-012 — El inventario valorizado del mismo mes (SPEC §18)

**Entrada** — las cantidades de CC-010, `stock_inicial = 40`, `consumo_teorico = 22`,
`conteo_fisico = 86`, `costo_de_uso = 1.00`, y los parámetros de la company (`dias_operativos = 22`,
`dias_cobertura = 7`).

| Salida | Esperado | De dónde sale |
|---|---|---|
| `STOCK_TEORICO` | **`88`** kg | `40 + 100 + (−2) + (−28) − 22` |
| `valor_teorico` | **`88.00`** | `88 × 1.00` |
| `diferencia` | **`−2`** kg | `86 − 88`: el conteo encontró dos kilos menos |
| `valor_diferencia` | **`−2.00`** | |
| `punto_de_reorden` | **`7`** kg | `(22 / 22) × 7` — un kilo al día, siete días de cobertura |
| `dias_cobertura` | **`88`** | `88 / (22 / 22)` |
| `estado` | **`OK`** | 88 kg está muy por encima de los 7 de reorden |

**La aserción que discrimina:** el `−2` de la diferencia **no es la merma ni el ajuste**. Los dos ya
están dentro del stock teórico; el faltante es lo que el libro **no explica**, y por eso vale
exactamente dos kilos y no `−2.5` ni `+0.5`. Una implementación que olvidara `otros` daría un stock
teórico de 116 kg y una diferencia de −30: el error saldría quince veces mayor que el hallazgo real.

Probado en `apps/api/src/modules/analytics/domain/vistas.spec.ts`, con la base apagada.

---

### CC-013 — El mismo mes, pagando el arroz más caro que su precio de referencia (D-16.202)

**Qué prueba:** que la varianza **se parte en dos problemas distintos** y que la identidad de R15
vive en **cantidades**, no en dólares. Es el mismo mes de CC-010/011/012, cambiando una sola cosa:
el arroz se compra a **`1,20`** y su costo de uso sigue siendo **`1,00`**.

**Por qué hace falta un caso propio.** En CC-011 el precio pagado y el de referencia coinciden a
propósito, así que la varianza de precio es **cero por construcción** y la identidad parece valer en
dólares. En cuanto dejan de coincidir —que es el caso normal— **en dólares deja de valer**, y lo que
queda en pie es la de cantidades.

**Entrada** — los ocho movimientos de CC-010 con los importes recalculados a `1,20`:

| # | Tipo | Cantidad | `total_cost` |
|---|---|---|---|
| 1 | `COMPRA` | `+100` | `120.00` |
| 2 | `COMPRA` | `+50` | `60.00` |
| 3 | `COMPRA` (la corrección) | `−50` | `60.00` |

El resto del mes no cambia: transferencia `−20`, producción `−8`, merma `−2,5`, ajuste `+0,5`,
consumo por venta `−22`; conteo de febrero `40 kg`, de marzo `86 kg`, costo de uso `1,00`.

**Resultado esperado**

| Salida | Esperado | De dónde sale |
|---|---|---|
| `varianza_uso_kg` | **`4`** kg | `−(−2,00) − (−2,00)` — **igual que en CC-011**: el precio no mueve un kilo |
| `varianza_uso` | **`4.00`** | `4 kg × 1,00` |
| `varianza_precio` | **`20.00`** | `(120 − 100) + (60 − 50) + (−60 + 50)`, con el signo de cada movimiento |
| `CONSUMO_REAL` | **`46.00`** | `40,00 + 120,00 − 20,00 − 8,00 − 86,00` |
| **`VARIANZA_TOTAL`** | **`24.00`** | `46,00 − 22,00`, y también `4,00 + 20,00` |

**Las aserciones que discriminan**

| # | Aserción | Qué implementación mata |
|---|---|---|
| 1 | `varianza_uso_kg` vale `4` **igual que en CC-011** | La que mete el precio en la identidad: comprar más caro no gasta más kilos |
| 2 | `varianza_uso + varianza_precio = varianza_total`, al centavo | La que enseña una de las dos y llama a eso «la varianza» |
| 3 | La **corrección** aporta `−10.00` a la varianza de precio | La que suma los importes sin el signo del movimiento — la cara de INC-029 en esta cuenta |
| 4 | Con el precio **igual** al de referencia (CC-011), `varianza_precio = 0.00` exacto | La que arrastra un residuo de división y lo enseña como «diferencia de precio» de un centavo |

La cuarta es la que obliga a conservar CC-011 además de este: **el caso base tiene que seguir dando
precio cero**, o el desglose de cuatro líneas enseñaría ruido en la pantalla 25 todos los meses.

> **Construcción:** la fórmula y las dos pruebas 🔴 son de **P16-J**, junto con el resto de D-16.202.
> El caso se escribe antes, que es el orden de CLAUDE.md §8.

---

### Lo que cierra la clase, y no solo la instancia

Tres piezas, no una:

1. **La definición vive en el dominio** (`inventory/domain/agregados.ts`) y no dentro de una
   consulta. Antes, el único sitio donde estaba escrito qué significa `compras_del_mes` era SQL.
2. **Los tres casos están aquí, con su número esperado**, calculados antes que el pliegue.
3. **Una prueba de integración exige que el `SUM` de PostgreSQL y el pliegue del dominio den el
   mismo número** sobre el mismo libro — el mismo criterio que P6 fijó para el saldo, ahora también
   para el dinero. Si una consulta futura olvida el signo, falla ahí.

## Cobertura — estado tras P5

Los nueve casos escribibles hoy están escritos. **CC-004 a CC-007 y CC-009 se redactaron en la fase PLAN de P5, antes de tocar el motor**, y el motor se implementó contra ellos.

| Caso | Qué cubre | Estado | Procedencia del número esperado |
|---|---|---|---|
| CC-001 | Producto simple, un ítem, base EP, rendimiento 1.0 | ✅ | `V_COSTEO` fila 6 |
| CC-002 | Rendimiento < 1 (el costo neto **sube**) + línea `EXCLUIDA` + subpreparación | ✅ | `V_COSTEO` fila 11 |
| CC-003 | Rendimiento por lote > 1 porción + IVA de compra recuperable | ✅ | `V_COSTEO` fila 23 |
| CC-004 | **El mismo ítem en base AP y en base EP** — resultados distintos, ambos correctos (R4) | ✅ P5 | Mitad `EP` del Excel; mitad `AP` a mano desde SPEC §13 |
| CC-005 | **Subpreparación anidada** costeada en cascada | ✅ P5 | Reproduce el `0.20` escrito a mano del Excel y el `1.098548462` de `V_COSTEO` |
| CC-006 | **Combo** de dos productos simples | ✅ P5 | Suma de dos `COSTO_TOTAL_UNIDAD` de `V_COSTEO` |
| CC-007 | `iva_recuperable = false`: sube exactamente el IVA **de cada precio** | ✅ P5 | Los once ítems de CC-003 con sus tres tasas |
| CC-008 | Cuadrante de menu engineering con índice de popularidad **exactamente 1** | ⬜ P8 | Menu engineering es SPEC §15, y llega con las vistas |
| CC-009 | Los cuatro bordes que no pueden dividir por cero | ✅ P5 | Guardas de SPEC §12 y §14, más la del PVP ausente |
| CC-010 | **`compras_del_mes`** y las cantidades de §18, sobre un mes con todo el vocabulario del libro | ✅ P16-I | A mano, antes del pliegue. El Excel cubre la fórmula, no el resultado |
| CC-011 | **`CONSUMO_REAL`** y su varianza, con el desglose de tres líneas | 🟡 **escrito con D-16.202; el sistema lo cumplirá en P16-J** | A mano. Hoy el sistema da 54,00/32,00 y su prueba lo ancla |
| CC-012 | **El inventario valorizado** del mismo mes: stock teórico, diferencia, reorden y cobertura | ✅ P16-I | A mano, sobre las cantidades que CC-010 pliega |
| CC-013 | **La varianza partida en uso y precio**: el mes de CC-011 pagando el arroz a 1,20 con costo de uso 1,00 | ⬜ **P16-J** | A mano: 24,00 = 4,00 de uso + 20,00 de precio |
| **R15** | La identidad **en cantidades** `varianza_uso_kg = −mermas_y_ajustes_kg − diferencia_kg`, y la suma `uso + precio` en dinero | ⬜ **P16-J** | Álgebra: se despeja el stock teórico dentro del consumo real; el precio sale aparte |
| CC-R7 | Conciliación = 0 | 🟡 P0 con aritmética · **P5 a través del motor** · dataset completo en P8 |

### Qué cambió en P5 respecto de lo que esta tabla decía antes

**CC-004 ya no depende de un número que nadie más haya calculado.** Se pensó como un caso íntegramente construido; se escribió partiendo de `INS-113`, cuya mitad `EP` **el Excel ya tiene calculada** (`0.4615384615`). Lo único a mano es la mitad `AP`, que es una multiplicación por `0.20`. La advertencia del ítem B2 de `FASE0-CHECKLIST` —«no debe calcularlo quien escriba después la aritmética que lo verifica»— queda cubierta por esa mitad corroborada, y no por confiar en mi cuenta.

**P6 no añade ningún caso conocido, y es correcto que no lo haga.** Los casos de este archivo verifican **fórmulas del Excel**, y el libro de inventario no calcula ninguna: registra hechos y los suma. Lo que P6 sí aporta a esta lista es el dataset que **CC-R7 con dataset completo** necesitará en P8 —compras reales, mermas y consumo— y que hasta ahora no existía.

**CC-R7 subió de nivel.** En P0 corría con aritmética suelta sobre valores de `V_COSTEO`. En P5 **corre a través del motor**: los `costo_por_porcion`, `venta_neta` y `margen_contribucion` ya no se transcriben, los produce `costearProducto` a partir de los ítems y las líneas. La versión con el dataset completo y el inventario real sigue siendo de P8, que es donde existen las compras y el conteo físico.

**CC-002 dejó de tener un valor escrito a mano.** Su línea `INS-131` valía `0.20` porque el Excel lo tenía así. Con CC-005, esa `0.20` la produce la cascada desde una receta, y el resto de CC-002 no se mueve ni un decimal. Es la prueba de que la cascada no cambió la respuesta, solo su origen.

**P7 tampoco añade casos, y el motivo es distinto del de P6.** No es que el conteo no calcule nada —calcula el `CONSUMO_REAL` de SPEC §16, que es una fórmula del Excel—: es que **el Excel no tiene dimensión temporal** (SPEC §3). Todo es «del mes», un único período implícito, así que no hay una celda con un consumo real de marzo contra la que contrastar el consumo real de marzo.

Lo que sí se prueba, con cifras concretas calculadas a mano en la suite de integración, es la aritmética completa de la cadena: `inicial + compras − final físico`, encadenada entre dos meses, con un conteo parcial y su cobertura. La verificación **contra el Excel** llega con P8, cuando existan las unidades vendidas y `venta_neta_mes` cierre la fórmula.

**Y P7 aporta a CC-R7 lo que le faltaba después de P6.** El dataset completo necesita `inventario_inicial_valorizado` e `inventario_final_fisico`, y esos dos números no existían: son el conteo confirmado del mes anterior y el de este. Ahora existen, congelados, y encadenados.

---

## Lo que P8 cierra, y lo que deja abierto

**CC-R7 llega al nivel que le faltaba desde P0.** Corría con aritmética suelta, luego a través del motor (P5), y ahora **a través del sistema entero**: catálogo, precios con vigencia, receta, motor de costeo, unidades vendidas del mes y libro de inventario. Los dos caminos de SPEC §16 se recorren de punta a punta y la diferencia da `0.00`.

Y hay una segunda versión, que es la que importa: **la misma conciliación con un producto de rendimiento 2**. Con rendimiento 1 los dos caminos coinciden aunque el consumo esté mal —es lo que dejó pasar un fallo durante dos paquetes—, así que el caso de aceptación real es el que tiene rendimiento distinto de uno.

**CC-008 se cierra**: el cuadrante de menu engineering con índice de popularidad exactamente 1. Está probado en las dos capas —dominio y HTTP— y el valor esperado no sale del código: sale de resolver `popularidad × n / regla = 1` a mano y elegir 210 unidades de 900 con tres productos activos.

**Lo que P8 no puede cerrar, y ahora se sabe exactamente por qué:** las seis vistas no se contrastan contra el Excel celda a celda porque **el Excel no tiene ninguna unidad vendida cargada**. `T2_PRODUCTOS.H` vale cero en los 48 productos, así que menu engineering, food cost real y punto de equilibrio están **en cero en el propio Excel**. No hay número esperado que copiar.

Lo que sí se hizo, leyendo el archivo: **verificar sus fórmulas una a una.** Coinciden con lo implementado en todo salvo dos puntos, los dos documentados:

| | Excel | Aquí | Por qué |
|---|---|---|---|
| Consumo teórico | `F × unidades / rendimiento_porciones` | igual | ✅ Confirma la corrección de P8 |
| Rendimiento del ÍTEM en el consumo | **no lo aplica** | no lo aplica | ✅ Cierra la duda de P6 |
| Base AP/EP en el consumo | **no la distingue** | no la distingue | ✅ |
| `mermas_ajustes` | en positivo, se resta | con signo, se suma | ✅ equivalente |
| Movimientos de consumo | **no existen** en T5 | se excluyen del agregado | ✅ |
| Punto de reorden | `R/dias_operativos × dias_cobertura` | igual | ✅ |
| Conciliación R7 | `ROUND(teorico − v_costeo, 2)` | igual | ✅ |
| Inventario final sin conteo | **cero** | el teórico | ⚠️ divergencia deliberada, **D7** |
| MC promedio | **`AVERAGE`, media simple** | ponderado | ⚠️ **el SPEC dice «no la media simple»** |

El último es la única contradicción encontrada entre el SPEC y su fuente, y está anotado como duda para el usuario.

---

## CC-014 — Un insumo sin precio a la fecha del lote (INC-032, D 2026-09-25)

**Qué prueba:** que la producción **se detiene** cuando un insumo no tiene precio de referencia
vigente a la fecha del lote, en vez de valorarlo en `0,00` y seguir.
**Origen:** construido, a partir del caso real que lo destapó — producir desde la pantalla 21 con
fecha 2026-09-16, cuando los cinco insumos comprados tenían su precio vigente **desde después**.

### El número que estaba mal

Lote de `2 kg` de salsa a un estándar de `8,00/kg`, con camarón a `8,695652/kg` del que se usan
`1,3 kg`:

| Magnitud | Antes (mal) | Esperado |
|---|---|---|
| Costo estándar del lote | `16,00` | `16,00` |
| Costo real del lote | **`0,00`** | `11,30` |
| Varianza de R10 | **`−16,00`** | `−4,70` |
| Lectura para el dueño | **«producir salió gratis, ahorré 16 dólares»** | «el lote salió más barato que el estándar» |

**La cifra mala no es fea: es plausible.** Una varianza negativa es exactamente lo que enseña una
cocina eficiente, así que nada en pantalla delata que faltaba un precio.

### Lo que se exige ahora

| Entrada | Resultado esperado |
|---|---|
| Un insumo **sin** precio vigente al `occurred_at` del lote | **`400 ENTRADA_INVALIDA`**, con el **nombre del insumo** y la **fecha** en el mensaje |
| El libro (`inventory_movement`) | **cero filas** para ese lote |
| La cabecera (`inventory_production`) | **cero filas** |
| Un insumo **con** precio vigente | se registra, y la varianza sale de costos reales |

> **Por qué cero filas y no «una fila marcada»:** el libro es append-only (R3). Lo que entra mal
> valorado no se edita; solo se puede compensar con otro movimiento. La única oportunidad de no
> tener una cifra falsa en el libro es **no escribirla**.

**Es la misma regla que ya existía del otro lado.** Producir un ítem cuyo *estándar* falta ya se
rechazaba (`SIN_ESTANDAR`). Lo que INC-032 destapó es que se aplicaba a un solo lado.
