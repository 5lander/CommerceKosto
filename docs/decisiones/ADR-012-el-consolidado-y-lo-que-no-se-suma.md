# ADR-012 — El consolidado, y lo que no se suma

| | |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-06 |
| **Paquete** | P9 — Consolidado de company y comparativa entre ubicaciones |
| **Contexto** | SPEC §18 · ADR-010 §1 · CLAUDE.md §4.4 y §5 |

> **Qué decide este ADR.** El SPEC dedica al consolidado **una frase**: «todo esto se calcula por ubicación, y el consolidado de company es la agregación sobre ubicaciones». Las cinco decisiones de abajo son lo que esa frase no dice, y una de ellas —la primera— es la única forma de equivocarse en este paquete que sobrevive a una revisión.

---

## 1. Los porcentajes se RECALCULAN sobre los totales. Nunca se promedian

**Decisión.** Suman: unidades, venta neta, margen de contribución, consumo teórico y real, compras, inventario final y costos fijos. **No** suman ni se promedian: food cost, margen porcentual y cobertura. Se recalculan dividiendo dos totales.

**Por qué.** Un local que vende 200 dólares al mes con un food cost del 80 % y otro que vende 100.000 con el 30 % no dan «55 %». Dan **30,1 %**, porque el segundo es quinientas veces más grande. La media simple le da a cada local un voto igual, y **el dueño no decide por local sino por dólar**.

**Qué se rompe con la contraria, y por qué nadie lo vería.** 55 % es un número perfectamente plausible en pantalla. No hay nada en la interfaz que delate la diferencia; se descubre meses después, cuando los precios subidos «porque el food cost estaba alto» no arreglan nada. Es exactamente la clase de fallo que CLAUDE.md §0 describe.

**Cómo se defiende.** `consolidar` no expone ninguna vía para promediar: los porcentajes salen siempre de dos totales. Y hay una prueba unitaria con esos dos locales cuyo resultado ponderado (0,300998003992) y cuya media simple (0,55) **difieren en veinticinco puntos**. Si alguien sustituye la fórmula por un promedio, esa prueba cae con un número que explica por qué.

---

## 2. Una ubicación sin datos del mes se aparta y se nombra. No vale cero

**Decisión.** `contexto` lanza `PeriodoSinDatosError` cuando nadie ha tocado ese mes en esa ubicación. El consolidado lo captura, aparta esa ubicación en una lista `sinDatos` con su nombre, y consolida las demás.

**Por qué.** Es la misma regla que ADR-010 §5 aplicó a un ítem sin contar: **un dato que falta no es un dato que vale cero**. Sumar un local recién abierto como cero rebajaría el food cost consolidado por no haber mirado, que es la peor forma de mejorar un indicador.

**Qué se rompe con la contraria.** Dos cosas, y la segunda es operativa: el número saldría sesgado hacia abajo sin que nada lo indique, y —si en vez de apartarla se dejara subir el error— **un solo local recién abierto tumbaría el informe de toda la cadena**.

**El límite, dicho para que no se confunda con una garantía.** Solo `PeriodoSinDatosError` se convierte en «sin datos». Cualquier otro fallo sube. Un consolidado que se traga un error de verdad y devuelve un total más bajo es peor que un consolidado que no sale.

---

## 3. El consolidado dice el estado del período de cada ubicación

**Decisión.** La respuesta trae `estadoDelPeriodo` por ubicación y los contadores `cerradas` / `abiertas`.

**Por qué.** El período es de una ubicación, no de la company (ADR-010 §1), así que el consolidado **puede estar sumando meses cerrados con meses todavía abiertos**. Un mes abierto sigue admitiendo movimientos: su número cambiará. Quien lee un total tiene derecho a saber cuánto de él es definitivo, sin preguntar.

Es la misma obligación que la cobertura de D7, que viaja pegada a todo número que dependa de un conteo parcial.

---

## 4. Permiso propio, de nivel company. `GERENTE_LOCAL` no lo tiene

**Decisión.** `analytics.consolidated.read`, para `OWNER`, `ADMIN` y `LECTURA`. **No** para `GERENTE_LOCAL`.

**Por qué.** El consolidado y sus comparativas enseñan, sumadas y una al lado de otra, las ventas, los márgenes y el food cost de los locales de los compañeros. Es la escalada horizontal de CLAUDE.md §4.4 con otro disfraz, y la misma línea que P4 trazó con la propagación de recetas (criterio E18): **un gerente manda en su local, no en la cadena.**

**`LECTURA` sí lo recibe** porque es un rol de solo lectura de nivel company — el contador o el socio que mira números y no toca nada.

**Cómo se defiende.** El permiso se exige en la **primera línea** de cada caso de uso, en su propia función, nunca dentro de un refinamiento (CLAUDE.md §3, INC-008). Y hay tres pruebas de 403, una por endpoint, más una cuarta que verifica que el gerente **sigue viendo la vista de su ubicación**: la restricción no puede convertirse en un bloqueo indiscriminado.

---

## 5. La comparativa de compras sale del LIBRO, no de `reference_price`

**Decisión.** El precio pagado se calcula con `Σ total_cost ÷ Σ quantity` de los movimientos de `COMPRA` del período, agrupados por `(ubicación, ítem, artículo de compra)`.

**Por qué.** `reference_price` es de la **company** y no tiene ubicación: compararlo entre locales daría el mismo número siempre, que es una comparativa que no compara nada. Lo que sí varía por ubicación es la factura — y la factura está en el libro. P6 dejó `purchase_article_id` en `inventory_movement` exactamente para esto.

**Qué añade agrupar también por artículo.** La pregunta del dueño lleva las tres dimensiones: «¿por qué el Norte paga el tomate más caro **—y es que compra otra marca?**». Sin el artículo, la comparativa señala una diferencia y no puede explicarla.

**Hay una prueba que lo fija:** el precio de referencia del insumo es 2,00 y la comparativa devuelve 1,20 y 1,68. Si alguien cambiara la fuente, aparecería el 2,00 y la prueba caería.

---

## 6. Se apoya en lo que P8 ya arma, y eso es la garantía de que no discrepe

**Decisión.** Cada ubicación pasa por el **mismo** `contexto` que sirve su food cost real y su inventario valorizado. El consolidado es literalmente la suma de lo que cada ubicación publica.

**Por qué.** La alternativa —una consulta agregada en SQL, más rápida— crearía **dos verdades**: el total del consolidado y la suma de las vistas, calculados por caminos distintos. Coincidirían el primer día. La prueba de aceptación no compara contra números escritos a mano sino contra las propias vistas por ubicación, precisamente para que el día que se separen se sepa.

**Qué cuesta.** Rendimiento. Es la decisión que hace que el consolidado escale lineal, y lleva directamente a la siguiente.

---

## 7. Las vistas materializadas NO se construyen todavía, y el umbral está medido

**Decisión.** El plan de P9 las lista como entregable. No se construyen. Se documenta el número que las haría necesarias.

**Lo medido**, en la topología de producción —aplicación y base en la misma red—, con diez ubicaciones, veinte productos cada una y 1.200 líneas de receta:

| | mediana | p95 | máximo |
|---|---|---|---|
| Una ubicación (`/analitica/resumen`) | 69 ms | — | — |
| **Diez ubicaciones (`/consolidado`)** | 616 ms | **734 ms** | 848 ms |

**Cumple el presupuesto de §5 —800 ms— al 92 %.** Y la proporción es **8,9×**: escala prácticamente lineal pese a resolver las ubicaciones con `Promise.all`, porque la mayor parte del trabajo es CPU de Node, que es un solo hilo. Esperar en paralelo no multiplica lo que hay que calcular.

**La consecuencia, escrita para que nadie la descubra tarde: alrededor de doce ubicaciones el presupuesto se rompe.**

**Por qué no se construyen ahora.** Una vista materializada es estado duplicado, y en este sistema un número rancio es un número equivocado: habría que invalidarla al cerrar y al reabrir un período, y cada camino que se olvide produce un consolidado plausible y falso. `OPTIMIZACION.md` §1 prohíbe construir lo que no hace falta todavía, y el criterio de aceptación se cumple sin ellas.

**Cuándo se construyen.** Cuando aparezca una company con más de diez ubicaciones, o cuando el número medido en CI se acerque al techo. Y solo para **períodos cerrados**, donde las entradas están congeladas (ADR-010 §6) y por tanto la caché no puede quedar rancia por un cambio legítimo.

---

## Consecuencias

- **P11** hereda el patrón: el back office consulta cross-tenant y tendrá que hacerlo por encima de este permiso, no rodeándolo.
- **P12** puede pintar la comparativa ordenada por brecha: cada fila ya trae mínimo, máximo y diferencia, así que el frontend no calcula nada — que es §10 funcionando.
- **El umbral de doce ubicaciones es una deuda con disparador**, no una fecha: está en `ESTADO.md` con el número que la dispara.
- **`ListarUbicaciones` pasa a exportarse desde `IamModule`.** Es la única puerta por la que el consolidado sabe qué ubicaciones tiene la company, y hace que el alcance de sesión se aplique una vez y en un solo sitio.
