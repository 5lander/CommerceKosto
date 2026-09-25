# ADR-015 — El MC de referencia es ponderado, y viaja con sus dos operandos

| | |
|---|---|
| **Estado** | Aceptada — **cierra la duda 7 de `ESTADO.md`** |
| **Fecha** | 2026-09-07 |
| **Paquete** | P10 (commit aparte) |
| **Contexto** | `docs/SPEC.md` §15 · `ESTADO.md` duda 7 · Kasavana-Smith |

---

## El problema: el SPEC y su fuente se contradicen

P8 encontró **la única contradicción entre el SPEC y el Excel del que sale**:

| | Dice |
|---|---|
| `docs/SPEC.md` §15 | *«El MC promedio es el del total de la vista de costeo, **no la media simple**»* |
| El Excel | `=AVERAGE(P6:P53)` — que **es** la media simple |

P8 implementó lo que dice el SPEC y dejó la duda abierta, porque **no es cosmética: decide
cuadrantes**, y de un cuadrante sale la recomendación de subir el precio, rediseñar el plato o
retirarlo de la carta.

---

## La decisión: se queda PONDERADO

**Confirmado por el usuario.** `Σ(mc × unidades) / Σ(unidades)`, no `Σ(mc) / n`.

**Tres razones, en orden de peso:**

1. **Es el Kasavana-Smith canónico.** El método define el MC medio como el margen total del período
   entre las unidades totales del período. Es una media del negocio, no de la carta.
2. **La media simple le da un voto igual a cada plato, y el dueño decide por dólar.** Con cola larga
   —un plato caro que se vende una vez al mes— el promedio se desplaza hacia arriba y **convierte en
   «perros» a los platos que sostienen el negocio**. La prueba que lo fija está escrita con números:
   99 unidades a MC 1 y 1 unidad a MC 101 dan **2** ponderado y **51** en media simple; el plato de 99
   unidades sale `CABALLO` con el primero y `PERRO` con el segundo. Las dos conclusiones son
   plausibles en pantalla; una dice «trabaja su margen» y la otra «retíralo de la carta».
3. **El `AVERAGE` del Excel es el atajo que una hoja hace fácil**, no una decisión de modelo. Sumar
   productos ponderando por unidades en una hoja exige una columna auxiliar; `AVERAGE` es una celda.

**La implementación de P8 era correcta y no se toca.**

---

## Lo que sí se añade: que el cliente pueda ver por qué su Excel no cuadra

Un cliente que compare las dos hojas va a ver dos números distintos y va a llamar. El valor ya
viajaba en la respuesta (`MenuDto.mcPromedio`); lo que faltaba era poder **reproducirlo**.

Se añaden a `Menu` y a `MenuDto`:

| Campo | Qué es |
|---|---|
| `mcTotal` | El numerador: `Σ(mc × unidades)` |
| `unidadesConMargen` | El denominador **real** |
| `metodoMcPromedio` | `'PONDERADO_POR_UNIDADES'` |

`mcTotal / unidadesConMargen = mcPromedio`, exacto.

### `unidadesConMargen` no es `unidadesTotales`, y esa es la trampa

**Un producto sin PVP no entra ni en el numerador ni en el denominador**: no tiene margen que
promediar, y contarlo como cero bajaría el promedio de todos. Así que en cuanto haya un solo producto
activo sin precio, dividir `mcTotal` entre `unidadesTotales` **no reproduce** `mcPromedio`.

Sin el campo aparte, un cliente cuidadoso haría esa división, le saldría otro número, y concluiría —
razonablemente — que el sistema se equivoca. Hay una prueba que lo fija: 12 unidades totales, 10 con
margen, y las dos cifras devueltas por separado.

### Por qué el método viaja como dato y no como texto en el frontend

Si la etiqueta la escribiera la pantalla, el día que el método cambiara habría una pantalla mintiendo
hasta que alguien se acordara. Viajando pegada al número, cambian juntos.

### Y por qué la API no manda la frase

**La API da números; la prosa la escribe el frontend**, desde sus archivos de recursos (D11). Es la
misma línea que separa `mensaje` de `detalle` en los errores de dominio: el backend dice qué es, la
capa que habla con la persona decide cómo se dice y en qué idioma.

---

## Consecuencias

- La **duda 7 de `ESTADO.md` queda cerrada**.
- La pantalla de menu engineering (Fase C, pantalla 3) tiene todo lo que necesita para enseñar el MC
  de referencia con su explicación, sin calcular nada.
- Si algún día se ofreciera la media simple como opción —no está pedido—, `metodoMcPromedio` ya es el
  sitio donde se diría cuál se usó.
