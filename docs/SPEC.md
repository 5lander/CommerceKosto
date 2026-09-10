# SPEC.md — Especificación funcional y fórmulas

> **Fuente de verdad de la lógica de negocio:** `Modelo_Costeo_Auditado_SNACKLAB.xlsx`, leído y verificado celda por celda.
> Las fórmulas de la Parte III están extraídas del Excel, no derivadas de memoria. **No las simplifiques ni las reinterpretes al implementar.**
> Lo que se aparta del Excel está marcado explícitamente como extensión.

Estado: modelo de datos y fórmulas cerrados · stack pendiente de verificar versiones

---

# PARTE I — ARQUITECTURA

## 1. Tenencia y aislamiento

| Decisión | Valor |
|---|---|
| Relación tenant ↔ company | **Tenant = company.** 1 comercio = 1 tenant. Sin nivel intermedio. |
| Llave de aislamiento | `company_id` en toda tabla de negocio |
| Mecanismo | RLS deny-by-default en PostgreSQL |
| Acceso del back office | Conexión privilegiada que puentea RLS |

**Riesgo asumido en el back office.** Se eligió la ruta privilegiada por encima de la
recomendación (cuenta de usuario dentro del tenant). Condiciones obligatorias:

1. La conexión privilegiada vive **solo** en el proceso del back office, inalcanzable
   desde la aplicación cliente por cualquier ruta.
2. Pool de conexiones **separado** del de la app cliente.
3. Todo acceso cross-tenant en un log **append-only**: usuario, company, motivo, timestamp.

Un fallo de autorización en el back office expone a todos los tenants a la vez.

> **Nota técnica pendiente de resolver.** RLS requiere fijar el tenant por transacción
> (`SET LOCAL`). Con un ORM que usa pool de conexiones esto no es automático: hay que
> envolver cada operación en una transacción que fije el tenant. Si un desarrollador
> olvida el wrapper, la consulta corre sin aislamiento. Debe resolverse con una capa
> obligatoria, no con disciplina.

## 2. Ubicaciones

No existe "sucursal" a secas. Existe **ubicación** con tipo: `BODEGA` (compra y
almacena, no vende) · `LOCAL` (vende) · `AMBOS`.

Una bodega modelada como sucursal aparece con ventas en cero y contamina todo reporte
comparativo. N ubicaciones por company. Inventario independiente por ubicación.

## 3. Períodos

**Extensión necesaria: el Excel no tiene dimensión temporal.** Todo es "del mes", un
único período implícito.

El SaaS necesita períodos explícitos con cierre. El conteo físico congela un corte y el
food cost real se calcula contra ese corte. Sin períodos no hay comparación mes a mes ni
auditoría posible.

## 4. Roles y permisos

Permisos como capacidades, no como roles rígidos.

| Rol | Alcance | Puede |
|---|---|---|
| `OWNER` | Company | Todo + suscripción + eliminar company. Único. |
| `ADMIN` | Company | Todo lo operativo. **Sin límite de cantidad.** Propaga recetas entre locales. No puede eliminar la company ni al owner. |
| `GERENTE_LOCAL` | Su ubicación | Recetas, inventario, ventas y precios de su local. **No propaga a otros locales.** |
| `BODEGA` | Su ubicación | Compras, recepción de transferencias, conteo físico, alta de artículos de compra. |
| `LECTURA` | Configurable | Solo consulta. Para contadores. |

### Confidencialidad de recetas frente al rol BODEGA

Decisión confirmada: la receta es **secreto de negocio real**, no ruido de pantalla.

Consecuencia que hay que implementar completa, porque ocultar la pantalla de recetas no
alcanza. Estos datos permiten **despejar la receta por aritmética** y deben estar
ocultos para BODEGA:

- Consumo teórico por insumo (`consumo ÷ unidades vendidas` = cantidad de la receta)
- Stock teórico (`inicial + compras − consumo`, de donde se despeja el consumo)
- Diferencia entre teórico y físico, y su valorización
- Punto de reorden (se calcula desde el consumo teórico)
- Costo de plato y cualquier vista de costeo

**El filtrado va en la API, no en el frontend.** Un campo que el backend devuelve y la
UI esconde no es confidencial.

**Efecto colateral favorable:** BODEGA cuenta a ciegas, sin saber cuánto debería haber.
Es la práctica correcta de control interno — quien conoce el número esperado tiende a
ajustar el conteo hacia él. La restricción de confidencialidad mejora la calidad del
dato de inventario.

Para reposición, BODEGA recibe un **semáforo** (`REPONER` / `OK`) sin la cantidad que lo
origina.

---

# PARTE II — MODELO DE DATOS

## 5. Ítems, artículos de compra y preparaciones

### Los cuatro tipos del Excel

T1_INSUMOS clasifica sus 149 filas en: `INS` (113), `SUB` (24), `SUP` (8), `LNK` (4).

- **`INS`** → ítem `COMPRADO`.
- **`SUB`** → subpreparaciones. **El propio LEEME las declara como deuda conocida:**
  *"tienen costo escrito a mano y no se recalculan si sube un insumo. Cada una debería
  tener su propia receta."* En el SaaS son ítems `PRODUCIDO` con receta propia y costo
  derivado en cascada. Esto resuelve un problema real del modelo actual.
- **`SUP`** → no es un tipo de ítem, es un **nivel de confianza del precio**: los ocho
  insumos estimados sin factura de respaldo. Va como campo `confianza_precio`.
- **`LNK`** → **pendiente de aclarar con el usuario.** No documentado en el LEEME.

### Estructura

**Ítem** — lo único que ve quien arma una receta. Unidad de uso, rendimiento, precio de
referencia. Tipo `COMPRADO` (entra por compra) o `PRODUCIDO` (entra por producción).

Las líneas de receta apuntan a ítems sin distinguir tipo, lo que habilita recursión.
**Validación obligatoria de referencias circulares al guardar, no al calcular.**

**Artículo de compra** — lo único que ve quien registra una compra. Marca, presentación,
proveedor, factor de conversión, precio. Muchos artículos → un ítem.
Regla de producto: en recetas aparece solo el ítem; las marcas solo en compras.

**Preparaciones producidas** — `Mayonesa` (comprada) y `Mayonesa casera` (producida) son
ítems distintos, elegidos explícitamente en la receta.
Interruptor por preparación: **con stock** (se produce en lote, aparece en inventario) o
**sin stock** (al vender se explota su receta y se descuentan sus insumos). El costeo es
idéntico en ambos casos.

## 6. Precios de referencia

**Ningún precio se mueve solo. Todos se sugieren; el usuario confirma.**

Fila con vigencia (`valid_from`), nunca campo sobrescrito. Campo `origen`:
`MANUAL` | `ULTIMA_COMPRA` | `EXTERNO`.

La preparación producida tiene **costo estándar fijo** definido por el usuario, para que
el plato no cambie de costo según cuánto se produjo ese día. El costo real de cada lote
queda en el movimiento de producción; la diferencia es varianza de producción.

### Fuentes externas — Tipti descartado como fuente

- Son precios de retail al consumidor, no de compra. Los clientes compran mezclado entre
  mayorista y supermercado, de modo que ninguna fuente única sería correcta.
- No consta API pública para terceros. **Verificar con su equipo comercial:** acceso bajo
  contrato, términos de uso, y si permiten redistribuir precios dentro de un producto de
  terceros.
- Vía scraping: incumplimiento probable de términos, dependencia frágil en el camino
  crítico, mantenimiento permanente.

`origen = EXTERNO` deja la puerta abierta sin acoplar nada.

## 7. Inventario

**Libro mayor append-only.** No hay campo `stock` mutable. Stock y costos son
proyecciones sobre el libro.

Movimientos: `COMPRA` · `TRANSFERENCIA_SALIDA` / `TRANSFERENCIA_ENTRADA` ·
`PRODUCCION` · `MERMA` · `AJUSTE` · `CONSUMO_POR_VENTA`

> Transferencias y producción **no existen en T5 del Excel**. Son extensiones deliberadas.

Sin lotes ni vencimientos en Fase 1; el libro admite capas de lote más adelante sin
migrar historial.

**Granularidad:** stock por ítem, en unidad de uso. El desglose por marca es vista
informativa derivada del libro, no saldo que se descuente. Confirmado: en conteo físico
se cuenta el total del insumo.

## 8. Productos de venta

**La unidad de costeo es la porción, no el plato.** "Arroz con carne (segundo)" y
"(plato fuerte)" son productos distintos: distinta receta, categoría, PVP y margen. Sin
jerarquía padre-hijo — el padre no tendría atributos propios. Campo opcional de
agrupación (etiqueta simple) para reportes de consumo.

Tipos: `SIMPLE` (receta a ítems) · `COMBO` (componentes que son productos simples).
El combo usa las porciones reducidas, no los productos de carta.

**Menu engineering:** el combo compite como ítem propio. El descuento **no se prorratea**.

Alcance por ubicación:
- `producto` — catálogo maestro de la company
- `producto_ubicacion` — activación, PVP y rendimiento por lote, por local
- `receta` — por par (producto, ubicación)

El maestro arriba permite comparar entre locales con un `GROUP BY producto_id` en vez de
matching por nombre.

## 9. Recetas entre locales

Copia independiente con **propagación explícita**. Sin vínculo permanente.
"Aplicar a todos" **sobrescribe la receta completa** en las demás ubicaciones.

Obligatorio: **previsualización** (cuántos locales, cuáles personalizados, con opción de
destildar) · **permiso separado** de nivel company · **registro de quién propagó qué**
con reversión por local.

Recetas versionadas por vigencia: la propagación crea versión nueva con fecha de hoy. Los
costeos históricos no se recalculan.

## 10. Carga de datos

Tres vías en Fase 1: importación Excel/CSV · digitación por el cliente · carga por el
operador del back office.

**La importación es un paquete de trabajo propio, no un endpoint.** Requiere validación
con previsualización, detección de duplicados por similitud ("Tomate riñón" / "tomate
riñon" / "TOMATE") y resolución de unidades **antes** de escribir.

**Unidades vendidas: digitación manual en Fase 1.** Decisión confirmada.

> **Riesgo de producto.** De este único dato dependen tres de las seis vistas (menu
> engineering, punto de equilibrio, consumo teórico). Digitar 48 productos por local cada
> mes es donde el sistema se abandona. La pantalla de carga debe optimizarse para eso:
> una grilla con el mes anterior precargado, no un formulario por producto. La
> importación CSV de ventas debería llegar pronto aunque no sea Fase 1.

---

# PARTE III — FÓRMULAS (extraídas del Excel)

Notación: los nombres son de la especificación, no del Excel.

## 11. Parámetros (hoja PARAMETROS)

Toda la lógica lee de aquí. En el SaaS son configuración **por company**.

| Parámetro | Valor en el Excel | Uso |
|---|---|---|
| IVA de venta | 0.15 | Los PVP están CON IVA. El food cost se calcula sobre venta neta. |
| IVA de compra recuperable | SI | Si SI, el IVA pagado no es costo. Si NO, el costo sube. **Es el único parámetro de IVA de compra que vive en la company** (R13). |
| Provisión de merma no atribuible | 0.02 | Solo lo que el rendimiento por ingrediente NO explica. |
| Food cost objetivo mínimo | 0.25 | |
| Food cost máximo aceptable | 0.32 | Sobre esto, semáforo rojo. |
| Umbral verde | 0.28 | |
| Prime cost máximo | 0.65 | Food cost + mano de obra sobre venta neta. |
| Días operativos al mes | 22 | |
| Días de cobertura objetivo | 7 | Define el punto de reorden. |
| Regla de popularidad | 0.70 | Estándar Kasavana-Smith. |

> **La TARIFA de IVA de compra NO es un parámetro de la company** (P16-A1, D-16.9). El Excel
> la traía por insumo en `T1`, y en el SaaS vive en **dos niveles**: en el **artículo de compra**
> (obligatoria: la factura del saco de harina dice 0 % y la del detergente 15 %) y, para las
> compras sin artículo, en el **grupo del ítem** (opcional). Por encima de los dos, la que traiga
> la propia petición o fila del archivo. **Nunca hay un valor por defecto**: sin tarifa en ningún
> nivel, la compra —o el precio de referencia— se rechaza y el mensaje dice dónde ponerla.
> `company_settings.iva_compra` dejó de leerse (D-16.43) y se retira en P16-B.

> **Por qué la merma es 2% y no 4%** (nota del autor en el Excel): antes un único 4%
> cubría cáscara, hoja botada, derrame y error de pase. Ahora cada insumo declara su
> rendimiento en T1 y el costo neto lo absorbe ahí. El 2% es solo lo que ningún
> rendimiento explica. **Sumar 4% además del rendimiento cobraría la merma dos veces.**

## 12. Costo del insumo (T1)

```
precio_neto      = iva_recuperable ? precio_compra / (1 + iva_compra) : precio_compra
costo_bruto_uso  = factor_conversion = 0 ? 0 : precio_neto / factor_conversion
costo_neto_uso   = rendimiento = 0 ? 0 : costo_bruto_uso / rendimiento
sobrecosto_merma = costo_neto_uso - costo_bruto_uso
```

Dividir por el rendimiento **encarece** el insumo: es el costo de comprar producto que
se pierde al limpiarlo.

**De dónde salen `iva_compra` e `iva_recuperable` (P16-A1, D-16.9):**

```
iva_compra      = tarifa de la petición ?? tarifa del artículo de compra ?? tarifa del grupo del ítem
                  (sin ninguna: ERROR — nunca se asume una tarifa)
iva_recuperable = company_settings.iva_compra_recuperable   (R13; nunca por ítem)
```

**Una preparación (`PRODUCIDO`) no entra en esa precedencia: su `iva_compra` es 0** (D-16.51). Su
precio de referencia es el costo estándar por unidad de uso (R10), que ya es neto —sale de insumos
neteados uno a uno— y netearlo otra vez lo dejaría dividido entre `1 + tarifa`. Nace con 0 ignore lo
que diga su grupo; cualquier otra tarifa en la petición o en la fila se rechaza.

**La misma primera línea netea el libro de inventario.** El bodeguero teclea el **total de la
factura con IVA** (`total_bruto`), y cada `COMPRA` persiste los cuatro importes (D-16.10):

```
total_cost               = iva_recuperable ? total_bruto / (1 + iva_compra) : total_bruto
iva_tarifa_aplicada      = iva_compra en el momento de la compra
iva_recuperable_aplicado = iva_recuperable en el momento de la compra
desglose_conocido        = true
```

Son la **foto del momento**: cambiar el ajuste después no reescribe el libro (D-16.42). Las
`COMPRA` anteriores a P16-A1 quedan con `desglose_conocido = false` y `total_cost` tal como se
tecleó; no se rellenan (D-16.18). `compras_del_mes` (§16) sigue sumando `total_cost`.

```
consumo_teorico_mes = Σ(consumo_mes de las líneas de receta que usan este ítem)
punto_de_reorden    = consumo_teorico_mes / dias_operativos × dias_cobertura
```

## 13. Costo de la línea de receta (T3)

```
costo_linea = estado = "ACTIVA"
              ? cantidad × (base = "EP" ? costo_neto_uso : costo_bruto_uso)
              : 0
```

> ⚠ **La condicional más frágil del modelo.** Si la cantidad está expresada en EP
> (producto ya limpio) se aplica el rendimiento; si está en AP (tal como se compra), no.
> Implementarla al revés produce números plausibles y equivocados en las 293 líneas.
> Requiere prueba unitaria dedicada con ambos casos.

```
pct_del_producto = costo_linea / Σ(costo_linea del mismo producto)
```

## 14. Costeo del producto (V_COSTEO)

```
costo_bruto_lote  = Σ(cantidad × costo_bruto_uso)   [solo líneas ACTIVA]
costo_neto_lote   = Σ(costo_linea)                  [solo líneas ACTIVA]
costo_por_porcion = rendimiento = 0 ? 0 : costo_neto_lote / rendimiento_porciones
costo_con_merma   = costo_por_porcion × (1 + merma_no_atribuible)
empaque_neto      = iva_recuperable ? precio_empaque / (1 + iva) : precio_empaque
COSTO_TOTAL_UNIDAD = costo_con_merma + empaque_neto

venta_neta   = pvp_con_iva / (1 + iva_venta)
iva_en_precio = pvp_con_iva - venta_neta
MARGEN_CONTRIBUCION = venta_neta - costo_total_unidad
mc_pct        = margen_contribucion / venta_neta
FOOD_COST_PCT = costo_total_unidad / venta_neta
suma_control  = mc_pct + food_cost_pct        → debe dar 1
multiplicador = venta_neta / costo_total_unidad
impacto_merma = costo_bruto_lote = 0 ? null : costo_neto_lote / costo_bruto_lote - 1

venta_neta_mes = venta_neta × unidades_mes
mc_mes         = margen_contribucion × unidades_mes
```

## 15. Menu engineering (V_MENU_ENGINEERING · Kasavana-Smith)

```
popularidad       = unidades_producto / total_unidades_todos
indice_popularidad = popularidad / (1 / n_productos_activos) / regla_popularidad
```

Con `regla_popularidad = 0.70`, el índice ya viene normalizado: **`índice ≥ 1` significa
popular.**

| | MC ≥ MC promedio | MC < MC promedio |
|---|---|---|
| **índice ≥ 1** | ESTRELLA | CABALLO |
| **índice < 1** | ROMPECABEZAS | PERRO |

Producto inactivo → `—`. Producto activo con 0 unidades → `SIN DATOS`.
El MC promedio es el del total de la vista de costeo, no la media simple.

## 16. Food cost real y varianza (V_FOOD_COST_REAL)

```
inventario_inicial_valorizado = Σ(stock_inicial × costo_neto_uso)
compras_del_mes               = Σ(costo_total de movimientos tipo COMPRA)
inventario_final_fisico       = Σ(conteo_fisico × costo_neto_uso)

CONSUMO_REAL    = inicial + compras - final_fisico
CONSUMO_TEORICO = Σ(consumo_teorico_mes × costo_neto_uso)

VARIANZA_USD = consumo_real - consumo_teorico
varianza_pct = varianza_usd / consumo_teorico     → sobre 5% es problema de proceso
```

```
food_cost_teorico_pct = consumo_teorico / venta_neta_mes
food_cost_real_pct    = consumo_real / venta_neta_mes
brecha_en_puntos      = (real_pct - teorico_pct) × 100
```

```
empaque_teorico_mes = Σ(empaque_neto × unidades_mes)
provision_merma_mes = Σ(costo_por_porcion × merma_no_atribuible × unidades_mes)
costo_ventas_teorico = consumo_teorico + empaque_teorico + provision_merma
costo_ventas_v_costeo = venta_neta_mes_total - mc_mes_total
DIFERENCIA_CONCILIACION = ROUND(costo_ventas_teorico - costo_ventas_v_costeo, 2)
```

> ✅ **`DIFERENCIA_CONCILIACION` debe dar exactamente 0.**
> Convertir en prueba automatizada que corre en cada build. Es la mejor defensa contra un
> motor de costeo silenciosamente roto.

## 17. Punto de equilibrio (V_PUNTO_EQUILIBRIO)

```
venta_neta            = venta_neta_mes_total
costo_alimentos_empaque = venta_neta_mes_total - mc_mes_total
MARGEN_CONTRIBUCION   = mc_mes_total
costos_variables_adic = venta_neta × pct_variable_total   [de T6]
MC_NETO               = mc - costos_variables_adic
costos_fijos          = Σ(montos fijos de T6)
UTILIDAD_OPERATIVA    = mc_neto - costos_fijos
```

```
mano_de_obra = Σ(líneas de T6 cuyo concepto empieza por "Sueldos")
PRIME_COST   = costo_alimentos_empaque + mano_de_obra
prime_cost_pct = prime_cost / venta_neta          → objetivo ≤ 0.65
```

> El filtro por prefijo `"Sueldos*"` es frágil en el Excel. En el SaaS, T6 necesita un
> campo explícito de clasificación (`MANO_DE_OBRA` / `OTRO_FIJO` / `VARIABLE`) en vez de
> depender del texto del concepto.

```
mc_promedio_unitario = (mc_mes_total - costos_variables_adic) / unidades_totales
unidades_equilibrio_mes = mc_promedio ≤ 0 ? null : costos_fijos / mc_promedio_unitario
unidades_por_dia    = unidades_equilibrio_mes / dias_operativos
venta_neta_equilibrio = unidades_equilibrio × (venta_neta_total / unidades_totales)
venta_con_iva_equilibrio = venta_neta_equilibrio × (1 + iva_venta)
MARGEN_DE_SEGURIDAD = 1 - venta_neta_equilibrio / venta_neta
```

## 18. Inventario (V_INVENTARIO)

```
compras_mes     = Σ(cantidad de movimientos COMPRA del ítem)
mermas_ajustes  = Σ(cantidad de movimientos MERMA) + Σ(AJUSTE)
STOCK_TEORICO   = stock_inicial + compras - consumo_teorico - mermas_ajustes
diferencia      = conteo_fisico vacío ? null : conteo_fisico - stock_teorico
valor_diferencia = diferencia × costo_neto_uso
dias_cobertura  = consumo = 0 ? null : stock_teorico / (consumo_teorico / dias_operativos)
```

```
estado = consumo_teorico = 0      → "SIN CONSUMO"
       : stock_teorico < 0        → "FALTAN COMPRAS"
       : stock_teorico < reorden  → "REPONER"
       : "OK"
```

En el SaaS todo esto se calcula **por ubicación**, y el consolidado de company es la
agregación sobre ubicaciones.

---

# PARTE IV — ALCANCE Y PENDIENTES

## 19. Fase 1

Las 6 vistas completas. Nota de criterio: **las vistas no son la parte cara.** Si el
motor de costeo y el libro de inventario están bien construidos, son consultas sobre
datos que ya existen. El riesgo real de MVP está en la carga inicial de datos y en la
digitación mensual de unidades vendidas.

## 20. Advertencias de stack

Sin verificar versiones (pendiente de confirmar con fuentes actualizadas):

- **Next.js no tiene LTS.** Soporta la versión actual y la anterior, con ciclos de un
  año. Choca con el criterio de mantenibilidad a varios años. No es motivo para
  descartarlo, pero sí para no poner lógica de negocio en el frontend.
- **Prisma y RLS tienen fricción real** (ver nota en §1). Evaluar alternativas con
  control explícito de conexión antes de decidir.

## 21. Pendientes

| Tema | Estado |
|---|---|
| Qué representa el tipo `LNK` en T1 | **Pendiente del usuario.** 4 filas sin documentar. |
| Versiones LTS de Node, PostgreSQL, NestJS, ORM | Requiere verificación con fuentes actualizadas |
| Acceso a datos de Tipti | Verificar con su equipo comercial |
| Benchmark de precios entre clientes propios | Alternativa a Tipti para Fase 2. Sin decidir |
| Estrategia de migración desde el Excel actual | Sin abordar |
| Importación CSV de ventas | Fuera de Fase 1, pero riesgo de abandono si tarda |
