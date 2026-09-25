# P16-V — Un insumo sin precio detiene la producción (INC-032, opción (a))

> **Decisión del usuario, 2026-09-25: opción (a), rechazar.** Es la que recomendaba la ficha, y la
> que el propio código ya aplicaba del otro lado.

Cierra [INC-032](../../incidencias/INC-032-un-insumo-sin-precio-vale-cero-y-la-varianza-miente.md),
que llevaba abierta desde la pantalla 21 y era la razón por la que la pasada se había detenido por
la regla 1 del modo cierre.

## 1 · El número que estaba mal

`produccion.ts`, en `resolver`:

```ts
costoNetoDeUso: costos.get(insumo.itemId)?.costoNetoDeUso ?? Money.CERO,
```

Si un insumo no tenía precio de referencia vigente **a la fecha del lote**, se le ponía cero y se
seguía. En el caso real que lo destapó, los cinco insumos comprados tenían su precio vigente *desde
después* del 16 de septiembre:

| Magnitud | Salía | Debía salir |
|---|---|---|
| Costo estándar del lote | `16,00` | `16,00` |
| Costo real del lote | **`0,00`** | `11,30` |
| Varianza de R10 | **`−16,00`** | `−4,70` |
| Lo que el dueño lee | **«producir salió gratis»** | «el lote salió algo más barato» |

**La cifra mala no es fea: es plausible.** Una varianza negativa es justo lo que enseña una cocina
eficiente, así que nada en pantalla delataba que faltaba un precio. Y como el libro es append-only
(**R3**), la fila mal valorada no se edita: se queda, y solo se puede compensar con otra.

## 2 · Por qué (a) y no (b)

La alternativa era aceptar el lote con una marca «sin valorar» y propagarla por §16, §18 y el
consolidado. Se descartó por dos razones, y la segunda pesa más:

1. Son **dos estados nuevos que atraviesan tres vistas** — un paquete entero, no una guarda
2. **Mientras tanto deja pasar el número malo.** La única oportunidad de no tener una cifra falsa en
   un libro que no se puede editar es **no escribirla**

La fricción de (a) es real y conviene decirla: un lote no se registra hasta confirmar el precio.
Pero es fricción **el día que ocurre**, que es cuando el precio se puede confirmar — frente a un
número falso que se descubre seis meses después, cuando ya decidió precios de carta.

## 3 · Lo que se cambió

**`InsumoSinPrecioError`** en `inventory/domain/errores.ts`, con el **nombre del insumo** y la
**fecha** dentro: quien produce necesita saber *qué* confirmar, no solo que algo falta.

**`resolver`** deja de rellenar con cero y lanza. Pasa a objeto de parámetros porque necesitaba un
cuarto dato —la fecha— y CLAUDE.md §3 fija el máximo en tres.

**El comentario que justificaba el cero, eliminado.** Decía que la varianza negativa ya era «la
señal de faltan precios». No lo era: es indistinguible de un ahorro real. Un comentario que defiende
un defecto es peor que ninguno, porque lo protege de la siguiente revisión.

**`resolverInsumos`**, extraída: la llamada multilínea dejaba `ejecutar` en 41 líneas y
`audit:complexity` lo paró en el sitio (máximo 40). No se subió el umbral.

> **Es la misma regla que ya existía.** Producir un ítem cuyo *estándar* falta ya se rechazaba con
> `SIN_ESTANDAR`. Lo que INC-032 destapó es que se aplicaba a **un solo lado**.

## 4 · Pruebas

| Prueba | Qué exige |
|---|---|
| `un INSUMO sin precio a la fecha del lote DETIENE la producción` | `400 ENTRADA_INVALIDA`, con el nombre del insumo y `2026-03-15` en el mensaje |
| `y ese lote rechazado NO deja ni una fila en el libro` | `inventory_movement` e `inventory_production` con **cero filas** |

El escenario es el real: precio vigente **desde mayo**, lote **de marzo**. Para eso `itemConPrecio`
gana un tercer parámetro, `vigenteDesde`.

**CC-014** en `docs/pruebas/casos-conocidos.md`, con las cifras a mano.

### Las dos pruebas se vieron FALLAR

Antes de darlas por buenas se restauró el `?? Money.CERO` y las dos pasaron a rojo:

```
×  un INSUMO sin precio a la fecha del lote DETIENE la producción
×  y ese lote rechazado NO deja ni una fila en el libro
   Tests  2 failed | 45 passed | 1 skipped (48)
```

Una prueba que solo se ha visto en verde no prueba nada (INC-007).

### Una desviación respecto de lo que la ficha planeaba

INC-032 pedía «una prueba unitaria sobre `producirLote`». **No se puede, y el motivo importa:** el
dominio recibe los insumos **ya valorados**, así que a esa altura un cero es indistinguible de un
precio de cero. La guarda tiene que vivir donde se resuelven los costos —el caso de uso— y por eso
se prueba por la API. Queda anotado en la propia ficha.

## 5 · Lo que NO cambia

**Nada del frontend.** La pantalla 21 ya enseña el error de la API; lo que cambia es que ahora hay
uno que enseñar en vez de un lote aceptado en silencio.

**Ninguna migración.** Es una guarda de dominio, no un dato nuevo.
