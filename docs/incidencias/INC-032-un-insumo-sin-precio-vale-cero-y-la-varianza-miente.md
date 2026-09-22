# INC-032 — Un insumo sin precio vale CERO, y la varianza de R10 miente

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-22 |
| **Paquete** | Pantalla 21 (lo destapó producir un lote de verdad) |
| **Área** | dominio · costeo |
| **Tiempo perdido** | ~15 min |
| **Recurrencias** | 0 |

> **Sin error, sin aviso y con el número en pantalla.** Se produce un lote, el libro lo acepta, y los
> tres insumos que entraron quedan valorados en `0,00`.

## Síntoma

Registrando una producción desde la pantalla 21, con fecha **2026-09-16**:

```
2026-09-16 PRODUCCION   -0.200000000000  importe=0.000000000000   ← limón
2026-09-16 PRODUCCION   -0.350000000000  importe=0.000000000000   ← aceite
2026-09-16 PRODUCCION   -1.300000000000  importe=0.000000000000   ← camarón
2026-09-16 PRODUCCION    2.000000000000  importe=16.000000000000  ← el lote, al estándar
```

Las cantidades son correctas y el saldo también. Lo que está mal es el dinero: **el camarón cuesta
`8,695652/kg`**, así que 1,3 kg son `11,30`, no `0,00`.

## Causa raíz

`apps/api/src/modules/inventory/application/casos-de-uso/produccion.ts`, en `resolver`:

```ts
costoNetoDeUso: costos.get(insumo.itemId)?.costoNetoDeUso ?? Money.CERO,
```

**`?? Money.CERO`.** Si el insumo no tiene precio de referencia vigente *a la fecha del lote*, se le
pone cero y se sigue. En el tenant de ensayo, los cinco insumos comprados tenían su precio vigente
**desde después** del 16 de septiembre, así que `GET /precios/costos?fecha=2026-09-16` los devolvía
en `sinPrecio` y el lote se valoró contra nada.

## Por qué importa más de lo que parece

No es una celda fea: es **R10 desactivada en silencio**.

```
costoRealDelLote = Σ (costo de cada insumo)   =  0,00
varianza         = real − estándar            = −16,00
```

El sistema registra que producir **salió gratis** y que hubo un ahorro de dieciséis dólares. Esa
varianza es la que el dueño usa para saber si su cocina rinde. Y como el libro es **append-only
(R3)**, la fila mal valorada no se edita: queda, y solo se puede compensar con otra.

Es la forma de fallo que `ESTADO.md` lleva avisando desde P5: *«un invariante agregado que se cumple
tapando un desglose que no»*. El saldo en kilos cuadra perfectamente; el dinero, no.

## La incoherencia que lo delata

La misma función **sí se detiene** cuando el que no tiene precio es el ítem producido:

```ts
const estandar = costos.porItem.get(datos.itemId);
if (estandar === undefined) throw new ItemNoProducibleError(SIN_ESTANDAR);
```

Es decir: la regla «sin precio no se puede producir» ya existe y está escrita; solo que se aplica a
uno de los dos lados. Un insumo sin precio es exactamente el mismo problema, y pasa.

## Estado

**Abierta, y reportada al usuario**, porque la corrección cambia el comportamiento del dominio y
puede rechazar producciones que hoy se aceptan. Las dos salidas, con su contra:

| | Qué hace | Lo que cuesta |
|---|---|---|
| **(a) Rechazar**, como con el estándar | `InsumoSinPrecioError` con el nombre del insumo y la fecha | Un lote no se puede registrar hasta confirmar el precio. Es fricción **el día que ocurre**, no seis meses después |
| (b) Aceptar y marcar | El movimiento nace con una marca «sin valorar» y las vistas la propagan | Dos estados nuevos que atraviesan §16, §18 y el consolidado. Mucho más grande, y deja pasar el número malo |

La recomendación es **(a)**: es la regla que el propio código ya aplica del otro lado, y el momento
de enterarse de que falta un precio es cuando se produce.

## Prevención

Un caso conocido en `docs/pruebas/casos-conocidos.md` con un insumo sin precio a la fecha del lote, y
una prueba unitaria sobre `producirLote` que exija que la varianza **no** pueda salir de un real en
cero. Se escriben con la corrección, en su paquete.
