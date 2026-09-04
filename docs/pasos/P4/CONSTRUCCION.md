# P4 — Documento de construcción

## Resumen

| Campo | Valor |
|---|---|
| Paquete | P4 — Recetas, productos y combos |
| Fecha | 2026-09-04 |
| Commit final | `P4: Recetas · productos · combos` |
| Secciones del SPEC | §8 (productos), §9 (recetas entre locales), §13 (línea de receta) |
| Reglas de negocio | **R9** activa · **R11** activa · **R4** modelada y probada · R14 modelada |
| ADR | **ADR-007** — propagación por copia frente a herencia |
| Estado | ✅ completado |

## Objetivo

**Que un ciclo en una receta se rechace al guardar y que propagar entre locales sea una decisión con marcha atrás.**

**Criterio de aceptación:** una receta que se referencia a sí misma a dos niveles se rechaza al guardar con error de dominio (E14) · propagar crea versión nueva en cada ubicación y las anteriores siguen consultables · un `GERENTE_LOCAL` recibe 403 al propagar (E18) · revertir una propagación devuelve cada ubicación a su versión previa.

---

## Qué se construyó

### Esquema — 12 tablas

| Tabla | Nota |
|---|---|
| `product` | Maestro de la company. **La unidad de costeo es la porción, no el plato** |
| `product_location` | Activación, PVP y rendimiento por lote, por local |
| `combo_component` | Los componentes de un combo son productos **simples**, nunca ítems |
| `recipe` | Una **versión** por (destino, ubicación), con vigencia |
| `recipe_line` | Cantidad, base AP/EP y estado |
| `recipe_propagation` + `..._target` | Quién propagó qué, y qué había antes en cada ubicación |
| 5 catálogos | `product_type`, `product_status`, `recipe_line_base`, `recipe_line_status`, `recipe_status` |

### Tres decisiones de esquema

**El destino de una receta es un producto O un ítem, exactamente uno.** Un producto de venta tiene receta; una subpreparación —ítem `PRODUCIDO`— también, y ahí está la recursión que R9 corta. Un `CHECK` con `<>` sobre dos `IS NOT NULL` lo hace imposible de violar: sin él cabría una receta sin destino, que no significa nada, y una con dos, que significa dos cosas contradictorias.

**`recipe_status` incluye `VOID`, y hace falta.** Es la versión que dice «aquí no hay receta», y sin ella revertir una propagación sobre una ubicación que no tenía receta obligaría a borrar la versión creada —reescribiendo la historia— o a dejar una receta vacía. **Una receta vacía cuesta cero**, que es un número plausible y equivocado.

**`recipe` no se puede editar, y lo impide un trigger.** `recipe` no necesita `UPDATE` para nada, pero un `GRANT` olvidado en el futuro lo abriría en silencio. Con el trigger, «una receta se versiona, no se edita» es cierto por construcción.

### El dominio

| Archivo | Qué decide | Pruebas |
|---|---|---|
| `ciclos.ts` | R9: recorrido en profundidad **memorizado** que corta al primer ciclo | 10 |
| `linea-de-receta.ts` | R4: la base AP/EP, escrita como tabla y no como `if` | 11 |

**Por qué el recorrido está memorizado.** Un grafo en rombo —A usa B y C, y los dos usan D— visita D dos veces; con profundidad *n* el coste es exponencial. Memorizado, cada ítem se visita una vez y el coste es lineal en aristas. Hay una prueba con 30 niveles de rombo que **falla si la memorización se rompe**: sin ella serían 2³⁰ visitas.

**Por qué la base AP/EP es un `Record` y no un `if`.** SPEC §13 la llama «la condicional más frágil del modelo»: implementarla al revés produce números plausibles y equivocados en las 293 líneas del Excel. Un `Record<BaseDeLinea, …>` obliga a que añadir una tercera base no compile hasta que alguien decida qué costo le toca; un `if` con `else` la habría tratado como AP en silencio.

Y la prueba tiene una parte que suele faltar: **un caso con rendimiento 1, donde los dos números coinciden, marcado como el que no valida nada.** Probar solo con rendimiento 1 hace pasar cualquier implementación, incluida la invertida.

### R9 — el ciclo se corta por ubicación

El grafo de subpreparaciones es **por ubicación**, no por company: Norte puede tener una receta que en Centro sería un ciclo, porque allí la cadena no existe. Hay una prueba de integración para eso.

Y el mensaje lleva el camino dentro (`mayonesa → salsa → mayonesa`). Sin él, «hay un ciclo» obliga a buscarlo a mano entre docenas de subpreparaciones.

### R11 — propagación, y ADR-007

El razonamiento completo —por qué copia y no herencia— está en **ADR-007**. Lo que R11 exige y dónde está cada cosa:

| Exigencia | Dónde |
|---|---|
| Previsualización con cuántos locales y cuáles personalizados | `PrevisualizarPropagacion`; el número es `personalizadas` |
| Opción de destildar | La petición lleva la lista de destinos elegidos |
| Permiso separado de nivel company | `recipe.propagate`, que `GERENTE_LOCAL` no tiene |
| Registro de quién propagó qué | `recipe_propagation` + un destino por ubicación |
| Reversión por local | `previous_recipe_id` en cada destino |

**Revertir no borra nada.** Crea una versión nueva con las líneas de la que estaba vigente antes. Los costeos hechos entre la propagación y la reversión usaron la receta que de verdad estaba vigente entonces y siguen siendo correctos.

---

## Superficie de API

| Método | Ruta | Permiso |
|---|---|---|
| `GET` · `POST` | `/productos` | `product.read` / `product.write` |
| `PUT` | `/productos/:id/ubicaciones` | `product.write` |
| `GET` | `/recetas?productId=…&locationId=…&fecha=…` | `recipe.read` |
| `PUT` | `/recetas` | `recipe.write` |
| `GET` | `/recetas/propagacion/previsualizacion` | `recipe.propagate` |
| `POST` | `/recetas/propagacion` | `recipe.propagate` |
| `POST` | `/recetas/propagacion/:id/reversion` | `recipe.propagate` |

**`BODEGA` no tiene `recipe.read` ni `recipe.write`.** Es la regla más dura de CLAUDE.md §4.3: las líneas de receta con sus cantidades **son** la receta. El filtrado va en la API, no en el frontend — aquí, en una fila de `role_permission` que no existe. Hay una prueba que lo comprueba **sobre la respuesta cruda**.

**`GERENTE_LOCAL` tiene `recipe.write` y no `recipe.propagate`.** De ahí sale E18 sin un solo `if`.

---

## Lo que se descubrió por el camino

**Un error de dominio que no lo era.** `CicloEnRecetaError` se escribió extendiendo `Error` a secas, y la primera prueba de integración lo cazó: salía por el filtro como `INTERNAL_ERROR` 500 —un fallo del servidor— cuando lo que hay es una receta mal escrita, que es un 400 con el camino del ciclo dentro. El `Record` exhaustivo de códigos de dominio hace su trabajo solo si el error entra por la puerta; extender `Error` es la puerta de al lado.

**Los parámetros de consulta entraban sin validar.** `GET /recetas` empezó con cinco `@Query` sueltos y `max-params` lo marcó. La solución no fue agruparlos en un objeto sin más: se les puso **esquema**, igual que a un cuerpo. Un parámetro de URL es entrada no confiable exactamente igual, y hasta ese momento los del proyecto entraban como `string` crudo.

---

## Deuda

| Qué | Cuándo |
|---|---|
| El cálculo del costo del producto (SPEC §14) | **P5.** P4 modela la línea y la prueba; el motor que las suma es el paquete siguiente |
| Componentes de combo por API | Sin paquete: la tabla y sus reglas existen, el endpoint no. No hay consumidor todavía |
| Lista blanca de knip para `shared/domain/**` | P5, y **P5 no cierra con ella puesta** |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado (de P1) |
