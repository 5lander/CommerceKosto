# INC-029 — Corregir una compra devolvía la mercadería y no el dinero

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-19 |
| **Paquete** | P16-H (lo destapó la prueba de D-16.200) |
| **Área** | dominio · costeo |
| **Tiempo perdido** | ~35 min |
| **Recurrencias** | 0 |

> **Una `COMPRA` corregida dejaba de contar en el saldo y seguía contando en el dinero.** Las
> compras del mes salían **infladas por el doble del importe corregido**, y esa cifra entra directa
> en el food cost real (SPEC §16).

## Síntoma

La prueba nueva de D-16.200 —importar dos compras, anular la importación y mirar lo que queda—
enseñó los dos números a la vez:

```
saldo del ítem:            0.000000000000   ✔ vuelve
Σ total_cost de COMPRA:  315.652173913044   ✘ debía volver a 0, y en vez de eso se duplicó
```

157,83 importados + 157,83 de la corrección = 315,65. La corrección **sumó** en vez de restar.

## Causa raíz

Dos decisiones correctas por separado que, juntas, dejan un hueco:

1. **ADR-009 §2**: `total_cost` es una **magnitud sin signo** — «el sentido lo lleva la cantidad».
   La base lo sostiene con `CHECK (total_cost IS NULL OR total_cost >= 0)`.
2. **`domain/correccion.ts`**: la corrección **conserva el tipo** del original, para que
   `compras_del_mes = Σ(movimientos tipo COMPRA)` no cuente una compra anulada. Su cabecera lo dice
   así: «todo agregado filtrado por tipo se cancela solo, sin que ninguna consulta futura tenga que
   acordarse de restar las correcciones».

**Esa frase es cierta para la cantidad y falsa para el dinero.** La cantidad lleva signo y se
cancela sola; el importe no lo lleva, así que `SUM(total_cost)` suma los dos. El comentario que lo
implementa lo decía —«la corrección la registra con el MISMO importe»— y contradecía al puerto, que
prometía «importe invertido». La promesa que valía era la del puerto; nadie la cumplía.

Alcanzaba a tres agregaciones, todas del dinero y ninguna de la cantidad:

| Consulta | Qué alimenta |
|---|---|
| `comprasEntre` | `compras_del_mes` del cierre de conteo (SPEC §16) → **food cost real, R7** |
| `agregadosDelPeriodo.importeDeCompras` | lo mismo, por ítem, en la analítica del período |
| `comprasPorArticulo` | la comparativa de compras entre sucursales (P9) |

No se vio antes porque corregir una compra es raro a mano —una fila, un caso— y **ninguna prueba
miraba el dinero después de corregir**: todas miraban el saldo, que siempre estuvo bien.

## Solución

El importe se agrega **restando las correcciones**, en las tres consultas: una segunda agregación
sobre las filas con `reverses_movement_id` no nulo, que se resta de la primera. Se hace con la misma
`Money` del dominio —nada de punto flotante— y sigue siendo SQL agregando, no la aplicación.

Y la corrección de una `COMPRA` **conserva su artículo** (`purchase_article_id`). Antes lo perdía, y
sin él la devolución no caía en el mismo grupo que la compra: la comparativa por presentación no
podía cuadrar ni restando. El `CHECK inventory_movement_articulo_solo_en_compra` lo admite —la
corrección de una compra es una compra— y el artículo es el mismo: se devuelve lo que se compró.

## Prevención

- [x] **🔴 en `anulacion-de-importacion.spec.ts`**: tras anular, `Σ` del importe **y** del saldo
  vuelven a cero. Es la prueba que faltaba.
- [x] **🔴 en `inventario.spec.ts`**: corregir UNA compra devuelve su dinero, que es el caso
  pequeño del que salía el grande.
- [x] La cabecera de `correccion.ts` ya no promete que «todo agregado se cancela solo»: dice cuál sí
  y cuál necesita restar, y por qué.

## Referencias

- `apps/api/src/modules/inventory/infrastructure/prisma-inventario.repositorio.ts` →
  `comprasEntre`, `agregadosDelPeriodo`, `comprasPorArticulo`
- `docs/decisiones/ADR-009-el-libro-de-inventario.md` §2 y §3 · SPEC §16 · R7
