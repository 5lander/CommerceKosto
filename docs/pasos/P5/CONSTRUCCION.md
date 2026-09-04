# P5 — Documento de construcción

## Resumen

| Campo | Valor |
|---|---|
| Paquete | **P5 — Motor de costeo** ⭐ camino crítico |
| Fecha | 2026-09-04 |
| Commit final | `P5: Motor de costeo` |
| Secciones del SPEC | §11 (parámetros), §12 (costo del insumo), §13 (línea), §14 (costeo del producto), §5 y §6 (subpreparaciones), §8 (combos) |
| Reglas de negocio | **R6**, **R10**, **R12**, **R14** activas · **R4** aplicada · **R7** a través del motor |
| ADR | **ADR-008** — las tres decisiones que el SPEC no escribe |
| Incidencias | **INC-012** nueva · **INC-007** sube a 8 recurrencias |
| Estado | ✅ completado |

## Objetivo

**El cálculo correcto, demostrable y sin base de datos.**

**Criterio de aceptación (del plan):** las pruebas del motor corren con PostgreSQL apagado · todos los casos de `docs/pruebas/casos-conocidos.md` dan el resultado calculado a mano desde el Excel · la suma de control da exactamente 1 para todo producto (R6) · existe un test con el mismo ítem en base AP y en base EP que produce resultados distintos y ambos correctos (R4) · un producto cuyo rendimiento es 0 no divide por cero.

**Los cinco se cumplen.** Y el prompt del plan pedía algo antes: *«escribe primero `docs/pruebas/casos-conocidos.md` con al menos 8 casos calculados a mano»*. Se hizo en ese orden — los casos primero, el motor después.

---

## Qué se construyó

### El dominio — 3 archivos, cero dependencias de infraestructura

| Archivo | Qué decide | Pruebas |
|---|---|---|
| `costeo-de-producto.ts` | SPEC §14 entero: lote, porción, merma, empaque, venta neta, margen, food cost, multiplicador, impacto de merma | |
| `cascada.ts` | R10 y las subpreparaciones: recorrido memorizado, a prueba de ciclos, con aviso de los ítems sin costo | |
| `combo.ts` | SPEC §8: la suma de componentes ya costeados | |
| | **Total** | **45** |

Las 45 corren con la base apagada. Son el criterio arquitectónico de CLAUDE.md §2 aplicado al componente que más importa.

### La decisión de forma que más peso tiene: el lado de venta es una unión

```ts
export type ResultadoDeVenta = Vendible | SinPrecio;
```

`product_location.pvp` es anulable y un producto sin precio fijado es lo normal antes de decidirlo. Devolver `food_cost_pct = 0` en ese caso sería decir «este plato no cuesta nada», que es lo contrario de la verdad. Con una unión, quien consume el resultado **no compila** hasta que decide qué hacer con el caso sin precio; con campos anulables, puede olvidarse de mirar uno.

Es la guarda que el SPEC no escribe y que **CC-009** exige.

### R6 pasa a ser cierta por construcción

Dividir dos veces —`margen/venta` y `costo/venta`— es la forma obvia y es la que puede romper la suma de control: cada división redondea a la escala 12, y cuando las dos caen en un empate exacto en el decimal trece, **ambas redondean hacia arriba** y la suma da `1.000000000001`. Una regla que CLAUDE.md §6 marca como invariante no puede depender de que eso no pase nunca.

Se divide **una** vez —el food cost, que es el número que manda el semáforo— y el margen es su complemento. Y para que el complemento no esconda un error, hay una prueba que calcula `margen/venta` por separado y exige que coincidan.

Coincide dígito a dígito con lo que `V_COSTEO` muestra en los tres casos del Excel: `0.6398722222 + 0.3601277778`, `0.6175436156 + 0.3824563844`, `0.7636481763 + 0.2363518237`.

### La cascada: si hay receta, manda la receta

El razonamiento completo está en **ADR-008**. En una frase: lo que R10 prohíbe es costear con el **último lote** —«que el plato no cambie de costo según cuánto se produjo ese día»—, y la cascada no usa lotes, usa precios de referencia confirmados, que es un costo estándar por construcción.

**La prueba de que la decisión no rompe nada es CC-005**, y es la más fuerte del paquete: la receta construida para la salsa de queso da exactamente `0.200000`, que es el `0.20` que el Excel tenía escrito a mano. Con ese valor, CC-002 entero —cuyos números salen de `V_COSTEO`— sigue cuadrando hasta el último decimal. **La cascada no cambió la respuesta: cambió de dónde sale.**

Y la parte B demuestra lo que el Excel no hacía: subiendo la mozzarella de `5.50` a `6.00`, la salsa pasa a `0.216000` y el plato sube con ella.

### Lo que el motor no se calla

`resolverCostos` devuelve, junto a los costos, la lista de **ítems sin precio confirmado ni receta**. Cuestan cero, así que el plato sale más barato de lo que es, y el número resultante es **plausible**. Esa lista viaja hasta la respuesta HTTP en `itemsSinCosto`.

Es la clase de defensa que este proyecto necesita: el fallo que teme no es el que revienta, es el que sale bonito.

### La aplicación — cuatro consultas de `recipes`, cuatro de `pricing`, fijas

`CostoDeItem` (P3) resuelve un ítem y hace tres consultas para hacerlo. Costear una carta de 200 productos con 300 insumos por esa vía son **novecientas consultas**, y el presupuesto de 400 ms de CLAUDE.md §5 no admite ni la décima parte.

De ahí salen dos casos de uso nuevos, cada uno en el módulo que es dueño de sus datos:

| Caso de uso | Módulo | Qué trae |
|---|---|---|
| `CostosDeItems` | `pricing` | El costo por unidad de uso de **todos** los ítems, a una fecha |
| `LeerCarta` | `recipes` | Productos, su configuración en la ubicación, sus recetas vigentes y los componentes de combo |

**Ninguno duplica una regla.** `CostosDeItems` llama a la misma `costoDelItem` de SPEC §12 que usa `CostoDeItem`, y cuál precio está vigente lo sigue decidiendo `precioVigenteA` —R5, con su desempate por `created_at`—. Un `DISTINCT ON` en SQL habría sido más rápido y habría puesto la regla de negocio en dos sitios; el día que uno de los dos cambiara, el costo del mes pasado dejaría de coincidir consigo mismo.

**Costear uno pasa por costear todos**, y es deliberado: dos rutas distintas para el mismo número son dos oportunidades de que den respuestas distintas, y en este sistema eso no se ve en pantalla.

### El esquema — una columna, un índice, un permiso

P5 **no crea ninguna tabla**. El motor es dominio puro y no persiste nada.

| Cambio | Por qué |
|---|---|
| `product.packaging_item_id` | SPEC §14 usa `empaque_neto` y el esquema no tenía nada. **Es un ítem, no una tabla propia** (ADR-008) |
| Índice `(company_id, location_id, valid_from DESC)` en `recipe` | Los de P4 empiezan por `product_id`; la consulta de la carta no lo lleva |
| Permiso `costing.read` | `BODEGA` no aparece en ningún `INSERT`: CLAUDE.md §4.3 |

---

## El presupuesto de rendimiento, medido

**Aquí empieza a medirse**, y era el ítem 6 de lo que P5 debía cerrar. P0–P4 lo dejaron escrito; sin volumen no significaba nada, porque cualquier consulta es rápida sobre veinte filas — incluido un `Seq Scan`.

| | Presupuesto (CLAUDE.md §5) | Medido |
|---|---|---|
| Costeo completo, 200 productos y 1.600 líneas | < 400 ms (p95) | **136,8 ms** |

Volumen sintético: 300 ítems con precio confirmado, 200 productos activos con PVP, 1.600 líneas repartidas de forma que los mismos insumos se repiten entre platos — que es el reparto real de una carta y lo que le da trabajo a la memorización de la cascada.

**Se comprueban dos cosas, y la segunda es la que dura.** El tiempo depende de la máquina y del día; el **plan** de ejecución no. Un `Seq Scan` sobre `recipe` sigue pasando el umbral con este volumen y deja de pasarlo con diez veces más, así que hay una prueba que falla si el plan no usa el índice.

```
Bitmap Index Scan on recipe_por_ubicacion_y_vigencia (actual time=0.024..0.025 rows=200)
  Index Cond: ((company_id = ...) AND (location_id = ...) AND (valid_from <= now()))
  Buffers: shared hit=1
Execution Time: 0.340 ms
```

El plan completo está en `evidencia/explain-analyze.txt`.

---

## Lo que se descubrió por el camino

### 1. R7 no detecta un costo equivocado, y hay que saberlo

**Es el hallazgo más importante del paquete.** Al sabotear R4 —intercambiar `EP` y `AP`— fallan **12 pruebas**, y **ninguna de ellas es CC-R7**: la conciliación sigue dando `0.00` con el motor calculando mal el costo de cada línea.

No es un fallo de la prueba: es lo que R7 **es**. Su identidad algebraica —`costo_ventas_teorico == venta_neta_mes − mc_mes`— se sostiene cualquiera que sea el costo, porque el costo aparece en los dos lados.

R7 detecta **deriva aritmética** y **términos que faltan** —quitar la provisión de merma la rompe con `6.23`, comprobado—. No detecta un costo equivocado. Lo que caza un costo equivocado son los **casos conocidos**, y por eso sus valores esperados tienen que salir del Excel y no de este código.

Está escrito en `evidencia/guardian-1-r4-invertida.txt` para que nadie confunda una R7 verde con un motor correcto.

### 2. Dos restricciones de la base salían como 500 — INC-012

`PUT /productos/:id/ubicaciones` con `activo: true` y `pvp: null` daba **500**. `POST /precios` sin artículo para un ítem comprado, también.

Las dos reglas existen y funcionan; están en la base, que es donde CLAUDE.md §5 las quiere. Lo que faltaba era la otra mitad: **la base garantiza, el dominio explica**. Sin guarda de dominio, el `23514` o el `P0001` del driver sube sin traducir, el filtro no lo reconoce como error de dominio y sale como fallo del servidor — que dispara alertas de operación, cuenta como caída y no dice qué corregir.

Se añadieron las dos guardas. **Las restricciones de la base no se tocaron**: siguen siendo la garantía.

Prevención automatizada en el mismo paquete: **M11** en `audit:migrations` exige que toda migración con `CHECK` o `RAISE EXCEPTION` tenga su sección en `docs/sistema/guardas-de-dominio.md`, donde se dice cuál de sus restricciones es alcanzable desde la API y dónde está su guarda. Ese documento se escribió hacia atrás para P0–P4: **7 restricciones resultaron ser 🔴 alcanzables**, y las dos que faltaban eran justo las dos que daban 500.

### 3. La octava recurrencia de INC-007, con el mismo carácter que la séptima

M11 marcó **3 migraciones de 5**. Ese número era el síntoma: P1 y P2 tienen 33 y 20 `CHECK` y la regla no las veía. Las tres que marcó eran justo las que tienen `RAISE EXCEPTION`, o sea las que casaban por la **otra** mitad de la condición.

La causa: la regex se escribió como `/\bCHECK\s*\(/i` pero el archivo se generó desde una cadena donde **`\b` no es «límite de palabra»: es el carácter de retroceso (0x08)**. Lo que quedó fue una regex que solo casa si delante de `CHECK` hay un retroceso — es decir, nunca. Compila, no lanza, no avisa.

**Es exactamente el caso 7, que fue M10 y el mismo carácter.** La prueba del guardián no lo evitó, porque el guardián se hace sobre una violación que uno sabe que existe, y aquí la violación existía: los tres `RAISE` hacían fallar la regla y daban la impresión de que medía.

**Lo que sí lo caza es mirar cuántos.** «3 de 5» fue la pregunta que destapó el fallo, y de ahí sale la regla que INC-007 no tenía:

> Un check que falla no está verificado: hay que mirar en **cuántos** sitios falla. El verde no es el único color sospechoso.

**Prevención, esta vez atacando la causa:** `audit:forbidden` gana `sin-caracteres-de-control` — ningún archivo de código puede contener un carácter de control literal. Un retroceso jamás tiene sitio legítimo en un `.ts` ni en un `.mjs`, así que la regla no necesita excepciones. Es la primera prevención de INC-007 que impide que el fallo **se escriba**, en vez de enseñar a desconfiar del verde.

*(Y la regla, escrita como regex, era ella misma una infracción: ESLint la rechazó con `no-control-regex`. Se comprueba por código de carácter.)*

### 4. La documentación de API y del modelo de datos se habían quedado en P2

`docs/apis/app-cliente.md` y `docs/sistema/modelo-datos.md` no tenían ni una línea de P3 ni de P4. Es el punto **H4** de la auditoría, que esos dos paquetes dieron por bueno sin estarlo.

Se escribieron los tres tramos —P3, P4 y P5— en el mismo commit. Documentar solo P5 sobre un hueco de dos paquetes habría sido peor que el hueco.

---

## Cómo probarlo a mano

```bash
docker compose up -d db pgbouncer
npm run migrate:deploy

# El motor entero, con la base APAGADA. Es el criterio de CLAUDE.md §2.
npm run test:unit -- src/modules/costing

# El ensamblaje y el presupuesto de rendimiento.
npm run test:integration -- test/integracion/costeo.spec.ts
npm run test:integration -- test/integracion/rendimiento-de-costeo.spec.ts
```

Sobre datos propios, montando CC-001 por la API:

```bash
# 1. Un ítem de empaque (0.05 con IVA 0.15) y un ítem de comida (0.51 sin IVA)
#    con su artículo de presentación 1:1 y su precio CONFIRMADO.
# 2. Un producto con ese empaque, activo con PVP 1.80 y 1 porción por lote.
# 3. Una receta con una línea: 1 unidad del ítem, base EP, ACTIVA.
curl -b cookies.txt "localhost:3000/costeo?locationId=$LOC"
```

Debe dar `costoTotalUnidad.exacto = 0.563678260870` y `foodCostPct = 0.360127777778`, que son los valores de `V_COSTEO` fila 6.

---

## Deuda

| Qué | Cuándo |
|---|---|
| **El rendimiento por lote de una subpreparación no existe.** La receta se expresa por unidad de uso | **P6**, donde el movimiento de producción lo hace significar algo. Merece confirmarse antes |
| Menu engineering (SPEC §15) y las demás vistas | **P8**, como el plan dice |
| R7 con el dataset completo: compras reales y conteo físico | **P8**, que es donde existen el libro y el período |
| Previsualizar qué platos se mueven al confirmar un precio | **P8**, donde existen las vistas que lo mostrarían |
| Componentes de combo por API | Sin paquete: la tabla y sus reglas existen, el endpoint no. Sin consumidor todavía (viene de P4) |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado (de P1) |
