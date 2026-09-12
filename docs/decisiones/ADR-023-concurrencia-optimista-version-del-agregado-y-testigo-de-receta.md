# ADR-023 — Concurrencia optimista: la versión del agregado, el testigo de la receta y la deuda entre sucursales

**Fecha:** 2026-09-12 · **Paquete:** P16-B · **Estado:** aceptada · **Decisores:** Usuario (D-16.11, D-16.20) / Claude Code (D-16.13, D-16.100…D-16.104)

---

## Contexto

Las pantallas de P16 editan con **reemplazos totales**: el formulario de la ficha de un producto
manda el PVP entero, el empaque entero, la lista de componentes entera; el editor de receta manda
todas las líneas. Hasta P16-B la API aceptaba la escritura sin saber sobre qué estado la había
preparado el usuario. Dos personas con la misma ficha abierta —la dueña y el gerente del local, un
lunes por la mañana— se pisaban sin enterarse: gana la última en pulsar «Guardar», y lo que escribió
la primera desaparece sin error, sin rastro en pantalla y con un evento de auditoría que dice que se
guardó.

En un sistema cuyo producto es la exactitud del número, un PVP que vuelve al valor de ayer porque
otro guardó encima es un food cost equivocado que nadie sabe explicar.

El usuario decidió (**D-16.11**): **concurrencia optimista, 409 `CONFLICTO_DE_VERSION`**. Y registró
de antemano una deuda aceptada (**D-16.20**): con una versión por producto, editar la sucursal A deja
obsoleto el formulario de la sucursal B aunque no se toquen.

Quedaba por decidir: qué se versiona, dónde vive la comprobación, qué se hace con la receta —que no
se edita, se versiona—, y qué pasa con las cargas en lote.

---

## Decisión 1 — Una columna `version` entera por agregado, no por tabla

`product.version` e `item.version`: `integer NOT NULL DEFAULT 1`, con `CHECK (version >= 1)`
(D-16.13; ninguna tabla tenía `updated_at`, y un instante no sirve de testigo: dos escrituras en el
mismo milisegundo tienen el mismo).

**La versión es del agregado, no de la fila.** El agregado producto es el maestro (empaque) más sus
filas de `product_location` más sus `combo_component`, porque el formulario de la ficha los presenta
juntos y el usuario los decide juntos: un cambio de empaque cambia el costo que el gerente está
mirando al fijar el PVP. Por eso **toda** escritura del agregado —`PUT /productos/:id/ubicaciones`,
`PUT /productos/:id/empaque`, `PUT /productos/:id/componentes`— exige la misma `version` y la sube.
El agregado ítem es `PUT /catalogo/items/:id`.

**Las escrituras protegidas responden 200 `{ version }`** en vez de 204: el formulario sigue abierto
tras guardar, y sin la versión nueva tendría que releer la ficha entera para poder guardar otra vez.

| Alternativa | Por qué no |
|---|---|
| `updated_at` como testigo | Resolución de reloj: dos escrituras del mismo instante empatan. Y ninguna tabla lo tenía |
| Versión por fila (`product_location.version`, `combo_component.version`) | Tres testigos para un formulario; y la lista de componentes se reemplaza entera, así que sus filas no sobreviven para llevar versión |
| `ETag` / `If-Match` en cabeceras | Mismo mecanismo con otra sintaxis, y un paso más para el frontend. Se puede añadir encima sin cambiar nada de abajo |
| Bloqueo pesimista («fulano está editando») | Exige caducidad, liberación y una pantalla para romperlo. Un formulario abandonado bloquearía el producto |

---

## Decisión 2 — La condición va en el `WHERE`, y cero filas se relee

```sql
UPDATE product SET …, version = version + 1
 WHERE id = $1 AND company_id = $2 AND version = $esperada
```

**Leer la versión, compararla en JavaScript y escribir después deja una ventana** entre las dos
sentencias: dos peticiones leen «5», las dos pasan la comparación y las dos escriben. Con la
condición dentro del `UPDATE`, PostgreSQL bloquea la fila, la primera la escribe y la sube a 6, y la
segunda —que esperaba el bloqueo— **vuelve a evaluar su `WHERE`** contra la fila ya escrita (así
funciona `READ COMMITTED`, el nivel de `TenantTransaction`) y afecta a cero filas.

**Cero filas no dice por qué**, así que solo entonces se relee en la misma transacción: si la fila no
existe (o es de otra company, que bajo RLS es lo mismo) es **404**; si existe, **409**. Nunca al revés:
un 409 sobre un producto ajeno le confirmaría a quien prueba IDs que ese producto existe.

Vive en `shared/infrastructure/persistence/escritura-versionada.ts` (`escribirConVersion`), y es
infraestructura y no dominio: es la forma de hablar con la base; la regla —«la versión tiene que ser
la leída»— es trivial y no necesita casa.

**La prueba que lo distingue de un `if` previo no es `Promise.all`.** Diez peticiones «a la vez» no
se solapan en local —la transacción es de tres sentencias— y un leer-comparar-escribir pasaba igual:
lo enseñó el guardián. La 🔴 bloquea la fila desde otra conexión (`SELECT … FOR UPDATE`), espera en
`pg_locks` a que las cinco escrituras estén paradas en el `UPDATE` y suelta: con el `WHERE`, una 200
y cuatro 409; con un `if` previo, cinco 200. Siempre, no por azar (`test/soporte/bloqueos.ts`).

---

## Decisión 3 — La receta se protege con `basadaEn`, no con una versión

La receta no se edita: **cada guardado crea una fila nueva** en `recipe` (el trigger
`recipe_no_se_edita` lo garantiza desde P4). No hay fila que condicionar con un `WHERE version = …`.
Y hay dos razones más para no reutilizar `product.version`:

1. **La receta de una subpreparación es del ítem, y `recipes` no puede escribir la tabla `item`**
   (CLAUDE.md §2: `catalog` es fuente única; lo vigila `tablas-de-catalogo-solo-en-catalog`).
2. **La receta es por ubicación.** Con `product.version`, guardar la receta del local A haría fallar
   a quien edita la del local B, que es la deuda de D-16.20 aplicada donde más duele: a la pantalla
   que más se usa.

**El testigo es «sobre cuál edité»** (D-16.101): `basadaEn` es el id de la **última versión creada**
de ese destino (producto o ítem) en esa ubicación —en cualquier estado, `VOID` incluida—, o `null` si
no hay ninguna. `PUT /recetas` lo exige; si al guardar la última ya no es esa, 409.
`GET /recetas` y `GET /recetas/versiones` publican `ultimaVersionId` para que el editor lo mande de
vuelta, y la respuesta del guardado trae el `id` nuevo, que es el `basadaEn` del siguiente.

**Aquí la condición no puede ir en un `WHERE`**: la carrera no escribe sobre una fila, INSERTA otra.
Un `SELECT … FOR UPDATE` sobre la última versión tampoco sirve —la segunda petición relee la fila que
bloqueó y no ve la nueva—. La comprobación y la inserción van bajo
`pg_advisory_xact_lock(hashtext('receta'), hashtext(destino‖ubicación))`, el patrón de D-16.62: el
candado serializa a las dos sin depender de qué filas existan, y muere con la transacción. Una
colisión de `hashtext` entre dos destinos solo las serializa de más.

**Propagar y revertir sobrescriben por definición** (testigo `sobrescribir`): R11 ya obligó a ver qué
se pisaba en la previsualización. Pasan por el mismo candado, así que un formulario abierto en la
ubicación destino recibe 409 al guardar en vez de pisar lo propagado.

La 🔴 hace la carrera determinista igual que la del producto: bloquea la fila de `product`, con la
que choca el `FOR KEY SHARE` de la clave foránea de `recipe`. Sin candado, los cinco guardados leen
la misma última versión y se paran en el `INSERT`: cinco 201. Con candado, uno 201 y cuatro 409.

---

## Decisión 4 — Los lotes no exigen versión, pero la suben

Las cargas en lote (`npm run importar`, y P20 desde la UI) **no traen versión**: no hay un formulario
detrás que la haya leído (D-16.102). Pero un formulario abierto antes de la importación tiene que
enterarse, así que:

- los componentes de combo que escribe el lote de recetas **suben la versión** del combo;
- las recetas del lote crean versiones nuevas, que cambian solas la «última creada»: el `basadaEn`
  de un editor abierto deja de coincidir sin tocar nada más.

Y el lote **sí toma el candado** de cada receta que escribe, **en orden de clave**: un editor que
guarde a mitad de importación espera en vez de colarse, y dos cargas solapadas no se bloquean en
cruz, porque piden los mismos candados en el mismo orden.

---

## Decisión 5 — Lo que NO lleva versión, con su señal

| Qué | Por qué no | Señal para añadirla |
|---|---|---|
| Artículos de compra y grupos (`PUT` de P16-A1) | D-16.13 la limitó a período, producto e ítem. Se editan poco y casi siempre una sola persona (D-16.103) | El primer cambio perdido en uno de los dos |
| `PUT /ajustes` | Lo edita la dueña; un solo formulario por company | Un segundo rol con permiso de ajustes |
| `period` | **Sí la lleva, en P16-C** (la rejilla de ventas, D-16.1) | — |

---

## Decisión 6 — El 409 no trae la versión actual

`CONFLICTO_DE_VERSION` es un código propio (409), distinto del `CONFLICTO` genérico, porque la
reacción del cliente es otra: **recargar y volver a decidir** (D-16.104). El cuerpo es
`{ code, message }` y nada más, y una 🔴 fija esas dos claves.

Con el número dentro, lo fácil —para una persona con prisa y para un frontend escrito con prisa— es
reenviar con él, que es exactamente pisar lo del otro con un paso más. Lo que el cliente necesita no
es el número: es el estado entero, y ese se obtiene releyendo.

---

## La deuda aceptada (D-16.20), y su señal

**Queda solo en `product_location`**: el PVP y la activación viven en el agregado producto, así que
fijar el PVP del local A sube la versión y deja obsoleto el formulario abierto del local B, que
recibe un 409 aunque nadie haya tocado lo suyo. Recargar lo resuelve y no se pierde nada —el 409
existe justo para que no se pierda—, pero es una fricción que no corresponde a ningún conflicto real.

La receta **no** la hereda (decisión 3), y ese es el sitio donde habría dolido.

**Señal para pagarla:** el primer 409 en `PUT /productos/:id/ubicaciones` que un usuario reporte sin
que hubiera otra persona editando el mismo local. Entonces la versión pasa a
`(product, location)`: una columna `version` en `product_location` para las escrituras por ubicación,
y la de `product` se queda para el empaque y los componentes. No se hace ahora porque exigiría dos
testigos en la ficha y el piloto tiene, por ahora, una sucursal.

---

## Lo que cuesta, dicho sin adornos

- **Todo cliente que escriba en esos cinco endpoints tiene que leer antes.** El frontend de P16 lo
  hace por construcción (el formulario sale de una lectura); un guion que hiciera `PUT` a ciegas
  recibe 400 por la versión ausente, no un guardado sin comprobar.
- **Las escrituras protegidas cambiaron de 204 a 200.** Rompe a cualquier cliente que comprobara
  `=== 204`; hoy son las pruebas de integración, y se actualizaron en P16-B.
- **Un candado consultivo por guardado de receta.** Medido en `npm run bench` («guardar una receta»,
  presupuesto 150 ms); el candado es una sentencia dentro de una transacción que ya tenía varias.
- **La versión no protege de un `psql` a mano**: un `UPDATE` que no suba la versión pasa desapercibido
  para los formularios abiertos. Es el mismo límite que cualquier regla de aplicación, y la base sigue
  garantizando lo que garantizaba.
