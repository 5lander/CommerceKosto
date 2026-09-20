# P16-H — Una importación que escribió en el libro se deshace COMO importación

> **Decisión del usuario D-16.200** (SPEC §24): «Toda importación que escriba en el libro es
> reversible **como importación**: cada movimiento importado lleva `import_job_id`;
> `POST /importaciones/:id/anulacion` emite los movimientos de signo contrario en una sola
> transacción (R3), respeta período cerrado (409 con motivo) y deja la importación en `ANULADA`.
> 🔴: importar, anular, y el saldo del tenant queda como antes.»

## 1 · El problema, en una frase

**Un archivo de movimientos mal armado deja cientos de filas en un libro que no se edita.** El mes
cambiado, la columna de cantidad en la unidad que no era, el archivo de la otra sucursal. Hasta aquí
deshacerlo era corregir movimiento por movimiento desde la pantalla, a mano, **sabiendo cuáles
eran**; y si alguien se saltaba uno, el saldo quedaba mal para siempre sin que nada avisara.

## 2 · Lo que se construyó

| Pieza | Qué |
|---|---|
| Migración `p16h_anulacion_de_importacion` | `inventory_movement.import_job_id` (nullable, FK `RESTRICT`, índice **parcial**) · estado `ANULADA` con `voided_at`/`voided_by` y sus dos CHECK · tipo de evento `inventory.import.voided` |
| `ImportJobId` | El id deja de ser una cadena suelta: ahora viaja al libro y llega por una ruta, que son las dos formas en que un identificador se confunde con otro (CLAUDE.md §3) |
| `RegistrarMovimientosEnLote` | Recibe el `importJobId` y lo pasa al lote entero. Va en el lote, no en cada fila: media importación no existe |
| `AnularMovimientosDeImportacion` (`inventory`) | Lee lo que trajo el archivo, **se salta lo ya corregido**, exige libro escribible por cada mes y ubicación distintos, y escribe todas las filas contrarias con `registrarVarios` — **una transacción** |
| `AnularImportacion` (`imports`) | Decide si se puede (404 / tres motivos de 409), delega el libro y marca `ANULADA`. No toca ni una fila de negocio, como el importador |
| `ImportacionesController` | **El primer controlador de `imports`**, con una sola ruta: `POST /importaciones/:id/anulacion`, `import.write` |

### Las tres decisiones que no son obvias

**Las filas contrarias NO llevan `import_job_id`.** Si lo llevaran, «los movimientos de esta
importación» devolvería también lo que la deshizo, y una segunda anulación intentaría anular la
primera. Su vínculo con el original ya es `reverses_movement_id`.

**Primero el libro, después el estado.** Al revés, una caída en medio dejaría una importación
marcada `ANULADA` cuyas filas siguen sumando en el saldo — la mentira peor de las dos. Así, lo que
puede quedar es una `CONFIRMADA` sin efecto, que se ve mirando el libro y se termina repitiendo la
petición.

**Solo se anula la de `MOVIMIENTOS`.** Deshacer una importación de ítems o de recetas no es escribir
la fila contraria: es borrar catálogo del que ya cuelgan precios, recetas y movimientos. Eso se mira
caso por caso, no en un endpoint. El resto recibe 409 con el motivo.

### Subir sigue sin ser un endpoint

La importación se opera desde la línea de comandos hasta que exista su pantalla (P20). La asimetría
es deliberada y está escrita en el módulo: **se entra por la puerta estrecha y se sale por la
ancha**, porque el comando puede dejar cientos de filas en el libro de un cliente y la salida no
puede esperar a una pantalla.

## 3 · INC-029 — lo que destapó la prueba

La prueba del criterio de aceptación preguntó por el dinero además de por el saldo, y salió esto:

```
saldo del ítem:            0.000000000000   ✔ vuelve
Σ total_cost de COMPRA:  315.652173913044   ✘ se duplicó
```

**Una compra corregida dejaba de contar en el saldo y seguía contando en el dinero**, desde P6.
`total_cost` es una magnitud **sin signo** (ADR-009 §2) y la corrección conserva el tipo `COMPRA`,
así que `SUM(total_cost)` sumaba las dos. La cabecera de `correccion.ts` prometía que «todo agregado
filtrado por tipo se cancela solo»: es cierto para la cantidad —lleva signo— y falso para el
importe. Alcanzaba a `compras_del_mes` (SPEC §16), que entra directa en el **food cost real (R7)**.

Arreglado en las tres agregaciones de dinero, restando las correcciones; y la corrección de una
compra **conserva su artículo**, sin el cual la devolución no caía en el mismo grupo que la compra y
la comparativa por presentación no podía cuadrar ni restando. Ficha completa en
`docs/incidencias/INC-029`.

## 4 · Pruebas 🔴

`apps/api/test/integracion/anulacion-de-importacion.spec.ts` — 7 casos, contra PostgreSQL real:

| | |
|---|---|
| **importa, anula, y la resta da cero** | Saldo a `0.000000000000`, **el libro con el doble de filas** (R3: son filas nuevas, no un borrado) y la importación en `ANULADA` |
| **el dinero también vuelve** | Con el signo aplicado da cero; y se comprueba que la suma **sin** signo NO da cero, que es la trampa de la que nació INC-029 |
| anular dos veces | 409 `CONFLICTO`, y ni una fila más en el libro |
| mes cerrado | 409, el libro intacto y la importación sigue `CONFIRMADA` |
| otra company | 404 —el mismo que uno inventado— y la importación ajena sin tocar |
| `BODEGA` | 403 **con `code: PERMISO_DENEGADO`**, no solo el estado |
| tipo no anulable | 409 nombrando por qué |

En `inventario.spec.ts`, una octava: **corregir una sola compra devuelve su dinero**, que es el caso
pequeño del que salía el grande.

## 5 · Lo que no se construyó

Ni pantalla (`/importar` es P20) ni endpoint de subida ni listado de importaciones. La superficie
nueva es una ruta.
