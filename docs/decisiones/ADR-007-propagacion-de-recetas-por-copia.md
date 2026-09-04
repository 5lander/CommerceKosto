# ADR-007 — Propagación de recetas por copia, no por herencia

| Campo | Valor |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-04 |
| **Paquete** | P4 |
| **Relacionada con** | SPEC §9, R11, CLAUDE.md §6 |

---

## Contexto

Una company tiene N ubicaciones y el mismo producto se vende en varias. La pregunta es qué relación guardan sus recetas entre sí.

Hay dos modelos posibles, y la diferencia no es técnica sino de producto:

**Herencia.** Existe una receta «maestra» de la company; cada ubicación hereda de ella y puede sobrescribir líneas concretas. Cambiar la maestra propaga automáticamente a todas las que no hayan sobrescrito esa línea.

**Copia con propagación explícita.** Cada ubicación tiene su receta, completa e independiente. «Aplicar a todos» copia una sobre las demás y ahí termina la relación: no queda vínculo.

---

## Decisión

**Copia independiente con propagación explícita.** Es lo que dice SPEC §9 —«copia independiente con propagación explícita, sin vínculo permanente»— y este ADR registra por qué es lo correcto, no solo que está escrito.

### Por qué la herencia es peor aquí

**Porque la cocina de un local no es una desviación de la del otro: es la suya.** Ese es el fondo. La herencia modela «lo normal es la maestra, y esto es una excepción», y en un negocio con locales de distinto tamaño, distinto proveedor y distinto cocinero, la excepción es la norma. A los seis meses cada ubicación tendría media receta sobrescrita y la maestra sería una ficción que nadie mira.

**Porque el cambio automático llega sin que nadie lo decida.** Con herencia, tocar la maestra cambia el costo de un plato en cinco locales a la vez, y el gerente del quinto se entera cuando le baja el margen. Este sistema calcula el número con el que un dueño decide precios; un cambio que nadie aprobó en el sitio donde se aplica es exactamente lo que R5 prohíbe para los precios, y no hay razón para que las recetas sean distintas.

**Porque «qué receta estaba vigente el 3 de marzo» tiene que tener una respuesta.** Con copia, la respuesta es una fila. Con herencia hay que reconstruirla combinando la maestra de aquel día con las sobrescrituras de aquel día, y cualquier error en esa reconstrucción cambia un costeo histórico sin dejar rastro.

### Lo que la copia cuesta, dicho sin adornos

**Duplica datos.** Cinco ubicaciones con la misma receta son cinco juegos de líneas. Es aceptable: son decenas de líneas por receta, no millones, y el costo de almacenamiento es irrelevante frente al de reconstruir historia.

**Un cambio que sí es global hay que propagarlo a mano.** Si el proveedor cambia y la nueva harina rinde distinto en todos los locales, alguien tiene que propagar. Eso es trabajo, y es deliberado: R11 exige previsualización, permiso separado y registro reversible **porque** es una acción con consecuencias, no a pesar de serlo.

---

## Cómo queda implementado

| Exigencia de R11 | Dónde |
|---|---|
| Previsualización con cuántos locales y cuáles personalizados | `PrevisualizarPropagacion`; el número que importa es `personalizadas` |
| Opción de destildar | El cuerpo de la petición lleva la lista de destinos elegidos |
| Permiso separado de nivel company | `recipe.propagate`, que `GERENTE_LOCAL` no tiene |
| Registro de quién propagó qué | `recipe_propagation` + un destino por ubicación |
| Reversión por local | `recipe_propagation_target.previous_recipe_id` |

### Revertir no borra nada

Revertir **crea una versión nueva** en cada ubicación con las líneas de la que estaba vigente antes de propagar. No borra la versión propagada.

La razón es la misma que sostiene los precios de P3: los costeos hechos entre la propagación y la reversión usaron la receta que de verdad estaba vigente entonces, y siguen siendo correctos. Borrar la versión propagada reescribiría la historia, que es lo que SPEC §9 prohíbe cuando dice que «los costeos históricos no se recalculan».

### El caso de la ubicación que no tenía receta

Si una ubicación **no tenía** receta antes de la propagación, revertir le deja una versión con estado `VOID`.

Es distinto de una receta vacía, y la distinción importa: **una receta vacía cuesta cero**, que es un número plausible y equivocado. `VOID` dice «aquí no hay receta», y la consulta de receta vigente devuelve `null`.

---

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| Herencia con sobrescritura por línea | Ver arriba: la excepción es la norma, el cambio llega sin decidirse, y la historia deja de tener una respuesta |
| Propagación automática al guardar la maestra | Es la herencia con otro nombre, y sin siquiera el registro |
| Revertir borrando la versión propagada | Reescribe la historia. Un costeo del mes pasado pasaría a usar una receta que en ese momento no estaba vigente |
| Revertir dejando una receta vacía | Una receta vacía cuesta cero. `VOID` no cuesta nada porque no es una receta |
| Marcar la ubicación como «sincronizada» y propagar solo a esas | Vínculo permanente por la puerta de atrás, con el agravante de que el estado de sincronización es otra cosa que mantener |

---

## Consecuencias

**Buenas**

- «Qué receta estaba vigente el 3 de marzo en el local Norte» es una consulta con una respuesta.
- Ninguna ubicación cambia de costo sin que alguien lo haya decidido para ella.
- La reversión es exacta y no destruye evidencia.

**Malas**

- Un cambio genuinamente global es N propagaciones o una propagación a N destinos, con su previsualización. Es trabajo, y es el punto.
- Los datos se duplican. A esta escala no importa; si algún día un cliente tuviera cientos de ubicaciones, el sitio donde dolería es el `guardarVersion` en bucle de `PropagarReceta`, que entonces sería una inserción por lotes.

---

## Referencias

- SPEC §9 · CLAUDE.md §6 (R11) · `docs/pasos/P4/CONSTRUCCION.md`
- `apps/api/src/modules/recipes/application/casos-de-uso/propagacion.ts`
