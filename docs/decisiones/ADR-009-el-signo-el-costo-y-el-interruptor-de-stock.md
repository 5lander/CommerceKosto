# ADR-009 — El signo, el costo del lote y el interruptor de stock

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-04 |
| **Paquete** | P6 |
| **Estado** | Aceptada |
| **Reemplaza a** | — |

## Contexto

P6 construye el libro mayor de inventario. El SPEC §7 dice qué movimientos existen y que el saldo es una proyección; R2, R3 y R10 dicen qué no se puede romper. Lo que ninguno de los dos escribe son **cuatro decisiones de modelado** que hay que tomar antes de la primera fila, y que después son caras de cambiar porque el libro es append-only: lo que se escriba mal no se edita, se corrige con otra fila.

Este ADR las registra. Las cuatro se tomaron mirando qué se rompe si se elige lo contrario.

---

## Decisión 1 — La cantidad lleva signo, y el signo lo garantiza la base

**La alternativa era** guardar magnitudes siempre positivas y deducir el sentido del tipo al consultar.

**Se eligió el signo** porque convierte el saldo en `SUM(quantity)` —una suma, no un `CASE` por tipo repetido en cada consulta y en cada informe futuro— y porque hace que R3 sea literal: «un movimiento de signo contrario» pasa a ser `cantidad.negated()` en vez de una convención que alguien tiene que recordar.

**El precio es que ahora existe una forma de escribirlo mal:** una `COMPRA` negativa o una `MERMA` positiva son saldos equivocados que nadie cuestionaría, porque el número resultante es plausible. Se cierra en tres capas:

1. **El dominio** pone el signo: `conSignoDelTipo` recibe la magnitud que el usuario capturó y aplica la dirección del tipo. Quien registra una merma escribe «2,5 kg», nunca «−2,5 kg».
2. **La base lo comprueba** con un `CHECK` que cruza `direction` con el signo de `quantity`.
3. **Ese `CHECK` no puede consultar otra tabla**, así que la dirección viaja **en la propia fila** y una **clave foránea compuesta** `(type, direction)` contra el catálogo impide que discrepe. Es el mismo mecanismo con el que P3 ató el artículo de compra a su ítem.

Sin la tercera, la segunda sería burlable: bastaría declarar `('COMPRA', 'SALIDA')` para colar una cantidad negativa. Hay una prueba que lo intenta.

---

## Decisión 2 — Se guarda el importe TOTAL, no el costo unitario

**La alternativa era** guardar `unit_cost` y multiplicar.

**Se eligió el total** porque al comprar **el hecho es la factura**. Reconstruirla como `cantidad × costo_unitario` obliga a una división previa —el total entre la cantidad en unidad de uso— cuyo redondeo pierde centavos. `compras_del_mes` de SPEC §16 dejaría de cuadrar con lo que el cliente pagó, y esa cifra entra directa en el food cost real.

El costo unitario sigue siendo calculable cuando haga falta, con escala explícita, y **no se guarda** porque un valor derivado guardado es un segundo sitio donde el mismo número puede discrepar.

`total_cost` es una **magnitud sin signo**: el sentido lo lleva la cantidad. Guardarlo con signo también sería un segundo sitio donde el sentido puede discrepar.

---

## Decisión 3 — La corrección conserva el TIPO del movimiento que anula

**La alternativa era** corregir todo con un `AJUSTE`, que es bidireccional y no pelea con la regla de signos.

**Se eligió conservar el tipo** porque `compras_del_mes = Σ(movimientos tipo COMPRA)` (SPEC §16) seguiría contando una compra anulada si su corrección fuera de otro tipo. El mes cerraría con compras que nadie hizo.

**El precio es una excepción acotada a la regla de signos:** corregir una `COMPRA` produce una `COMPRA` negativa. El `CHECK` la admite **exactamente cuando `reverses_movement_id` no es nulo**, y en ningún otro caso. La excepción se sostiene porque la regla de signos protege la **captura** —que nadie escriba una merma al revés— y una corrección no es captura: su cantidad no la escribe nadie, se deriva del movimiento que anula.

**Está medido.** El guardián 3 de P6 emite la corrección como `AJUSTE` y captura qué falla. Lo interesante no es qué falla, sino **qué no**: el saldo sigue dando cero, la reconstrucción del libro sigue coincidiendo con la proyección, y 71 de 74 pruebas siguen en verde. Lo único que lo caza es la agregación **por tipo**. Es la misma forma de fallo que P5 encontró con R7: un invariante que se cumple tapando uno que no.

---

## Decisión 4 — La producción se valora al precio de referencia, no al costo de la receta

R10 dice que el ítem `PRODUCIDO` se costea «con su precio de referencia fijo». **Esto se aparta de lo que el motor de costeo de P5 hace con el mismo ítem**, donde ADR-008 decidió que, si hay receta, manda la receta.

No es una contradicción, y conviene tener escrita la razón, porque solo aparece cuando hay un libro delante:

> **El valor de un inventario no puede cambiar porque alguien edite una receta.**

Valorar el libro con la receta vigente reescribiría el valor de lotes producidos hace meses cada vez que se guarda una versión nueva. El precio de referencia es una fila con vigencia que nadie sobrescribe (R5), y por eso es la única base estable para un asiento que ya ocurrió.

El desajuste entre ambos **no se pierde: es la varianza**, que es exactamente la señal que R10 quiere conservar — «tu costo estándar para esta preparación se quedó viejo». Y como el alta lleva el estándar y los consumos el real, **la suma de los importes de los movimientos `PRODUCCION` de un lote es la varianza**, con signo. No hay que reconstruirla desde ningún sitio.

Consecuencia asumida: **una preparación sin precio de referencia confirmado no se puede producir.** Sin costo estándar no hay contra qué medir, y valorar el alta al costo real es precisamente lo que R10 prohíbe. El error lo dice con esas palabras.

### Los insumos los declara quien produjo

No se derivan de la receta, y es lo que hace que la varianza signifique algo. Si los insumos fueran siempre «la receta por la cantidad», el consumo real y el teórico coincidirían **por construcción** y la varianza operativa —haber usado 2,2 kg donde la receta dice 2— sería invisible. La receta sirve para **precargar** el formulario; eso es trabajo del frontend (P12).

---

## Decisión 5 — `BODEGA` escribe el libro y no puede leerlo

No es una decisión nueva —es CLAUDE.md §4.3 aplicado— pero su consecuencia sí sorprende y merece quedar escrita:

```
saldo = inicial + compras − consumo
```

`BODEGA` conoce el inicial y las compras **porque las registra él**. Si además ve el saldo, despeja el consumo; y el consumo dividido entre las unidades vendidas **es** la cantidad de la receta.

De ahí salen tres cosas que no son obvias:

1. `inventory.read` **no se le concede**. `inventory.write` e `inventory.transfer`, sí.
2. **Ningún `POST` devuelve el saldo resultante.** Una respuesta que dijera «nuevo saldo: 12,4 kg» filtraría exactamente lo mismo que un endpoint de lectura. Las escrituras devuelven un id y nada más.
3. **El semáforo `REPONER`/`OK` no es de P6.** Necesita el punto de reorden, que sale del consumo teórico de SPEC §18 — eso es P8. Inventarlo aquí habría sido una columna que alguien tendría que rellenar a ojo.

El guardián 2 rompe las dos primeras de la forma en que alguien las rompería de buena fe —«si puede escribir, que pueda leer lo que escribió» y «devolvamos el saldo para ahorrar una petición»— y las tres pruebas caen.

---

## Consecuencias

| | |
|---|---|
| ✅ | El saldo es una suma. Toda vista futura de P8 y P9 agrega sin traducir signos |
| ✅ | Las agregaciones por tipo se cancelan solas cuando algo se corrige |
| ✅ | El valor del inventario no depende de la versión de receta vigente |
| ✅ | `BODEGA` puede hacer su trabajo sin poder reconstruir una receta |
| ⚠️ | La regla de signos tiene **una** excepción. Está en un solo `CHECK`, acotada a `reverses_movement_id IS NOT NULL`, y documentada en los dos sitios |
| ⚠️ | `direction` está duplicada entre el movimiento y su catálogo. La clave foránea compuesta lo hace inconsistente-imposible, pero es una columna que hay que entender para leer la tabla |
| ⚠️ | Un ítem con precio de referencia viejo produce varianza aunque la operación haya sido perfecta. **Es deliberado**, y es la señal que R10 quiere |

## Referencias

- CLAUDE.md §4.3 (confidencialidad), §5 (índices y presupuestos), R2, R3, R10
- SPEC §7 (inventario), §16 (food cost real y varianza), §18 (vista de inventario)
- **ADR-008** — la precedencia opuesta en el motor de costeo, y por qué no chocan
- `docs/pasos/P6/evidencia/guardian-2-confidencialidad-bodega.txt`
- `docs/pasos/P6/evidencia/guardian-3-correccion-de-otro-tipo.txt`
- `docs/sistema/guardas-de-dominio.md` — las 18 restricciones de P6, clasificadas
