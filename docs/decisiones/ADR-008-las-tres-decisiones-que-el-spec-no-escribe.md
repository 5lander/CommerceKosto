# ADR-008 — Las tres decisiones de costeo que el SPEC no escribe

| Campo | Valor |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-04 |
| **Paquete** | P5 |
| **Relacionada con** | SPEC §5, §6, §8, §12, §14 · R10, R12, R13 · CLAUDE.md §6 |

---

## Contexto

SPEC §14 da la fórmula del costeo del producto completa y sin ambigüedad. Pero tres piezas que la fórmula **usa** no están definidas en ninguna parte del SPEC, y las tres entran directamente en el número con el que un dueño de restaurante fija el precio de su carta:

1. **Dónde vive el empaque.** `COSTO_TOTAL_UNIDAD = costo_con_merma + empaque_neto`, y `empaque_neto = precio_empaque / (1 + iva)`. El Excel tiene una hoja `T4_EMPAQUES` con su propio precio y su propio IVA. El modelo de datos de P0–P4 no tiene nada.
2. **Qué manda en una subpreparación: su precio estándar o su receta.** §5 dice que las 24 filas `SUB` pasan a ser ítems `PRODUCIDO` «con receta propia y costo derivado en cascada». §6 y R10 dicen que una preparación producida tiene «costo estándar fijo definido por el usuario». Un ítem puede tener las dos cosas.
3. **Cómo se costea un combo.** §8 dice que un combo se compone de productos simples y que «el descuento no se prorratea». No dice si el costo del combo vuelve a aplicar la provisión de merma, si divide por un rendimiento, ni qué pasa con los empaques de los componentes.

Este ADR fija las tres, con su razón y con lo que cada una cuesta.

---

## Decisión 1 — El empaque es un ítem, no una tabla propia

**`product.packaging_item_id` apunta a un `item`.** No existe tabla `packaging` ni precio de empaque separado.

### Por qué

**Porque un empaque se compra exactamente igual que un insumo.** Tiene proveedor, tiene marca, viene en cajas de 100, su precio sube, y el día que exista el libro de inventario (P6) alguien va a contar cuántas bolsas quedan. Todo eso ya existe para los ítems: artículo de compra, factor de conversión, precio de referencia con vigencia y confirmación (R5), historial.

**Porque una tabla propia habría duplicado la cadena de costo entera.** `precio_empaque / (1 + iva)` es, letra por letra, la cadena de SPEC §12 con factor de conversión 1 y rendimiento 1. Con tabla propia habría un segundo sitio donde viven precios, un segundo sitio donde aplicar R13 —«el IVA recuperable afecta a ítems y empaques por igual»— y un segundo sitio que actualizar cuando la vigencia cambie de reglas. El día que uno de los dos divergiera, el costo del plato dependería de por dónde se preguntó.

**Y porque el modelo resulta ser un superconjunto del Excel.** `T4_EMPAQUES` guarda el precio ya por unidad; aquí un empaque puede declararse como «caja de 100 bolsas» con factor 100 y el resultado es el mismo. Con factor 1, la fórmula se reduce exactamente a la del Excel.

### Lo que cuesta

**Un empaque aparece en la lista de ítems del catálogo.** Quien busque «bolsa kraft» entre los insumos la va a encontrar. No es un error —es un insumo—, pero un usuario que espere ver solo comida se sorprende. Se resuelve con un grupo de ítems llamado «Empaques», que ya existe y no necesita código.

**Nada impide poner un tomate como empaque de un plato.** La clave foránea solo exige que sea un ítem de la misma company. Un `CHECK` no puede distinguirlos porque la diferencia es de negocio, no de estructura. Se acepta: el daño de equivocarse es visible en la primera pantalla de costeo, a diferencia de los errores que este proyecto teme, que son los invisibles.

---

## Decisión 2 — Si hay receta, manda la receta

**Un ítem `PRODUCIDO` con receta vigente se costea por su receta. Su precio de referencia queda como el costo estándar de una preparación que todavía no tiene receta capturada.**

### Por qué no al revés

**Porque es el problema que el propio LEEME del Excel declara como deuda.** Sus palabras, citadas en SPEC §5: *«tienen costo escrito a mano y no se recalculan si sube un insumo. Cada una debería tener su propia receta.»* Si el precio de referencia ganara, el costo de la salsa seguiría siendo el número que alguien tecleó, y el plato que la lleva seguiría pareciendo más barato de lo que es. La deuda no se pagaría: se reescribiría en otra tabla.

**Porque el precio ganando dejaría la cascada sin usar.** En cuanto un usuario fija un costo estándar —que es lo primero que hace al migrar el Excel, porque el Excel trae uno para cada `SUB`— la receta dejaría de contar. La funcionalidad existiría y no se ejecutaría nunca.

### Por qué R10 sigue entera

R10 dice: *«El ítem `PRODUCIDO` se costea con su precio de referencia fijo, no con el costo del último lote.»*

**Lo que R10 prohíbe es el costo del ÚLTIMO LOTE**, y su razón está escrita en SPEC §6: *«para que el plato no cambie de costo según cuánto se produjo ese día»*. La cascada no usa lotes. Usa precios de referencia confirmados, que es un costo estándar por construcción: dos corridas idénticas dan el mismo número, y el número solo cambia cuando alguien confirma un precio nuevo.

El costo real de cada lote seguirá viviendo en el movimiento de producción (P6), y su diferencia contra este costo estándar seguirá siendo varianza de producción. Nada de eso cambia.

### Cómo se comprueba que la decisión no rompe nada

**CC-005 parte A.** La receta construida para la salsa de queso —`0.032 kg` de mozzarella más `0.2` huevos— da exactamente `0.200000`, que es el `0.20` que el Excel tenía escrito a mano. Con ese valor, CC-002 entero —cuyos números salen de `V_COSTEO`— sigue cuadrando hasta el último decimal. La cascada no cambió la respuesta: cambió de dónde sale.

**CC-005 parte B.** Subiendo la mozzarella de `5.50` a `6.00`, la salsa pasa a `0.216000` y el plato sube con ella. Es lo que el Excel no hacía.

### Lo que cuesta

**Un costo de plato puede moverse sin que nadie toque ese plato.** Confirmar el precio del queso mueve el margen de todo lo que lleve salsa de queso. Es deseable —es el propósito— y a la vez es un cambio que el usuario tiene que poder anticipar. La previsualización de ese impacto no está en P5; queda anotada como pregunta abierta para P8, donde existen las vistas que la mostrarían.

**Una receta vigente `ACTIVE` pero vacía cuesta cero.** Es un estado que la API deja crear. Se prefiere a la alternativa —caer al precio cuando la receta está vacía— porque esa regla convertiría «borré todas las líneas» en «volvió el precio viejo», en silencio. `VOID` es la forma de decir «aquí no hay receta», y ésa sí cae al precio.

---

## Decisión 3 — El combo suma componentes ya costeados, y nada más

```
costo_del_combo = Σ(cantidad × COSTO_TOTAL_UNIDAD del componente) + empaque_propio
```

Con tres reglas explícitas:

| Regla | Razón |
|---|---|
| **No se vuelve a aplicar la provisión de merma** | Cada componente ya la lleva dentro de su `COSTO_TOTAL_UNIDAD`. Aplicarla otra vez es cobrar la merma dos veces, que es exactamente lo que **R12** prohíbe |
| **No se divide por `rendimiento_porciones`** | Un combo es una unidad. Sus componentes ya vienen costeados por porción |
| **Los empaques de los componentes se suman, y el combo añade el suyo si lo tiene** | Un combo servido en bandeja añade la bandeja **una vez**. Si los componentes no llevan envase propio y el combo tampoco, el total es la suma limpia |

**El descuento no se prorratea** (SPEC §8, literal). Aquí solo se suman **costos**, nunca precios de venta: el PVP del combo es suyo y suele ser menor que la suma de los sueltos —en CC-006, `4.00` frente a `1.80 + 2.50`—, y esa diferencia es del combo. En menu engineering (P8) competirá como ítem propio.

### Lo que cuesta

**Un combo de combos no se costea.** SPEC §8 dice que los componentes son productos SIMPLES y la base lo sostiene, así que el caso no existe. Si algún día existiera, el orden de evaluación —simples primero, combos después— habría que sustituirlo por un recorrido topológico como el de la cascada.

---

## Alternativas descartadas

| Alternativa | Por qué no |
|---|---|
| Tabla `packaging` con precio propio, como `T4_EMPAQUES` | Duplica la cadena de costo y R13 en dos sitios. Y no admite «caja de 100 bolsas» sin reinventar el factor de conversión |
| Empaque como una línea más de la receta | La provisión de merma se aplica al `costo_por_porcion` y **no** al empaque (SPEC §14). Como línea, el empaque pagaría merma |
| Empaque por ubicación en vez de por producto | Ninguna necesidad hoy: el Excel lo tiene por producto y el precio del ítem ya es de la company. Añadirlo sería una columna sin consumidor (YAGNI, `OPTIMIZACION.md` §1) |
| El precio de referencia gana sobre la receta | Deja la cascada sin ejecutar nunca y no paga la deuda que SPEC §5 nombra |
| Caer al precio cuando la receta está vacía | Convierte «borré las líneas» en «volvió el precio viejo», en silencio. Para eso está `VOID` |
| El combo aplica su propia merma | Cobra la merma dos veces (R12) |

---

## Consecuencias

- `empaque_neto` de SPEC §14 no tiene código propio: es el `costo_neto_uso` del ítem de empaque, por la cadena de SPEC §12 que P3 ya implementaba.
- La cascada y el precio de referencia **entran por la misma función** `costoDelItem`, así que las dos rutas hacen idéntica aritmética. Es lo que CC-005 parte A comprueba.
- El costo de un plato con subpreparaciones pasa a depender de los precios de los insumos de esas subpreparaciones. Es el efecto buscado, y también la razón de que la respuesta del costeo liste los ítems sin precio: un hueco silencioso en la cascada abarata el plato sin que nada avise.
- Un empaque cuenta como ítem para los límites de plan de D5. Con los valores generosos por defecto no cambia nada hoy.

---

## Pendiente para el usuario

**El rendimiento por lote de una subpreparación no existe.** La receta de una preparación se expresa **por unidad de uso**: para una salsa cuya receta rinde 5 litros hay que escribir las cantidades divididas entre 5. `item` no tiene columna de rendimiento por lote y P5 no se la inventa, porque el rendimiento por lote es de P6 —donde existe el movimiento de producción que lo hace significar algo—. Es incómodo de capturar y merece confirmarse antes de P6.
