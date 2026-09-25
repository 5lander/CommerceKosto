# ADR-014 — Un producto de venta puede ser componente de otro producto, y `LNK` era eso

| | |
|---|---|
| **Estado** | Aceptada — **cierra D4** |
| **Fecha** | 2026-09-07 |
| **Paquete** | P10 |
| **Contexto** | `DECISIONES.md` D4 · `docs/SPEC.md` §8 · `ADR-008` §14 · R12 |

D4 llevaba abierta desde P0 en 🔴: *«Cuatro filas de `T1_INSUMOS` están marcadas `LNK` y el LEEME no
las documenta»*. Bloqueaba la migración de datos. Se resolvió **leyendo el archivo**, no
interpretándolo.

---

## 1. Qué es `LNK`, con la evidencia delante

`LNK` no es un tipo de insumo. La celda de precio de esas filas no contiene un precio: contiene un
enlace al **costo de un producto de venta**.

```
INS-049  Empanada de verde con queso  =IFERROR(INDEX(V_COSTEO!$H$6:$H$53,
                                                MATCH("S03", V_COSTEO!$B$6:$B$53, 0)), 0)   → 0,4234
INS-093  Panini Frontera Sur          =INDEX(V_COSTEO!$H, MATCH("P01", …))                 → 1,1033
INS-149  Papas clasicas (porcion)     =INDEX(V_COSTEO!$H, MATCH("F01", …))                 → 0  ⚠
INS-090  Pan integral                 (sin fórmula: 0,15 escrito a mano)                    ⚠
```

`V_COSTEO!H` es la columna **«Costo neto por porción»**. Y las cuatro filas se usan en **una sola
línea de receta cada una**, tres de ellas de un producto de la categoría `COMBOS UNIVERSITARIOS`:

| Ítem `LNK` | Producto que lo consume | Categoría |
|---|---|---|
| INS-049 | `C02` BREAK TIME — Empanada + americano | COMBOS UNIVERSITARIOS |
| INS-093 | `C05` POWER COMBO — Frontera Sur + americano | COMBOS UNIVERSITARIOS |
| INS-149 | `C04` CRUNCH — Papas clásicas + limonada | COMBOS UNIVERSITARIOS |
| INS-090 | `B03` Home Breakfast | POWER BREAKFAST |

**`LNK` era el apaño con el que el Excel armaba un combo.** En una hoja, un producto solo puede tener
ingredientes; para poner un plato dentro de otro plato hay que disfrazar el plato de ingrediente y
enlazar su costo. Eso es exactamente lo que esas cuatro filas hacen.

Y de paso queda cerrado el resto de la columna: `INS` (113 filas) y `SUP` (8) son estructuralmente
idénticos — `SUP` es un comprado con precio **supuesto**, que es el `confianza_precio = ESTIMADO` de
este sistema. `SUB` (24) es el ítem `PRODUCIDO`.

---

## 2. La decisión: aquí eso es `combo_component`, no un ítem

**Este sistema ya modela lo que el Excel no podía.** SPEC §8 lo dice: *«`SIMPLE` (receta a ítems) ·
`COMBO` (componentes que son productos simples)»*, y ADR-008 §14 fija lo decisivo — **el combo suma
componentes ya costeados**, sin volver a aplicar merma ni dividir por porciones.

Así que la traducción correcta de una fila `LNK` no es importarla: es **convertirla**. El producto al
que enlaza pasa a ser un componente del combo, en `combo_component`.

**Lo que estaría mal, y por qué.** Importar `LNK` como un ítem `COMPRADO` con el costo que el Excel
calculó hoy hace dos cosas malas a la vez:

1. **Congela un costo derivado.** Si mañana sube la harina, el costo de la empanada sube y el del
   combo BREAK TIME no se entera. El número sigue saliendo, y sigue siendo plausible.
2. **Cobra la merma dos veces (R12).** Una línea de receta a un ítem pasa por el rendimiento del ítem
   y por la provisión de merma no atribuible. El componente ya las llevaba aplicadas dentro de su
   propio costo: aplicarlas otra vez es exactamente lo que R12 prohíbe.

---

## 3. La consecuencia que nadie esperaba: la tabla existía y nadie la había escrito

Al implementarlo se descubrió que **`combo_component` no tenía ninguna ruta de escritura en todo el
sistema**. P4 creó la tabla, P5 la lee para costear (`componentesDeCombos`), y entre P4 y P10 **jamás
se insertó una fila**: un combo se podía crear como producto y no se podía componer nunca. Su costo
era cero.

No lo destapó ninguna prueba, porque ninguna creaba un combo con componentes. Lo destapó preguntar
qué representaba una columna de un Excel.

`GuardarRecetasEnLote` es esa ruta. **Cómo decide si una línea es receta o es combo**: por el **tipo
del producto destino**, no por una columna del archivo. Un `SIMPLE` consume ítems; un `COMBO` consume
productos. Pedirle al archivo que lo declare sería pedirle que repita algo que ya dijo, con la
posibilidad de contradecirse.

**Un combo no puede contener otro combo.** Es lo que «componentes que son productos simples»
significa, y es también lo que hace innecesario validar ciclos aquí: sin anidamiento no hay ciclo
posible. R9 cubre las subpreparaciones, que son otra tabla.

---

## 4. Las dos filas con defecto propio, y qué se hace con ellas

| Fila | Qué le pasa | Qué se hace |
|---|---|---|
| **INS-149** | Enlaza a `F01`, que **no existe** en `V_COSTEO`. El `IFERROR` lo convierte en **0**: el combo CRUNCH cuesta sus papas a cero dólares. El propio Excel lo confiesa en la nota del producto: *«Retirado: dependía de un plato de Gold Fries que ya no existe»*, y `C04` está `Activo = NO` | **Se rechaza con el motivo escrito.** Un enlace roto no se importa como costo cero: un cero es un número, y un número entra en un margen |
| **INS-090** | Marcada `LNK` pero **no enlaza nada** — 0,15 a mano, en una receta que no es combo | Es un `INS` mal tipado: entra como ítem `COMPRADO` normal |

---

## 5. Lo que se aplazó, y por qué no compromete nada

El primer cliente **no es el dueño de este Excel**, así que el importador **no aprende a leer los
códigos `INS`/`SUP`/`SUB`/`LNK`** en esta versión: sería vocabulario de un archivo que no se va a
importar (`OPTIMIZACION.md` §1). El descriptor de ítems sigue **rechazando `LNK` fila a fila**, ahora
con un mensaje que dice dónde va de verdad:

> «LNK no es un tipo de insumo: en el Excel original marcaba un producto de la carta usado dentro de
> un combo. Aquí eso se carga como producto de tipo COMBO con sus componentes, no como ítem.»

**El hallazgo vale igual sin el parseo.** Lo que este ADR fija no es cómo leer una columna: es que un
producto de venta puede ser componente de otro, que eso se escribe en `combo_component`, y que
hacerlo de la otra forma rompe R12.

---

## Consecuencias

- **D4 pasa de 🔴 a ✅.** Deja de bloquear cualquier migración de datos.
- `combo_component` tiene por fin una ruta de escritura, con su prueba de integración.
- Si algún día se importa el Excel de referencia tal cual, la traducción está escrita aquí y solo
  falta el mapeo de códigos.
