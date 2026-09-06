# ADR-011 — El consumo teórico, el rendimiento por lote, y lo que R7 destapó

| | |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-04 |
| **Paquete** | P8 — Vistas analíticas |
| **Contexto** | SPEC §14, §15, §16, §17 y §18 · R7 · CLAUDE.md §4.3 |

> **Qué decide este ADR.** Las siete cosas que P8 tuvo que resolver, y la primera es una **corrección de P6** que la conciliación R7 sacó a la luz en cuanto hubo un producto con rendimiento distinto de uno.

---

## 1. La receta es del LOTE; la venta, de PORCIONES

**Decisión.** El consumo teórico de un producto es `receta × (unidades vendidas ÷ rendimiento_porciones)`, no `receta × unidades vendidas`.

**Por qué.** SPEC §14 lo dice sin ambigüedad al definir el costo:

```
costo_por_porcion = costo_neto_lote / rendimiento_porciones
```

Si el costo del lote se divide entre las porciones, la receta describe **un lote**. Vender 100 porciones de un producto que rinde 2 consume **50** lotes, no 100.

### Verificado contra el Excel, después de escribir esto

La decisión se tomó razonando desde SPEC §14 y desde R7. **Después se leyó el Excel original**, y la fórmula está ahí, en la columna «Consumo mes» de `T3_RECETAS`:

```excel
N6 = IF($K6<>"ACTIVA", 0,
        F6                                   ← cantidad de la receta
        * INDEX(T2_PRODUCTOS!$H, MATCH(...))  ← unidades vendidas del mes
        / INDEX(T2_PRODUCTOS!$E, MATCH(...))) ← rendimiento en PORCIONES
```

`T2_PRODUCTOS.E` es «Rendimiento (porciones)» y `T2_PRODUCTOS.H` es «Unidades vendidas mes». **El Excel divide.** No era una interpretación: era la fórmula.

**Y el tamaño del fallo, medido en la carta real del cliente: 11 de sus 48 productos tienen rendimiento distinto de 1**, con valores de 8, 11, 15, 16, 18, 24, 30 y **185**. Casi una cuarta parte de la carta, y en el caso extremo cada venta habría descontado del inventario **185 veces** lo que sale de la bodega.

---

**Lo destapó R7, y solo pudo destaparlo R7.** La conciliación de SPEC §16 exige que

```
consumo_teorico_valorizado = costo_por_porcion × unidades
```

y eso solo se cumple si aquí se divide. Sin la división, con un rendimiento de 2 la conciliación daba **98,00** en vez de 0 sobre un caso de 102 dólares: el consumo teórico salía del doble.

**Por qué P6 no lo vio.** Porque `rendimiento_porciones = 1` es el único valor con el que multiplicar y dividir dan lo mismo, y **todos** los productos de las pruebas de P6 lo tenían en 1. Las 246 pruebas de integración de P0–P7 siguieron en verde después de la corrección: ninguna lo tocaba.

**Qué se rompía con la contraria, en producción.** `RegistrarConsumoPorVenta` descontaba del inventario `receta × unidades`: con un rendimiento de 4, cuadruplicaba la salida de cada insumo. El stock del libro se habría vaciado cuatro veces más rápido que la bodega real, y la diferencia habría aparecido en el conteo físico como una merma enorme e inexplicable.

**El caso `null` o cero.** Un producto sin rendimiento capturado **no consume nada**. Es lo coherente: SPEC §14 fija que su `costo_por_porcion` es cero, así que su consumo valorizado también tiene que serlo o R7 dejaría de cuadrar. El producto está a medio configurar y el sistema ya dice que su costo es cero.

> **No confundir con el rendimiento del ÍTEM.** Aquel es la fracción aprovechable tras la limpieza y vive en el **costo** (SPEC §12); este es cuántas porciones salen de un lote y vive en la **cantidad**.

### Y la misma lectura del Excel cierra la duda que P6 dejó abierta

Desde P6 estaba anotado que «la explosión del consumo **no** aplica el rendimiento del ítem», siguiendo SPEC §4.3, y quedó como duda a confirmar contra la fuente. **Confirmado: el Excel tampoco lo aplica.**

La misma fórmula `T3_RECETAS.N` usa `F6` —la cantidad de la receta— **tal cual**. El rendimiento del ítem, que en `T1_INSUMOS` es la columna `L`, aparece **solo** en el costo:

```excel
T1!M6 = IF(L6=0, 0, K6/L6)     ← costo neto de uso: AQUÍ sí divide por el rendimiento
T3!N6 = F6 * H / E             ← consumo del mes: aquí NO aparece L
```

**El rendimiento encarece la unidad, no aumenta la cantidad que sale de la bodega**, y es coherente: lo que se descuenta del inventario es lo que se saca del estante, y la merma de limpieza ya ocurrió dentro de ese kilo.

Un detalle más de la misma fórmula: `T3!N6` **tampoco distingue la base `AP`/`EP`**. El costo sí lo hace —`M6 = F6 * IF(G6="EP", J6, I6)`— pero el consumo físico es la cantidad de la receta en los dos casos. Es exactamente lo que `explotarConsumo` hace.

---

## 2. El índice de popularidad se calcula con **una sola división**

**Decisión.** `indice = (unidades × n_activos) / (total × regla)`, y **no** desde `popularidad`.

**Por qué.** La fórmula del SPEC encadena tres operaciones y cada una redondea a la escala 12. Con 210 unidades de 900 y tres productos activos, `210/900` da `0.233333333333`, y de ahí el índice sale **`0.999999999999`**.

Ese producto está exactamente en la frontera de popularidad. Con `0.999999999999` cae en `CABALLO` en vez de `ESTRELLA`: **un plato que sostiene la carta clasificado como uno que hay que rediseñar**, por un residuo en el decimal doce.

**Es el criterio de aceptación del paquete**, y la reordenación es lo que lo cumple: una única división, `630 / 630`, que da `1` exacto.

La `popularidad` se sigue devolviendo porque es un dato del SPEC, pero no participa en el cálculo del índice.

---

## 3. El MC promedio es **ponderado**, no la media simple

**Decisión.** `Σ(mc × unidades) / Σ(unidades)`.

**Por qué.** Lo dice el SPEC —«el MC promedio es el del total de la vista de costeo, no la media simple»— y la diferencia decide cuadrantes. Con dos productos, uno de 99 unidades y margen 1 y otro de 1 unidad y margen 101: la media simple da **51** y la ponderada da **2**. Con la simple, el plato que sostiene el negocio sería un `PERRO` —retirarlo de la carta—; con la ponderada es un `CABALLO` —trabajar su margen—.

Un producto **sin PVP** no entra ni en el numerador ni en el denominador: no tiene margen que promediar, y contarlo como cero bajaría el promedio de todos.

---

## 4. La mano de obra se identifica por **clasificación**, no por el texto

**Decisión.** `fixed_cost.classification` es una columna con `CHECK` y tres valores: `MANO_DE_OBRA`, `OTRO_FIJO`, `VARIABLE`.

**Por qué.** Es el propio SPEC §17 quien lo pide: en el Excel la mano de obra se filtra por el prefijo `"Sueldos*"` y la nota dice que «es frágil». Un concepto llamado «Nómina», «Salarios» o «Rol de pagos» quedaría fuera del prime cost sin que nada avisara — y el prime cost es el indicador que decide si un local es viable.

**El importe significa dos cosas, y lo dice el catálogo y no el nombre.** `VARIABLE` lo trae como **fracción de la venta neta** (`0.03` es 3 %) y las otras dos como **monto mensual**; `fixed_cost_classification.is_percentage` es quien lo declara. Dos columnas dejarían una siempre nula; dos tablas duplicarían el CRUD entero.

**`MANO_DE_OBRA` cuenta dos veces, y es correcto**: suma a `costos_fijos` —el sueldo se paga haya o no ventas— y a `prime_cost` —que es comida más gente—. No es un solapamiento por error: son dos preguntas distintas sobre el mismo dinero.

---

## 5. `CONSUMO_POR_VENTA` **no entra** en los agregados del libro

**Decisión.** El agregado que alimenta SPEC §18 excluye ese tipo de movimiento, y el consumo se resta una sola vez, calculado desde la receta.

**Por qué.** El Excel no tiene movimientos de consumo: lo calcula. Este sistema **sí puede tenerlos** (P6), y son exactamente el mismo consumo por el mismo camino —`explotarConsumo` usa la receta—. Sumarlos *y además* restar el consumo teórico lo descontaría dos veces, y el stock teórico saldría corto por el valor entero del consumo del mes.

**El invariante que lo fija:** el stock teórico da lo mismo esté o no registrado el consumo por venta. Hay una prueba de integración que corre las dos configuraciones sobre el mismo dato y exige que coincidan.

---

## 6. El signo del libro se **suma**, no se resta

**Decisión.** `stock_teorico = inicial + compras + mermas_ajustes + otros − consumo_teorico`, con `mermas_ajustes` llevando **el signo del libro**.

**Por qué.** SPEC §18 *resta* `mermas_ajustes` porque en el Excel las mermas se capturan en positivo. En este sistema el libro lleva el signo dentro de la cantidad (P6, ADR-009): una merma **ya es negativa**, y restarla la sumaría.

Es una traducción, no un cambio de fórmula. Y se devuelve con el signo del libro, no invertido para parecerse al Excel: **un número que se suma es un número que se suma.**

`otros` —transferencias y producción— no existe en el Excel: es la extensión de P6, y mueve el stock de esta ubicación igual que una compra.

---

## 7. `BODEGA` no recibe **ninguna** de las seis vistas

**Decisión.** `analytics.read` no se le concede. Solo `replenishment.read`, que sirve el semáforo `REPONER`/`OK` **sin la cantidad que lo origina**.

**Por qué.** Las cinco vistas llevan consumo teórico, stock teórico, diferencias y costos: cuatro de los seis datos prohibidos de CLAUDE.md §4.3. Es la tercera vez que aparece la misma asimetría —P6 le negó el saldo, P7 la conciliación, P8 las vistas enteras— y la razón es siempre la misma cadena:

```
stock teórico → consumo → cantidad de la receta
```

**El semáforo se sirve desde otro caso de uso y con otro tipo**, no filtrando la vista de inventario. `FilaDeReposicionDto` tiene tres campos y ninguno es una cantidad; es una interfaz propia y no un `Omit` sobre `ItemDelInventarioDto`, porque con un `Omit` un campo nuevo en la vista se publicaría aquí sin que nada avisara.

**`FALTAN_COMPRAS` y `REPONER` colapsan en uno**, y `SIN_CONSUMO` y `OK` en el otro. Que `BODEGA` pudiera distinguir «faltan compras» de «reponer» ya sería un dato sobre el stock teórico.

---

## 8. Dos sitios donde este sistema **se aparta** del Excel a propósito

Leer el Excel para verificar el punto 1 sacó a la luz dos divergencias que conviene tener escritas, porque las dos son deliberadas y ninguna estaba dicha.

### 8.1 El inventario final sin conteo: el Excel valora en **cero**

```excel
B8 = SUMPRODUCT((T1!$Q<>"") * IFERROR(T1!$Q,0) * T1!$M)
```

`Q` es el conteo físico. Si está vacío, el ítem aporta **cero** al inventario final — no su valor teórico.

**Aquí se hace lo contrario, y lo manda D7:** «los ítems sin conteo no generan diferencia y quedan marcados como *sin verificar*». Valorar en cero equivale a declarar consumido todo lo que nadie miró, y el guardián 3 de P7 lo demuestra: el consumo real se dispara por una omisión de captura, con un número perfectamente creíble.

**No es que el Excel se equivoque: es que el Excel asume conteo completo.** D7 existe justamente porque «en la práctica nadie cuenta 200 ítems y forzarlo produce números inventados», y la contrapartida —el indicador de cobertura— es lo que el Excel no tiene.

### 8.2 El MC promedio: el Excel usa la media **simple**

```excel
V_COSTEO!P54 = AVERAGE(P6:P53)      ← media simple del MC unitario
V_MENU_ENGINEERING!I6 = IF(AND(F6>=1, G6>=V_COSTEO!$P$54), "ESTRELLA", ...)
```

**El SPEC dice lo contrario, y con estas palabras:** «El MC promedio es el del total de la vista de costeo, **no la media simple**».

Se implementó siguiendo el SPEC —ponderado por unidades, que es además el Kasavana-Smith canónico—, y **es la única contradicción encontrada entre el SPEC y su fuente**. La diferencia decide cuadrantes: con dos productos, uno de 99 unidades y margen 1 y otro de 1 unidad y margen 101, la media simple da 51 y la ponderada 2.

> ⚠️ **Esta es una decisión abierta para el usuario**, anotada en `ESTADO.md`. El SPEC parece estar corrigiendo el Excel a propósito, pero eso hay que confirmarlo con quien lo escribió.

---

## Consecuencias

- **P6 queda corregido**, y la corrección vive en el punto único que P6 y P8 comparten: `totalConsumido`. Dos implementaciones del consumo habrían dejado el libro descontando una cantidad y la vista mostrando otra.
- **R7 demostró para qué sirve.** No detecta un consumo teórico equivocado —los dos lados se equivocan igual, y hay una prueba que lo enseña—, pero sí detecta un componente que se cuenta en un lado y no en el otro. Eso es exactamente lo que era el rendimiento por lote.
- **P9** hereda seis vistas que se calculan sobre un contexto único por (ubicación, mes). El consolidado de company es agregarlas, no recalcularlas.
- **La duda del rendimiento del ÍTEM sigue abierta** y ahora importa más: afecta al `consumo_teorico` que P8 ya publica, y merece confirmarse contra el Excel.
