# API de la aplicación cliente

> Superficie que consume la app de dueños, gerentes y bodegueros. **Estado: P2.**
> El contrato de errores es único en toda la API: `{ code, message }` (CLAUDE.md §8).

## Reglas que valen para toda la superficie

**Ningún endpoint acepta `company_id`.** El tenant sale de la sesión, y solo de ahí (Barrera 3, ADR-006). Todos los esquemas de entrada son `.strict()`: una clave de más **se rechaza con 400**, no se limpia en silencio. Mandar `companyId` es un error, no un campo ignorado.

**Autenticación por cookie, nunca por cabecera.** La sesión viaja en una cookie `HttpOnly; SameSite=Strict; Path=/` (más `Secure` en producción). No se acepta `Authorization: Bearer`: admitir las dos vías reabriría el CSRF que `SameSite=Strict` cierra.

**Deny by default.** Toda ruta exige sesión salvo las cuatro marcadas como públicas abajo.

**Autorización por capacidades, no por rol.** El endpoint declara qué hace falta *poder hacer*; qué rol tiene esa capacidad es una fila en `role_permission`.

## Códigos de error

| `code` | HTTP | Significa |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | El cuerpo no cumple el esquema. El detalle dice qué campo |
| `CREDENCIALES_INVALIDAS` | 401 | Correo o contraseña incorrectos. **Idéntico** exista o no la cuenta |
| `SESION_INVALIDA` | 401 | Sin sesión, caducada, inactiva o revocada |
| `PERMISO_DENEGADO` | 403 | Autenticado, pero le falta la capacidad. El mensaje dice cuál |
| `RECURSO_NO_ENCONTRADO` | 404 | No existe **en tu company** |
| `LIMITE_DEL_PLAN` | 409 | El permiso está bien; lo que no da es el plan |
| `CONFLICTO` | 409 | La petición está bien formada; lo que choca es el estado que ya hay (un nombre repetido) |
| `ACCESO_BLOQUEADO` | 429 | Demasiados intentos de login fallidos. Escala: 1 → 5 → 15 → 60 min |
| `TOO_MANY_REQUESTS` | 429 | El limitador de peticiones. **No es lo mismo** que el anterior |
| `INTERNAL_ERROR` | 5xx | Fallo inesperado. Cita `x-correlation-id` en el ticket |

Los dos 429 son mecanismos distintos y el `code` es cómo se distinguen: uno dice «espera un momento», el otro «tu cuenta está bloqueada».

---

## Sesión

### `POST /auth/login` — público

```json
{ "email": "ana@snacklab.ec", "contrasena": "tres cebollas moradas" }
```

**200** → `{ "expiraEn": "2026-09-05T00:00:00.000Z" }` más `Set-Cookie: sesion=…`.

**El token no viaja en el cuerpo.** Devolverlo además en el JSON anularía el `HttpOnly`: cualquier script de la página podría leerlo de la respuesta.

**401** con el mismo cuerpo exista o no la cuenta, y con el mismo coste en tiempo. **429** `ACCESO_BLOQUEADO` tras cinco fallos de la cuenta en quince minutos.

### `POST /auth/logout` — sesión

**204.** Marca `revoked_at` en el servidor y borra la cookie. La misma cookie reenviada a mano da 401: no es «borrar la cookie del navegador».

### `POST /auth/password` — sesión

```json
{ "email": "ana@snacklab.ec", "actual": "…", "nueva": "…" }
```

**200** → `{ "sesionesRevocadas": 3 }`. Revoca **todas** las sesiones, la que hace la petición incluida: hay que volver a entrar. La contraseña actual se exige aunque ya haya sesión, para que una sesión robada no deje al titular fuera de su cuenta.

La nueva debe tener 12–128 caracteres, no estar en la lista de filtradas y no contener la parte local del correo. **No hay reglas de composición**: `Password1!` está en cualquier diccionario.

---

## Ubicaciones

### `GET /ubicaciones` — `location.read`

**200** → lista **acotada al alcance del usuario**. Un rol de nivel company (`OWNER`, `ADMIN`, `LECTURA`) ve todas las de su company; un `GERENTE_LOCAL` o un `BODEGA` ven solo las suyas. El filtro es del servidor, no de la UI.

### `POST /ubicaciones` — `location.create`

```json
{ "nombre": "Centro", "tipo": "LOCAL" }
```

`tipo` ∈ `BODEGA` · `LOCAL` · `AMBOS`. **201** con la ubicación creada. **409** `LIMITE_DEL_PLAN` al llegar al máximo del plan — comprobado dentro de la misma transacción que inserta, así que dos pestañas abiertas no lo saltan.

---

## Usuarios y roles

### `POST /usuarios` — `user.invite`

```json
{ "email": "nuevo@snacklab.ec" }
```

**202**, siempre, con cuerpo vacío. **No dice si el correo ya existe**: la unicidad es global, y una respuesta franca convertiría el endpoint en un oráculo para averiguar quién más usa el sistema. Si el correo estaba libre, se envía una invitación con un código de un solo uso que caduca en siete días.

### `POST /usuarios/activacion` — público

```json
{ "token": "…", "contrasena": "higos secos en almibar" }
```

**204.** El token es de un solo uso: la activación exige `status = INVITED`, así que el mismo enlace usado dos veces no cambia nada la segunda. **401** para token inexistente, ya usado o caducado — los tres dan la misma respuesta.

### `POST /usuarios/roles` · `DELETE /usuarios/roles` — `user.update`

```json
{ "userId": "…", "rol": "GERENTE_LOCAL", "locationId": "…" }
```

`locationId` es **anulable, no opcional**: hay que escribir `"locationId": null` para un rol de nivel company. Roles: `ADMIN`, `GERENTE_LOCAL`, `BODEGA`, `LECTURA`.

**204.** Asignar dos veces el mismo rol es idempotente.

**403** si: el rol es `OWNER` (la cesión de propiedad es otra operación), el objetivo **es** el `OWNER`, el objetivo es uno mismo, o el rol lleva ubicación cuando no debe (o al revés).

**404** si el usuario no existe **en tu company** — incluido el caso de que exista en otra.

---

## Catálogo

> **Los decimales entran y salen como CADENA, nunca como número.** `"0.85"`, no `0.85`. ADR-003: un `double` de JavaScript no representa exactamente ni `0.1`, y este es el sistema donde un centavo de diferencia se acumula hasta romper la conciliación. Mandar un número JSON devuelve **400**.

### `GET /catalogo/items?incluirInactivos=true` — `catalog.read`

Los ítems de la company. Por defecto solo los activos.

`GERENTE_LOCAL` y `BODEGA` también tienen este permiso: necesitan ver los ítems para contar inventario. Un ítem no revela ninguna receta.

### `POST /catalogo/items` — `catalog.create`

```json
{
  "nombre": "Harina de trigo",
  "tipo": "COMPRADO",
  "unidadDeUso": "g",
  "rendimiento": "1",
  "grupoId": null,
  "confianzaDePrecio": "FACTURA",
  "llevaStock": null
}
```

`tipo` ∈ `COMPRADO` · `PRODUCIDO`. `confianzaDePrecio` ∈ `FACTURA` · `ESTIMADO` — el segundo es el tipo `SUP` del Excel: precio estimado sin factura de respaldo.

**`rendimiento` va entre `"0"` y `"1"`.** Es la fracción que queda tras limpiar el producto, y dividir por él **encarece** el ítem. Un valor mayor que 1 lo haría más barato que su precio de compra: **400**.

**`llevaStock` es obligatorio en una preparación y prohibido en un ítem comprado.** Dice si se produce en lote —y aparece en inventario— o si al vender se explota su receta.

**201** con `{ id }`. **409** si el nombre ya existe.

### `PUT /catalogo/items/:id` — `catalog.update`

```json
{ "nombre": "…", "rendimiento": "0.85", "grupoId": null,
  "confianzaDePrecio": "FACTURA", "estado": "INACTIVE" }
```

**204.** `PUT` y no `PATCH`: el cuerpo trae el estado completo de lo editable, para que «no mandé el grupo» y «quiero quitarle el grupo» no sean la misma petición.

**El tipo y la unidad de uso no se pueden cambiar.** Cambiar la unidad de un ítem que ya tiene recetas y movimientos convertiría cada cantidad histórica en otra magnitud sin tocarla: 200 «g» pasarían a ser 200 «kg». Si hace falta, se crea un ítem nuevo y se archiva el viejo.

**No hay `DELETE`.** Se archiva con `"estado": "INACTIVE"`.

### `GET /catalogo/articulos?itemId=…` — `catalog.read`

Los artículos de compra. **N artículos → 1 ítem**: tres marcas de harina son tres artículos y un solo ítem, y en las recetas aparece solo el ítem.

### `POST /catalogo/articulos` — `catalog.create`

```json
{
  "itemId": "…",
  "nombre": "Harina Ya 2kg",
  "marca": "Ya",
  "proveedor": null,
  "presentacion": "2",
  "unidadDePresentacion": "kg",
  "factorExplicito": null
}
```

**`factorDeConversion` no se manda: lo calcula el servidor.** Cuando la presentación y la unidad de uso del ítem comparten dimensión —kg y g— el factor sale de la física: 2 kg medidos en gramos son 2000. Mandar uno explícito en ese caso es **400**, no una preferencia: un saco de 2 kg con «factor 1500» escrito a mano produce un costo por gramo un 33 % más alto y el número es plausible en pantalla.

**`factorExplicito` hace falta cuando las dimensiones NO coinciden** —cuántas unidades de uso salen de una de compra, «un huevo pesa 50 g»— porque ahí no hay física que lo deduzca. Omitirlo es **400** con el motivo dentro.

**201** con `{ id }`. **404** si el ítem no existe en tu company. **409** si el nombre ya existe.

### `GET /catalogo/grupos` · `POST /catalogo/grupos` — `catalog.read` / `catalog.create`

```json
{ "nombre": "Lácteos" }
```

**201** con `{ id }`. **409** si ya existe.

---

## Parámetros de costeo (P3)

Los diez números de SPEC §11 y `DECISIONES.md` D3. **Ninguno está en el código**: los siembra un trigger al nacer la company con los valores del Excel original, y el motor de costeo los recibe por parámetro.

### `GET /ajustes` — `settings.read`

```json
{ "ivaVenta": "0.150000000000", "ivaCompraRecuperable": true,
  "ivaCompra": "0.150000000000", "provisionMerma": "0.020000000000",
  "foodCostObjetivo": "0.250000000000", "foodCostUmbralVerde": "0.280000000000",
  "foodCostMaximo": "0.320000000000", "primeCostMaximo": "0.650000000000",
  "reglaPopularidad": "0.700000000000", "diasOperativosMes": 22, "diasCobertura": 7 }
```

### `PUT /ajustes` — `settings.update`

**204.** El cuerpo completo, no un parche. **400** si un ratio no es una fracción —«un IVA se escribe 0.15, no 15»— o si los umbrales de food cost no van en orden: objetivo ≤ verde ≤ máximo, o el semáforo no puede pintar los tres colores.

> **La provisión de merma es `0.02` y no `0.04`, y merece no tocarse a la ligera.** Antes un único 4 % cubría cáscara, hoja botada, derrame y error de pase. Hoy cada insumo declara su rendimiento y el costo neto absorbe ahí su propia merma: el 2 % es **solo lo que ningún rendimiento explica**. Subirlo cobraría la merma dos veces, que es lo que **R12** prohíbe.

---

## Precios de referencia (P3)

**Ningún precio se mueve solo.** Sugerir y confirmar son dos operaciones, dos permisos y dos personas posibles: un `GERENTE_LOCAL` ve las compras de su local y es quien primero nota que un precio subió; confirmar es de quien responde por el margen. **No existe «actualizar un precio»**: uno nuevo es una fila nueva con otra vigencia, y de ahí sale E8 —cambiar el precio de hoy no altera el costo del mes pasado— sin escribir nada más.

### `GET /precios?itemId=…` — `pricing.read`

El historial completo de un ítem, del más reciente al más antiguo, con estado y autor.

### `POST /precios` — `pricing.suggest`

```json
{ "itemId": "…", "purchaseArticleId": "…", "precio": "2.30",
  "ivaCompra": "0.15", "origen": "MANUAL", "validFrom": "2026-03-01T00:00:00.000Z",
  "nota": null }
```

**201** con `{ id }`. Nace en estado `SUGGESTED`: **no cuenta para ningún costo** hasta que alguien lo confirme.

**`ivaCompra` es la tasa de ESE precio, no la de la company.** El SPEC nombra `iva_compra` en la fórmula de §12 y no dice dónde vive; vive aquí porque en Ecuador el alimento sin procesar es 0 % y el detergente 15 %: una tasa única por company estaría equivocada para uno de los dos, y el error entra directo en el costo de cada plato. Si se omite, se usa la de `company_settings` como valor por defecto.

**`purchaseArticleId` es obligatorio para un ítem `COMPRADO` y prohibido para uno `PRODUCIDO`** — **400** en los dos casos, con el motivo. Un importe sin presentación no dice nada: «2.30» solo significa algo junto a «el saco de 2 kg». Una preparación producida no se compra: su precio es el costo estándar por unidad de uso (**R10**).

**`origen`**: `MANUAL` · `ULTIMA_COMPRA` · `EXTERNO`. El tercero existe y no se usa: deja la puerta abierta sin acoplar nada (D8).

### `POST /precios/:id/decision` — `pricing.confirm`

```json
{ "decision": "CONFIRMED" }
```

**204.** También acepta `"REJECTED"`. **409** si ya estaba resuelto: dos administradores que confirman a la vez compiten por la misma fila, gana uno y el otro **se entera**. Responder 204 a los dos dejaría a alguien creyendo que confirmó lo que en realidad rechazó el otro.

### `GET /precios/costo/:itemId?fecha=…` — `pricing.read`

La cadena de costo de SPEC §12 entera, a una fecha:

```json
{ "precioId": "…", "vigenteDesde": "2026-01-15T00:00:00.000Z",
  "precioNeto": "2.000000000000", "costoBrutoDeUso": "0.002000000000",
  "costoNetoDeUso": "0.002352941176", "sobrecostoDeMerma": "0.000352941176" }
```

**`fecha` es un parámetro, no «ahora».** Preguntar por el mes pasado devuelve el precio que estaba vigente entonces. **404** si el ítem no tiene ningún precio **confirmado** a esa fecha — que es distinto de que valga cero.

---

## Productos (P4)

**La unidad de costeo es la porción, no el plato.** «Arroz con carne (segundo)» y «(plato fuerte)» son productos **distintos**: distinta receta, categoría, PVP y margen. El maestro es de la company y la activación es por ubicación, lo que permite comparar entre locales con un `GROUP BY product_id` en vez de emparejar por nombre.

### `GET /productos` — `product.read`

### `POST /productos` — `product.write`

```json
{ "nombre": "Empanada de verde", "tipo": "SIMPLE", "categoria": "SNACK ATTACK" }
```

**201** con `{ id }`. `tipo`: `SIMPLE` (receta a ítems) o `COMBO` (componentes que son productos simples). **409** si el nombre ya existe en la company.

### `PUT /productos/:id/ubicaciones` — `product.write`

```json
{ "locationId": "…", "activo": true, "pvp": "2.50", "rendimientoPorciones": "185" }
```

**204.** `PUT` y no `PATCH`: los tres valores se leen juntos y su coherencia se comprueba junta.

**`pvp` incluye IVA** (R14): `venta_neta = pvp / (1 + iva_venta)`. **Un producto activo necesita PVP** — **400** si `activo: true` con `pvp: null`, porque sin él se podría vender sin saber a cuánto y su margen saldría indefinido. Un plato a medio configurar se deja `activo: false`.

**`rendimientoPorciones` es cuántas porciones salen del lote.** Divide el costo de la receta. Con `0` o `null`, el costo por porción sale `0` en vez de dividir por cero (SPEC §14), y el lote sí se calcula: lo que falta es en cuántas partes repartirlo.

### `PUT /productos/:id/empaque` — `product.write` *(P5)*

```json
{ "empaqueItemId": "…" }
```

**204.** `null` quita el empaque y su `empaque_neto` pasa a cero.

**El empaque es un ÍTEM, no una tabla propia.** Se compra, tiene artículo, tiene precio con vigencia y un día se cuenta en el inventario; darle tabla propia habría duplicado la cadena de costo entera. `empaque_neto` de SPEC §14 es exactamente el `costo_neto_uso` de ese ítem. El razonamiento completo está en **ADR-008**. **404** si el ítem no existe en tu company.

---

## Recetas (P4)

**`BODEGA` no tiene `recipe.read` ni `recipe.write`**, y es la regla más dura de CLAUDE.md §4.3: las líneas de receta con sus cantidades **son** la receta. El filtrado va en la API, no en el frontend — aquí, en una fila de `role_permission` que no existe.

### `GET /recetas?locationId=…&productId=…&itemId=…&fecha=…` — `recipe.read`

La versión **vigente a una fecha**. `productId` o `itemId`, exactamente uno: el destino de una receta es un producto de venta o una subpreparación. `fecha` ausente = hoy. Devuelve `null` si no hay ninguna activa.

### `PUT /recetas` — `recipe.write`

```json
{ "destino": { "clase": "producto", "productId": "…" },
  "locationId": "…", "validFrom": "2026-03-01T00:00:00.000Z", "nota": null,
  "lineas": [ { "itemId": "…", "cantidad": "18.14", "base": "EP", "estado": "ACTIVA" } ] }
```

**201** con `{ id }`. **No es «editar»: crea una versión nueva** con su vigencia, y la anterior queda consultable — los costeos históricos no se recalculan (SPEC §9). Un trigger impide el `UPDATE` que lo rompería.

**`base` es `AP` o `EP`, y es la condicional más frágil del modelo (R4).** Si la cantidad está en `EP` —producto ya limpio— se aplica el rendimiento del ítem; si está en `AP` —tal como se compra— no. Implementarla al revés produce números plausibles y equivocados.

**`estado` es `ACTIVA` o `INACTIVA`.** Una línea inactiva cuesta **cero** y no se borra: conservarla deja ver qué se quitó y cuándo.

**400 si la receta crea un ciclo** (**R9**), directo o a cualquier profundidad, **al guardar y no al calcular**. El mensaje trae el camino dentro: `mayonesa → salsa → mayonesa`.

### `GET /recetas/propagacion/previsualizacion?productId=…&locationId=…` — `recipe.propagate`

**R11 exige mostrarlo antes de tocar nada:** cuántas ubicaciones se verían afectadas y **cuáles ya tienen receta propia que se perdería**.

### `POST /recetas/propagacion` — `recipe.propagate`

```json
{ "productId": "…", "origen": "…", "destinos": ["…", "…"] }
```

**201** con `{ id }`. **`recipe.propagate` es un permiso separado y de nivel company**, y de ahí sale E18 sin un solo `if`: un `GERENTE_LOCAL` tiene `recipe.write` y no éste, así que gestiona su receta y recibe **403** al intentar sobrescribir la del local de al lado. Un gerente no decide cómo cocina otro local.

### `POST /recetas/propagacion/:id/reversion` — `recipe.propagate`

**204. Revertir no borra nada**: crea en cada ubicación una versión nueva con las líneas de la que estaba vigente antes. Los costeos hechos entre medias usaron la receta que de verdad estaba vigente entonces y siguen siendo correctos. Sobre una ubicación que **no tenía** receta, deja una versión `VOID` —«aquí no hay receta»—, que es distinto de una receta vacía: una receta vacía cuesta cero. **409** si ya estaba revertida.

---

## Costeo (P5)

**`BODEGA` no tiene `costing.read`.** CLAUDE.md §4.3 lista «costo de plato, margen, food cost» entre los datos que no pueden salir del backend para ese rol: son derivados de la receta y permiten despejarla por aritmética.

**`GERENTE_LOCAL` sí lo tiene, y su límite es la ubicación, no el permiso**: costea su local y recibe **403** sobre otro.

### `GET /costeo?locationId=…&fecha=…` — `costing.read`

La carta entera de una ubicación, costeada. `fecha` ausente = hoy.

```json
{
  "locationId": "…",
  "fecha": "2026-03-15T00:00:00.000Z",
  "productos": [
    {
      "productId": "…", "nombre": "Tamal de pollo", "tipo": "SIMPLE",
      "categoria": "POWER BREAKFAST", "activo": true,
      "costos": {
        "costoBrutoLote":    { "mostrar": "0.51", "exacto": "0.51" },
        "costoNetoLote":     { "mostrar": "0.51", "exacto": "0.51" },
        "costoPorPorcion":   { "mostrar": "0.51", "exacto": "0.51" },
        "costoConMerma":     { "mostrar": "0.52", "exacto": "0.5202" },
        "empaqueNeto":       { "mostrar": "0.04", "exacto": "0.043478260870" },
        "costoTotalUnidad":  { "mostrar": "0.56", "exacto": "0.563678260870" },
        "impactoMerma": "0"
      },
      "venta": {
        "vendible": true,
        "ventaNeta":           { "mostrar": "1.57", "exacto": "1.565217391304" },
        "ivaEnPrecio":         { "mostrar": "0.23", "exacto": "0.234782608696" },
        "margenContribucion":  { "mostrar": "1.00", "exacto": "1.001539130434" },
        "mcPct": "0.639872222222", "foodCostPct": "0.360127777778",
        "sumaControl": "1", "multiplicador": "2.776792187906"
      },
      "itemsSinCosto": []
    }
  ]
}
```

**Todo decimal sale como cadena, en dos escalas.** Un `number` en JSON es un binario de doble precisión y `0.1 + 0.2` deja de ser `0.3` en cuanto alguien suma en el cliente. `mostrar` es la escala de presentación —el `ROUND(x, 2)` del SPEC—; `exacto` es la nativa, para sumar sin acumular error.

**`sumaControl` sale sin redondear, y tiene que ser `"1"`.** Es **R6**. Redondearla escondería el día en que dejara de serlo.

**`venta` es una unión, no un objeto con campos nulos.** Cuando el producto no tiene PVP fijado en esa ubicación:

```json
{ "vendible": false,
  "motivo": "Este producto no tiene PVP fijado en esta ubicación. El costo está calculado; el margen y el food cost necesitan un precio de venta." }
```

**Ausente, no cero.** Un `foodCostPct: 0` se lee como «este plato no cuesta nada», que es lo contrario de la verdad. Los costos **sí** se calculan: no dependen del PVP.

**`itemsSinCosto` es la advertencia que evita el error invisible.** Lista los ítems del plato sin precio confirmado ni receta a esa fecha. Cuestan cero, así que el plato sale más barato de lo que es y el número resultante es **plausible**. Vacío es lo normal; no vacío significa que el food cost está construido sobre huecos.

**`impactoMerma` es `null`, no `0`, cuando el lote bruto es cero** — tal como el SPEC lo escribe. Un `0` se leería como «esta receta no tiene merma».

**Un `COMBO` trae `costoBrutoLote = costoNetoLote = costoPorPorcion = costoConMerma`**, todos iguales a la suma de sus componentes, y `lineas` vacío: un combo no tiene receta de ítems ni lote. No vuelve a aplicar la provisión de merma —sus componentes ya la llevan dentro (**R12**)— ni divide por porciones. Ver **ADR-008**.

### `GET /costeo/:productId?locationId=…&fecha=…` — `costing.read`

Un solo producto, con la misma forma que un elemento de `productos`. **404** si el producto no existe en tu company.

> **Pide un solo producto y por dentro se costea la carta entera.** Es deliberado y no un descuido: dos rutas distintas para el mismo número son dos oportunidades de que den respuestas distintas, y en este sistema eso no se ve en pantalla. La carga completa está medida y cabe en el presupuesto.


---

## Inventario (P6)

> **Antes de leer los endpoints, la regla que explica su forma.** `BODEGA` tiene `inventory.write` e `inventory.transfer`, y **no** tiene `inventory.read`. No es un permiso olvidado: es CLAUDE.md §4.3.
>
> ```
> saldo = inicial + compras − consumo
> ```
>
> Quien registra las compras conoce el inicial y las compras. Si además ve el saldo, despeja el consumo — y el consumo dividido entre las unidades vendidas **es** la cantidad de la receta. Por eso las dos lecturas exigen `inventory.read`, y por eso **ninguna escritura de esta sección devuelve el saldo resultante**: responden con un id, y nada más.
>
> **No existe `PUT` ni `DELETE` de un movimiento.** Es R3: el libro no se edita. Un error se corrige insertando la fila que lo anula.

**Reparto de capacidades**

| Capacidad | OWNER | ADMIN | GERENTE_LOCAL | BODEGA | LECTURA |
|---|:--:|:--:|:--:|:--:|:--:|
| `inventory.read` | ✅ | ✅ | ✅ | ❌ | ✅ |
| `inventory.write` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory.transfer` | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory.produce` | ✅ | ✅ | ✅ | ❌ | ❌ |

`GERENTE_LOCAL` las tiene todas salvo el límite de su **ubicación**: `exigirUbicacionEnAlcance` le devuelve 403 sobre cualquier otra, en las dos puntas de una transferencia.

### `GET /inventario/saldos?locationId=…` — `inventory.read`

El saldo por ítem de una ubicación: la **proyección** del libro (R3). No hay campo `stock` en ninguna tabla.

```jsonc
[
  {
    "itemId": "…",
    "nombre": "Cebolla paiteña",
    "unidadDeUso": "kg",
    // CON SIGNO y a escala de almacenamiento. Un saldo negativo es un hecho
    // legítimo: significa que se consumió más de lo que se registró comprado,
    // y esconderlo taparía justo lo que hay que ver.
    "cantidad": "11.000000000000"
  }
]
```

Un ítem sin ningún movimiento **no aparece**; uno cuyos movimientos se cancelan aparece con `"0.000000000000"`. La diferencia importa: «hubo movimiento y quedó en nada» y «nunca hubo nada» son estados distintos.

### `GET /inventario/movimientos?locationId=…` — `inventory.read`

El libro, **paginado por cursor** (CLAUDE.md §5: nunca `OFFSET`).

| Parámetro | |
|---|---|
| `locationId` | obligatorio |
| `itemId` | opcional |
| `desde` · `hasta` | ISO 8601, sobre `occurredAt` |
| `limite` | 1–200, por defecto 50 |
| `cursor` | opaco. Es el `siguiente` de la página anterior |

```jsonc
{
  "movimientos": [
    {
      "id": "…",
      "tipo": "COMPRA",
      "cantidad": "10.000000000000",
      "costoTotal": "25.000000000000",
      // Cuándo ocurrió en el negocio, y cuándo entró al libro. La diferencia
      // dice cuánto se tardó en registrar, que es dato de auditoría.
      "occurredAt": "2026-03-15T00:00:00.000Z",
      "recordedAt": "2026-09-04T20:41:02.113Z",
      "transferId": null,
      "productionId": null,
      "corrigeA": null,        // este movimiento anula a otro
      "corregidoPor": "…",     // este movimiento fue anulado por otro
      "note": null
    }
  ],
  "siguiente": null
}
```

### `POST /inventario/movimientos` — `inventory.write`

Compra, merma o ajuste. **La cantidad se captura como magnitud positiva**; el signo lo pone el tipo. `AJUSTE` es la excepción: existe para mover el saldo en la dirección que haga falta, y ahí el signo sí es de quien escribe.

```jsonc
{
  "locationId": "…",
  "itemId": "…",
  "tipo": "COMPRA",              // COMPRA · MERMA · AJUSTE
  "cantidad": "10",              // "-2" solo válido en AJUSTE
  "costoTotal": "25.00",         // obligatorio en COMPRA; de ahí sale SPEC §16
  "purchaseArticleId": "…",      // solo en COMPRA: en qué presentación se compró
  "occurredAt": "2026-03-15T00:00:00.000Z",
  "note": null
}
```

→ `201 { "id": "…" }` — **y nada más.** Ver la nota de cabecera.

| Error | Cuándo |
|---|---|
| `400` | cantidad cero · signo contrario al tipo · fecha futura (con un minuto de holgura de reloj) · `COMPRA` sin importe |
| `403` | la ubicación no está en tu alcance |
| `404` | el ítem no existe en tu company |

### `POST /inventario/movimientos/:id/correccion` — `inventory.write`

**R3, la única forma de deshacer.** Inserta un movimiento **del mismo tipo**, de cantidad e importe invertidos, con la **fecha del original** — corregir es decir «esto que registré el día 3 no pasó», y ponerle fecha de hoy dejaría el saldo del día 3 mal para siempre.

Que conserve el tipo no es un detalle: es lo que hace que `compras_del_mes` (SPEC §16) se cancele sola.

```jsonc
{ "note": "me equivoqué de bodega" }
```

| Error | Cuándo |
|---|---|
| `409` | ese movimiento **ya** tiene corrección · el movimiento **es** una corrección (encadenarlas es editar con otro nombre; para eso está `AJUSTE`) |
| `404` | no existe en tu company |

### `POST /inventario/transferencias` — `inventory.transfer`

**Un par de movimientos que suma cero** (R2): el total de la company no cambia y los saldos de las dos ubicaciones sí. Se escriben junto a su cabecera en una transacción; media transferencia no existe.

```jsonc
{
  "origen": "…",
  "destino": "…",   // distinto del origen
  "itemId": "…",
  "cantidad": "4",  // magnitud: el sentido lo pone el par
  "occurredAt": "2026-03-15T00:00:00.000Z",
  "note": null
}
```

**No lleva importe**, y es deliberado: el inventario se valora al costo estándar del ítem (SPEC §16 y §18), y mover mercancía entre dos almacenes de la misma company no cambia lo que vale.

El alcance se exige **en las dos puntas**. Comprobar solo el origen dejaría abierta la mitad más peligrosa: mover stock ajeno hacia el propio.

### `POST /inventario/producciones` — `inventory.produce`

**R10.** Da de alta la preparación al **costo estándar** —su precio de referencia confirmado— y consume los insumos a su costo real. El lote guarda los dos totales, y su diferencia es la varianza.

```jsonc
{
  "locationId": "…",
  "itemId": "…",                                  // ítem PRODUCIDO con llevaStock = true
  "cantidad": "5",
  "insumos": [{ "itemId": "…", "cantidad": "2.6" }],
  "occurredAt": "2026-03-15T00:00:00.000Z",
  "note": null
}
```

**Los insumos son los que de verdad entraron, no los de la receta.** Si fueran siempre «la receta por la cantidad», el consumo real y el teórico coincidirían por construcción y la varianza operativa sería invisible. El frontend precarga desde la receta; la API registra lo que pasó.

| Error | Cuándo |
|---|---|
| `400` | el ítem es `COMPRADO` (se compra, no se produce) · es una preparación **sin stock propio** (al vender se explota su receta) · **no tiene precio de referencia confirmado** a esa fecha, y sin costo estándar no hay contra qué medir la varianza |

### `POST /inventario/consumos` — `inventory.produce`

El consumo que genera una venta. **Aquí es donde el interruptor de stock hace su trabajo**: la explosión de la receta baja hasta que encuentra algo con stock propio y ahí para.

```jsonc
{
  "locationId": "…",
  "ventas": [{ "productId": "…", "unidades": "10" }],
  "occurredAt": "2026-03-15T00:00:00.000Z",
  "note": null
}
```

→ `201 { "movimientos": ["…", "…"] }` — los ids escritos, en una sola transacción.

| `llevaStock` de la preparación | Qué se consume |
|---|---|
| `true` | **la preparación**. Ya se descontaron sus insumos al producir el lote; bajar aquí los descontaría dos veces |
| `false` | **sus insumos**. No pasa por ninguna estantería: consumirla es consumir su cebolla y su aceite |

Una línea `INACTIVA` no consume nada, igual que no cuesta nada (SPEC §13). Un ítem cuyo consumo suma cero no genera movimiento.

**No guarda las unidades vendidas**, solo su consecuencia sobre el stock. La cifra de ventas del mes —que P8 necesita para la venta neta— es un dato distinto, con su propio período, y su tabla llega con las vistas analíticas.

### `PUT /catalogo/items/:id` — `catalog.update` *(cambia en P6)*

El cuerpo gana un campo **obligatorio**, `llevaStock`, que es el interruptor de stock de una preparación. Es un reemplazo completo del ítem, no un parche, así que se manda siempre:

| Valor | Significado |
|---|---|
| `true` | la preparación se produce en lote y está en el inventario |
| `false` | al vender se explota su receta |
| `null` | el ítem es `COMPRADO`, donde el interruptor no significa nada |

Cambiarlo **no reescribe el pasado**: los movimientos ya registrados siguen siendo hechos. Lo que cambia es hasta dónde baja el consumo de las ventas que se registren a partir de entonces. Hay una prueba que lo fija.

Vive en `catalog` y no en `inventory` porque el catálogo es la fuente única de verdad (CLAUDE.md §2).

## Salud

`GET /health` (liveness, no toca la base) y `GET /ready` (readiness, sí la toca). Públicas y fuera del limitador: las sondea el orquestador cada pocos segundos.
