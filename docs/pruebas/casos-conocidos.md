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

## Cobertura restante antes de implementar P5

CC-001 a CC-003 cubren ya los casos base, la condicional AP/EP por el lado EP, el rendimiento < 1, la línea excluida, el rendimiento por lote y el IVA recuperable. Faltan estos, que se escriben **antes** de tocar el motor:

| Caso | Qué debe cubrir | Estado |
|---|---|---|
| CC-001 | Producto simple, un solo ítem, base EP, rendimiento 1.0 | ✅ `PRD-001` |
| CC-002 | Rendimiento < 1 (el costo neto **sube**) + línea `EXCLUIDA` + subpreparación | ✅ `PRD-006` |
| CC-003 | Rendimiento por lote > 1 porción + IVA de compra recuperable | ✅ `PRD-018` |
| CC-004 | **El mismo ítem en base AP y en base EP** — resultados distintos, ambos correctos (R4) | ⬜ P5. **Ojo: el Excel no tiene ni una línea en base AP**; hay que construirlo derivando de CC-002 y calcular el valor esperado a mano desde la fórmula del SPEC §13 |
| CC-005 | **Subpreparación anidada**: un ítem `PRODUCIDO` con receta propia dentro de otra receta, costeado en cascada | ⬜ P5. Parte de `INS-131` de CC-002, que hoy tiene costo escrito a mano |
| CC-006 | **Combo**: dos productos simples con porciones reducidas | ⬜ P5. Candidatos reales en el Excel: `PRD-038`, `PRD-039`, `PRD-040`, `PRD-048` |
| CC-007 | `iva_recuperable = false`: el costo sube exactamente el porcentaje del IVA | ⬜ P5. Se deriva de CC-003, que ya tiene ítems con IVA `0.15` |
| CC-008 | Cuadrante de menu engineering con índice de popularidad **exactamente 1** | ⬜ P8 |
| CC-009 | Producto con rendimiento 0: no debe dividir por cero | ⬜ P5. Borde, no hay caso real en el Excel |
| CC-R7 | Conciliación = 0 con dataset completo | 🟡 versión reducida en P0; completa en P8 |

> **Advertencia sobre CC-004.** Es el caso que cubre la regla R4, la condicional más frágil del modelo, y **no se puede extraer del Excel**: las 293 líneas de `T3_RECETAS` están todas en base `EP`. Hay que construirlo y calcular su valor esperado a mano desde `docs/SPEC.md` §13, antes de escribir el motor. Es el ítem B2 de `docs/FASE0-CHECKLIST.md` y no debe hacerlo quien escriba después la aritmética que lo verifica.
