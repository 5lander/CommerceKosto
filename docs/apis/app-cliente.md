# API de la aplicación cliente

> Superficie que consume la app de dueños, gerentes y bodegueros. **Estado: P2.**
> El contrato de errores es único en toda la API: `{ code, message }` (CLAUDE.md §8).

## Reglas que valen para toda la superficie

**Ningún endpoint acepta `company_id`.** El tenant sale de la sesión, y solo de ahí (Barrera 3, ADR-006). Todo esquema de **cuerpo** es `.strict()`: una clave de más **se rechaza con 400**, no se limpia en silencio. Mandar `companyId` es un error, no un campo ignorado.

**Y desde P16-A2 también los ocho esquemas de consulta** (`/analitica/*`, `/consolidado`, `/costeo`, `/recetas`, `/inventario/saldos`, `/inventario/movimientos`, `/conteos`, `/periodos`). Hasta entonces eran laxos: un `?utm_source=…` o un `?companyId=…` **se descartaba en silencio y la respuesta era 200**. Ahora un parámetro de más devuelve `400 ENTRADA_INVALIDA` diciendo cuál sobra —con el nombre de la clave recortado, que el cuerpo de un error no es el eco de la petición—. Construye la URL con los parámetros documentados y ninguno más; si un enlace tuyo pega parámetros de rastreo, quítalos antes de llamar.

> **Desde P16-B lo hacen todas** (D-16.111). Las cinco que P16-A2 dejó nombradas aquí —`GET /precios?itemId=`, `GET /precios/costo/:itemId?fecha=`, `GET /catalogo/articulos?itemId=`, `GET /catalogo/items?incluirInactivos=` y `GET /recetas/propagacion/previsualizacion?productId=&origen=`— pasaron a esquema `.strict()`: una clave de más es 400, y una `fecha` que no es ISO 8601 también (antes era un 404 «sin precio» que mentía).

**CORS.** En producción no hay CORS: el frontend y la API se sirven desde el mismo origen y `CORS_ORIGENES` está vacío a propósito. Cuando sí se declaran orígenes (desarrollo, o un frontend en otro dominio), la lista es **exacta** —jamás `*`, que con credenciales el navegador rechaza— y la política permite `GET, POST, PUT, PATCH, DELETE`, las cabeceras `Content-Type` y `X-CSRF-Token`, y **expone** `x-correlation-id` y `Retry-After` para que el JavaScript de la página pueda leerlos. *(`DELETE` entra en P16-A2: existía la ruta y el preflight la rechazaba.)*

**Autenticación por cookie, nunca por cabecera.** La sesión viaja en una cookie `HttpOnly; SameSite=Strict; Path=/` (más `Secure` en producción). No se acepta `Authorization: Bearer`: hoy el único cliente es un navegador y admitir las dos vías duplicaría la superficie sin que nadie lo pida.

**Toda mutación exige la cabecera `X-CSRF-Token`** *(P16-A2, U4, ADR-021)*. Es decir: `POST`, `PUT`, `PATCH` y `DELETE`. Las lecturas no la necesitan —un CSRF sirve para provocar un efecto, y el sitio cruzado no puede leer la respuesta— y las **cuatro rutas públicas tampoco**: sin sesión no hay credencial que el navegador adjunte, luego no hay nada que suplantar. *(El login es la excepción interesante: ahí una petición cruzada no usaría una credencial, la crearía. Lo que lo cierra es que **el cuerpo de toda petición va en `application/json`** —la API no analiza formularios—, así que un `<form>` cruzado no llega a nada. Ver ADR-021.)*

- El token se obtiene del **cuerpo** de `POST /auth/login`, y se recupera tras recargar la página con `GET /auth/sesion`. Nunca viaja en una cookie: una cookie la manda el navegador sola, justo en la petición cruzada de la que este token defiende.
- Es **el de tu sesión**: uno de otra sesión da 403 igual que ninguno, aunque las dos sesiones sean del mismo usuario. Volver a entrar abre una sesión **nueva** con su propio token; **la anterior no se cierra** y sigue funcionando con el suyo — el móvil y el ordenador a la vez son dos sesiones vivas, cada una con su token. Dentro de una sesión el token **no rota**: dura lo que dure ella.
- Si falta o no coincide: **403 `CSRF_INVALIDO`**. Se arregla recargando la página, no pidiendo permisos — por eso tiene código propio y no comparte el de `PERMISO_DENEGADO`.
- **Por qué existe si la cookie ya es `SameSite=Strict`:** porque `SameSite` lo aplica el navegador y no la API (un navegador viejo lo ignora entero), y porque mira el *sitio* y no el *origen* (un subdominio del mismo dominio manda la cookie con normalidad). ADR-021 lo desarrolla.

**Deny by default.** Toda ruta exige sesión salvo las cuatro marcadas como públicas abajo.

**Autorización por capacidades, no por rol.** El endpoint declara qué hace falta *poder hacer*; qué rol tiene esa capacidad es una fila en `role_permission`.

## Códigos de error

| `code` | HTTP | Significa |
|---|---|---|
| `ENTRADA_INVALIDA` | 400 | El cuerpo no cumple el esquema. El detalle dice qué campo |
| `CREDENCIALES_INVALIDAS` | 401 | Correo o contraseña incorrectos. **Idéntico** exista o no la cuenta |
| `SESION_INVALIDA` | 401 | Sin sesión, caducada, inactiva o revocada |
| `PERMISO_DENEGADO` | 403 | Autenticado, pero le falta la capacidad. El mensaje dice cuál |
| `CSRF_INVALIDO` | 403 | La mutación no trae `X-CSRF-Token`, o el que trae no es el de esta sesión. Recarga y reintenta *(P16-A2)* |
| `RECURSO_NO_ENCONTRADO` | 404 | No existe **en tu company** |
| `PERIODO_SIN_DATOS` | 404 | Ese **mes no se ha abierto** en esa ubicación: ni ventas, ni movimientos, ni conteo. No es un enlace roto ni un mes en cero *(P16-A2, D-16.2)* |
| `LIMITE_DEL_PLAN` | 409 | El permiso está bien; lo que no da es el plan |
| `CONFLICTO` | 409 | La petición está bien formada; lo que choca es el estado que ya hay (un nombre repetido) |
| `CONFLICTO_DE_VERSION` | 409 | Alguien guardó este mismo producto, ítem o receta **después de que tú lo leyeras**. Recarga y vuelve a decidir: reenviar lo tuyo pisaría lo suyo *(P16-B, ADR-023)* |
| `ACCESO_BLOQUEADO` | 429 | Demasiados intentos de login fallidos. Escala: 1 → 5 → 15 → 60 min |
| `TOO_MANY_REQUESTS` | 429 | El limitador de peticiones. **No es lo mismo** que el anterior |
| `LIMITE_DE_SOLICITUDES` | 429 | Demasiadas veces la **misma solicitud**: olvido, restablecimiento, invitar o reenviar, por IP o por destinatario. Trae `Retry-After` en segundos y el minuto en el mensaje *(P16-A1)* |
| `INTERNAL_ERROR` | 5xx | Fallo inesperado. Cita `x-correlation-id` en el ticket |

**Los dos 404 también se distinguen por el `code`, y esto importa en pantalla.** `RECURSO_NO_ENCONTRADO` es un error: el enlace está roto o el id no es tuyo. `PERIODO_SIN_DATOS` **no lo es**: es un estado normal del producto —el mes todavía no se ha trabajado— y lo que corresponde enseñar no es un aviso rojo sino «este mes está sin abrir» con el camino para abrirlo (cargar las ventas). Lo devuelven las **seis vistas** de analítica; `GET /analitica/ventas` y `GET /analitica/costos-fijos` **no**, porque para ellas un mes sin abrir es la lista vacía.

**Un identificador mal formado es 400, no 500** *(P16-A2, INC-012)*. Un `:id` de ruta o un `?itemId=` que no sea un UUID, una `unidadDeUso` que no tenga la forma de un código corto en minúsculas (`kg`, `lt`, `unid`) y un decimal con más de 30 decimales devuelven `400 ENTRADA_INVALIDA` con un mensaje que dice qué corregir. Antes los tres salían como `INTERNAL_ERROR` y no decían nada.

**Concurrencia optimista** *(P16-B, D-16.100, ADR-023)*. Cinco escrituras de reemplazo total piden de vuelta lo que se leyó: `PUT /catalogo/items/:id`, `PUT /productos/:id/ubicaciones`, `PUT /productos/:id/empaque` y `PUT /productos/:id/componentes` llevan `version` (la de la ficha); `PUT /recetas` lleva `basadaEn` (el `ultimaVersionId` de `GET /recetas`). Si alguien escribió entre medias, **409 `CONFLICTO_DE_VERSION`**, y el cuerpo es `{ code, message }` **sin la versión actual** (D-16.104): con el número dentro lo fácil sería reenviar con él, que es pisar al otro con un paso más. Las cuatro con `version` responden **200 `{ "version": n }`** en vez de 204, para que el formulario pueda seguir guardando sin releer. Sin `version` o sin `basadaEn` es 400, no una escritura sin comprobar. Un recurso que no existe sigue siendo 404, nunca 409.

**Los números del cuerpo dicen qué aceptan** *(P16-B, INC-012)*. Un precio, un PVP, un rendimiento por lote, una presentación o una cantidad de combo de `"0"` o negativos son **400**; un importe de movimiento negativo, también. Hasta P16-B varios salían como 500 del `CHECK` de la base.

Los tres 429 son mecanismos distintos y el `code` es cómo se distinguen: uno dice «espera un momento», otro «tu cuenta está bloqueada» y el tercero «ya pediste esto demasiadas veces». **La IP que cuenta es la del cliente, no la del proxy**: detrás de Caddy se toma el último salto de `X-Forwarded-For` solo porque Caddy está en `PROXY_DE_CONFIANZA`; una cabecera falseada desde fuera no cambia nada (D-16.49).

---

## Sesión

### `POST /auth/login` — público

```json
{ "email": "ana@snacklab.ec", "contrasena": "tres cebollas moradas" }
```

**200** → `{ "expiraEn": "2026-09-05T00:00:00.000Z", "csrf": "8Kb…" }` más `Set-Cookie: sesion=…`.

**El token de sesión no viaja en el cuerpo.** Devolverlo además en el JSON anularía el `HttpOnly`: cualquier script de la página podría leerlo de la respuesta.

**`csrf` sí, y no es lo mismo** *(P16-A2)*. Es el token anti-CSRF de la sesión recién abierta, y **tiene** que ser legible por la página: su trabajo es que la página lo ponga en la cabecera `X-CSRF-Token` de cada mutación, algo que un sitio cruzado no puede hacer. No es una credencial: sin la cookie no sirve para nada. Guárdalo en memoria; si se pierde, `GET /auth/sesion` lo devuelve.

**401** con el mismo cuerpo exista o no la cuenta, y con el mismo coste en tiempo. **429** `ACCESO_BLOQUEADO` tras cinco fallos de la cuenta en quince minutos. Con el quinto fallo se **encola** un aviso al titular (`email_outbox`, plantilla `BLOQUEO`, sin enlace y sin datos); lo entrega el despachador, como los demás correos *(P16-A1; antes salía de la API por `MailerPort`, que en producción es `fake`)*.

### `GET /auth/sesion` — sesión *(P16-A2)*

**200** →

```json
{
  "userId": "018f2b8c-2222-7000-8000-000000000002",
  "permisos": ["catalog.read", "inventory.write"],
  "alcance": { "clase": "ubicaciones", "ids": ["018f…"] },
  "csrf": "8Kb…"
}
```

**Es la primera llamada de cada carga de página.** Devuelve quién eres, qué puedes, sobre qué, y el token con el que firmar las mutaciones — que es lo que permite recargar sin rotar el token ni guardarlo en `localStorage`.

`alcance` es una **unión discriminada**, no una lista: `{ "clase": "company" }` cuando el usuario puede con todas las ubicaciones de su company, o `{ "clase": "ubicaciones", "ids": [...] }` cuando su rol es de ubicación. **No se aplana**: un `ids: []` que significara «todas» es la convención que alguien lee al revés una vez y convierte en fuga.

**No lleva `companyId`, y no es un olvido.** El tenant no es un dato que el cliente pueda usar —ningún endpoint lo acepta, Barrera 3— y publicarlo solo invitaría a intentarlo.

**401** `SESION_INVALIDA` sin cookie válida. No exige ninguna capacidad: el mínimo de la API es estar autenticado, y esto no devuelve nada que el usuario no sea ya.

### `POST /auth/logout` — sesión

**204.** Marca `revoked_at` en el servidor y borra la cookie. La misma cookie reenviada a mano da 401: no es «borrar la cookie del navegador».

### `POST /auth/password` — sesión

```json
{ "email": "ana@snacklab.ec", "actual": "…", "nueva": "…" }
```

**200** → `{ "sesionesRevocadas": 3 }`. Revoca **todas** las sesiones, la que hace la petición incluida: hay que volver a entrar. La contraseña actual se exige aunque ya haya sesión, para que una sesión robada no deje al titular fuera de su cuenta.

La nueva debe tener 12–128 caracteres, no estar en la lista de filtradas y no contener la parte local del correo. **No hay reglas de composición**: `Password1!` está en cualquier diccionario.

### `POST /auth/password/olvido` — público *(P16-A1)*

```json
{ "email": "ana@snacklab.ec" }
```

**202, siempre, con cuerpo vacío** — exista o no el correo, y con el mismo trabajo en los dos casos: la API genera el token, calcula la caducidad y llama a la base; es la función `password_reset_request` la que decide, sin decirlo, si hay un usuario **activo** detrás. Si lo hay, se crea el token (hasheado) y se **encola** un correo con el enlace `APP_URL/restablecer?token=…`, que caduca en `HORAS_DE_RESTABLECIMIENTO` (1 por defecto) y sirve **una sola vez**. Un invitado que aún no activó no recibe nada: no tiene contraseña que restablecer, tiene una invitación.

El correo lo entrega el despachador, no esta petición: un 202 dice «encolado», no «enviado». **400** `ENTRADA_INVALIDA` ante cualquier clave de más. **429** `LIMITE_DE_SOLICITUDES` a partir del undécimo por IP en una hora o del cuarto para el mismo correo (exista o no), con `Retry-After`; el golpe cuenta aunque la respuesta sea 202 (D-16.50).

**Lo que el tiempo sí delata, y cuánto.** La respuesta es idéntica y el trabajo en Node también; lo que difiere es lo que la base hace por dentro: con usuario, dos `INSERT` más (milisegundos). Ese residuo no se disimula: lo acota el límite de tasa (10/h por IP, 3/h por destinatario), que impide muestrearlo, y una prueba fija que la diferencia de medianas se queda por debajo de lo que cuesta un hash (ADR-025).

### `POST /auth/password/restablecimiento` — público *(P16-A1)*

```json
{ "token": "…", "contrasena": "pimientos del piquillo asados" }
```

**204.** Gasta el token, guarda la contraseña nueva y **revoca todas las sesiones** del usuario (SEGURIDAD.md §2.2): la que hubiera abierta en otro navegador deja de valer en la siguiente petición. No devuelve cuántas eran; quien restablece no tenía sesión.

**400** `ENTRADA_INVALIDA` con el mismo mensaje para token vacío, inexistente, **ya usado** o **caducado** — los cuatro son indistinguibles a propósito. El mismo código, con su mensaje propio, si la contraseña no cumple la política (las mismas reglas que en `POST /auth/password`). **El token se gasta antes de mirar la contraseña**: una contraseña débil obliga a pedir otro enlace. Es el orden que impide reutilizar un token contra el que ya se falló. **429** `LIMITE_DE_SOLICITUDES` a partir del undécimo intento por IP en una hora, cuenten como cuenten los anteriores (diez tokens inválidos son diez golpes), y **antes** de tocar el token.

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

**202**, siempre, con cuerpo vacío. **No dice si el correo ya existe**: la unicidad es global, y una respuesta franca convertiría el endpoint en un oráculo para averiguar quién más usa el sistema. Si el correo estaba libre, se crea el invitado y **se encola** —en la misma transacción, `email_outbox`— una invitación con el enlace `APP_URL/activacion?token=…`, de un solo uso, que caduca en siete días *(desde P16-A1; antes el correo llevaba el token pelado y se enviaba fuera de la transacción)*. Si el correo no estaba libre no se encola nada. **429** `LIMITE_DE_SOLICITUDES` a partir de la trigésimo primera invitación por IP en una hora o de la cuarta al mismo correo, aunque haya sesión: un administrador con la cuenta robada es justamente quien inundaría un buzón (D-16.50).

### `POST /usuarios/:id/reenvio-de-invitacion` — `user.invite` *(P16-A1)*

Sin cuerpo. **202**: el invitado recibe un enlace **nuevo** y **el anterior deja de servir** (el token se sustituye; `app_user` tiene como mucho una invitación viva). Se encola otro correo, con la misma caducidad de siete días contada desde ahora.

**404** `RECURSO_NO_ENCONTRADO` si el usuario no está **invitado en tu company**: ya activó, no existe, o existe en otra company — los tres iguales. **400** `BAD_REQUEST` si `:id` no es un UUID. Mismo permiso que invitar: es la misma acción, repetida. **429** `LIMITE_DE_SOLICITUDES` a partir del trigésimo primer reenvío por IP en una hora (los 404 también cuentan) o del cuarto al mismo invitado.

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

### `GET /catalogo/unidades` — `catalog.read` *(P16-A2)*

El catálogo **global** de unidades, para que una pantalla ofrezca una lista en vez de un campo libre.

```json
[{ "codigo": "kg", "nombre": "kilogramo", "dimension": "MASA" }]
```

`dimension` ∈ `MASA` · `VOLUMEN` · `CONTEO`. **Ordenadas por dimensión y dentro por tamaño** —`mg, g, oz, lb, kg`—, que se lee como una escala; alfabéticamente no se lee como nada.

No lleva tenant: un kilogramo pesa lo mismo en todas las companies, la tabla es semilla de migración y el rol de la aplicación no tiene `INSERT` sobre ella. Sigue exigiendo sesión.

**No se publica el factor a base.** Es para multiplicar, no para enseñar, y serializarlo expondría el interior del tipo decimal (ADR-003). El `factorDeConversion` de un artículo lo calcula el servidor.

> **Por qué existe este endpoint.** `unidadDeUso` valida la FORMA del código y deja pasar `"l"`, que está bien escrito y no existe: el litro es `lt`. Eso llegaba al `INSERT` y moría en una clave foránea con un **500** (INC-012). Desde P16-A2 el alta de ítem lo rechaza con **400** y la lista de válidas dentro — y esta ruta es para que el usuario no llegue a escribirlo.

### `GET /catalogo/items?incluirInactivos=true` — `catalog.read`

Los ítems de la company. Por defecto solo los activos. `incluirInactivos` solo acepta `true` o `false`: `"si"` es **400**, no un `false` silencioso, y cualquier otro parámetro también *(P16-B, D-16.111)*.

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

**`unidadDeUso` tiene que EXISTIR en `GET /catalogo/unidades`**, no solo estar bien escrita *(P16-A2)*. `"l"`, `"Kg"` o `"litro"` son **400** `ENTRADA_INVALIDA`, y el mensaje enumera las diez válidas. Antes `"l"` era un **500** de la clave foránea.

**201** con `{ id }`. **409** `CONFLICTO` si el nombre ya existe en tu company. El índice es `(company_id, nombre)`: que otra company use ese nombre no estorba.

### `GET /catalogo/items/:id` — `catalog.read` *(P16-A2)*

**La ficha del insumo en una sola llamada**: el ítem, su grupo entero y sus artículos de compra.

```json
{
  "id": "…", "nombre": "Leche", "tipo": "COMPRADO", "unidadDeUso": "ml",
  "rendimiento": "0.950000000000", "grupoId": "…", "estado": "ACTIVE",
  "confianzaDePrecio": "FACTURA", "llevaStock": null, "version": 3,
  "grupo": { "id": "…", "nombre": "Lácteos", "ivaTarifa": "0.000000000000" },
  "articulos": [{ "id": "…", "itemId": "…", "nombre": "Leche entera 1lt", "marca": null,
                  "proveedor": null, "presentacion": "1.000000000000",
                  "unidadDePresentacion": "lt", "factorDeConversion": "1000.000000000000",
                  "ivaTarifa": "0.000000000000", "estado": "ACTIVE" }]
}
```

Es un **superconjunto de la fila de la lista**: `grupoId` sigue estando, para que el cliente pueda usar el mismo tipo en las dos pantallas. `grupo` es `null` si el ítem no tiene; `articulos` es `[]` si aún no tiene ninguno. La `ivaTarifa` del grupo es la que heredan las **compras sin artículo** de este ítem (D-16.9).

**404** `RECURSO_NO_ENCONTRADO` si el ítem no existe **o es de otra company** — las dos respuestas son idénticas palabra por palabra, y esa indistinción es la defensa: decir «existe pero no es tuyo» convertiría la ruta en un oráculo del catálogo del vecino. **400** `ENTRADA_INVALIDA` si `:id` no es un UUID.

### `PUT /catalogo/items/:id` — `catalog.update`

```json
{ "nombre": "…", "rendimiento": "0.85", "grupoId": null,
  "confianzaDePrecio": "FACTURA", "estado": "INACTIVE", "llevaStock": null, "version": 3 }
```

**200 `{ "version": 4 }`** *(P16-B; antes 204)*. `version` es la de `GET /catalogo/items/:id`; si otro guardó después, **409 `CONFLICTO_DE_VERSION`** y la base conserva lo suyo. `PUT` y no `PATCH`: el cuerpo trae el estado completo de lo editable, para que «no mandé el grupo» y «quiero quitarle el grupo» no sean la misma petición.

**El tipo y la unidad de uso no se pueden cambiar.** Cambiar la unidad de un ítem que ya tiene recetas y movimientos convertiría cada cantidad histórica en otra magnitud sin tocarla: 200 «g» pasarían a ser 200 «kg». Si hace falta, se crea un ítem nuevo y se archiva el viejo.

**No hay `DELETE`.** Se archiva con `"estado": "INACTIVE"`.

**404** si el ítem no existe en tu company. **409** `CONFLICTO` si el nombre nuevo ya lo usa otro ítem *(P16-A2: antes era un **500** del índice único)*.

### `GET /catalogo/articulos?itemId=…` — `catalog.read`

Los artículos de compra. `itemId` es opcional y es el único parámetro: otro cualquiera es **400** *(P16-B)*. **N artículos → 1 ítem**: tres marcas de harina son tres artículos y un solo ítem, y en las recetas aparece solo el ítem. Cada uno trae su `ivaTarifa` *(P16-A1)*.

### `GET /catalogo/articulos/:id` — `catalog.read` *(P16-A2)*

El artículo con **su ítem dentro**, que es lo que la pantalla titula.

```json
{
  "id": "…", "itemId": "…", "nombre": "Harina Ya 2kg", "marca": "Ya", "proveedor": null,
  "presentacion": "2.000000000000", "unidadDePresentacion": "kg",
  "factorDeConversion": "2000.000000000000", "ivaTarifa": "0.150000000000",
  "estado": "ACTIVE",
  "item": { "id": "…", "nombre": "Harina de trigo", "tipo": "COMPRADO", "unidadDeUso": "g",
            "rendimiento": "1.000000000000", "grupoId": null, "estado": "ACTIVE",
            "confianzaDePrecio": "FACTURA", "llevaStock": null }
}
```

**404** si no existe o es de otra company, igual que en la ficha del ítem. **400** si `:id` no es un UUID.

### `POST /catalogo/articulos` — `catalog.create`

```json
{
  "itemId": "…",
  "nombre": "Harina Ya 2kg",
  "marca": "Ya",
  "proveedor": null,
  "presentacion": "2",
  "unidadDePresentacion": "kg",
  "factorExplicito": null,
  "ivaTarifa": "0"
}
```

**`ivaTarifa` es obligatoria y es DEL ARTÍCULO** *(P16-A1, D-16.9)*: la factura del saco de harina dice 0 % y la del detergente 15 %, y ninguna company tiene «una» tarifa. Es una fracción —`"0.15"`, nunca `"15"`— y se valida en el campo: **400** si falta o no está entre 0 y 1. Los artículos anteriores a P16-A1 nacieron con `0.15` de **semilla, no de verdad**: se corrigen con el `PUT` de abajo.

**`factorDeConversion` no se manda: lo calcula el servidor.** Cuando la presentación y la unidad de uso del ítem comparten dimensión —kg y g— el factor sale de la física: 2 kg medidos en gramos son 2000. Mandar uno explícito en ese caso es **400**, no una preferencia: un saco de 2 kg con «factor 1500» escrito a mano produce un costo por gramo un 33 % más alto y el número es plausible en pantalla.

**`factorExplicito` hace falta cuando las dimensiones NO coinciden** —cuántas unidades de uso salen de una de compra, «un huevo pesa 50 g»— porque ahí no hay física que lo deduzca. Omitirlo es **400** con el motivo dentro.

**`unidadDePresentacion` tiene que EXISTIR en `GET /catalogo/unidades`.** Ya se comprobaba; lo que
cambia en P16-A2 es el **mensaje**: ahora enumera las diez válidas, igual que en el alta de ítem y en
los dos lotes del importador. Antes cada uno de los cuatro decía una cosa distinta y solo uno servía
para corregir.

**201** con `{ id }`. **404** si el ítem no existe en tu company. **409** `CONFLICTO` si el nombre ya
existe en tu company.

### `PUT /catalogo/articulos/:id` — `catalog.update` *(P16-A1)*

```json
{ "nombre": "Harina Ya 2kg", "marca": "Ya", "proveedor": null, "ivaTarifa": "0", "estado": "ACTIVE" }
```

**204.** Estado completo de lo editable, como en los ítems. **La presentación, su unidad y el factor no se cambian**: son lo que convierte cada compra histórica a unidades de uso, y cambiarlos reescribiría meses cerrados. Si el saco pasa de 2 kg a 2,5 kg, es otro artículo. **400** tarifa fuera de 0..1 · **404** no existe en tu company · **409** nombre repetido.

### `GET /catalogo/grupos` · `POST /catalogo/grupos` — `catalog.read` / `catalog.create`

```json
{ "nombre": "Lácteos", "ivaTarifa": "0" }
```

**201** con `{ id }`. **409** si ya existe. `ivaTarifa` es opcional (`null` u omitida = «el grupo no define»): es la tarifa que heredan las **compras sin artículo** de los ítems del grupo. La lista devuelve `{ id, nombre, ivaTarifa }`.

### `PUT /catalogo/grupos/:id` — `catalog.update` *(P16-A1)*

```json
{ "nombre": "Lácteos y huevos", "ivaTarifa": null }
```

**204.** Aquí `ivaTarifa` es obligatoria (anulable): es un `PUT`. **404** · **409** como arriba.

---

## Parámetros de costeo (P3)

Los diez números de SPEC §11 y `DECISIONES.md` D3. **Ninguno está en el código**: los siembra un trigger al nacer la company con los valores del Excel original, y el motor de costeo los recibe por parámetro.

### `GET /ajustes` — `settings.read`

```json
{ "ivaVenta": "0.150000000000", "ivaCompraRecuperable": true,
  "provisionMerma": "0.020000000000",
  "foodCostObjetivo": "0.250000000000", "foodCostUmbralVerde": "0.280000000000",
  "foodCostMaximo": "0.320000000000", "primeCostMaximo": "0.650000000000",
  "reglaPopularidad": "0.700000000000", "diasOperativosMes": 22, "diasCobertura": 7 }
```

### `PUT /ajustes` — `settings.update`

**204.** El cuerpo completo, no un parche. **Ya no lleva `ivaCompra`** *(P16-B, D-16.109)*: la tarifa de compra vive en el artículo y en el grupo desde P16-A1, y mandarla es **400** (el esquema es estricto) en vez de guardarse en una columna que nadie leía. **400** si un ratio no es una fracción —«un IVA se escribe 0.15, no 15»— o si los umbrales de food cost no van en orden: objetivo ≤ verde ≤ máximo, o el semáforo no puede pintar los tres colores.

> **La provisión de merma es `0.02` y no `0.04`, y merece no tocarse a la ligera.** Antes un único 4 % cubría cáscara, hoja botada, derrame y error de pase. Hoy cada insumo declara su rendimiento y el costo neto absorbe ahí su propia merma: el 2 % es **solo lo que ningún rendimiento explica**. Subirlo cobraría la merma dos veces, que es lo que **R12** prohíbe.

---

## Precios de referencia (P3)

**Ningún precio se mueve solo.** Sugerir y confirmar son dos operaciones, dos permisos y dos personas posibles: un `GERENTE_LOCAL` ve las compras de su local y es quien primero nota que un precio subió; confirmar es de quien responde por el margen. **No existe «actualizar un precio»**: uno nuevo es una fila nueva con otra vigencia, y de ahí sale E8 —cambiar el precio de hoy no altera el costo del mes pasado— sin escribir nada más.

### `GET /precios?itemId=…` — `pricing.read`

El historial completo de un ítem, del más reciente al más antiguo, con estado y autor. **Cada fila trae `vigente`** *(P16-B)*: `true` en una como mucho, la confirmada que manda **hoy** —la de vigencia más reciente que ya empezó—. Lo decide la API, no la pantalla: con dos confirmados de la misma vigencia, el desempate es una regla (D-16.3).

### `GET /precios/pendientes?limite=50&despuesDe=…` — `pricing.read` *(P16-B)*

La bandeja de R5: los precios `SUGGESTED`, cada uno con lo que hace falta para decidirlo sin abrir otra pantalla.

```json
{ "pendientes": [
    { "id": "…", "itemId": "…", "purchaseArticleId": "…", "precio": "2.450000000000",
      "ivaCompra": "0.150000000000", "origen": "MANUAL", "estado": "SUGGESTED",
      "validFrom": "2026-02-01T00:00:00.000Z", "createdAt": "…", "nota": null,
      "itemNombre": "Harina de trigo", "articuloNombre": "Saco 2kg",
      "precioVigente": "2.100000000000" } ],
  "siguiente": "…" }
```

**`precioVigente` es el confirmado que manda hoy para ese ítem**, o `null` si todavía no tiene: sin él al lado, «2.45» es un número suelto y no «subió de 2.10 a 2.45». `articuloNombre` es `null` en una preparación (R10).

**Por cursor, nunca `OFFSET`** (CLAUDE.md §5): `limite` entre 1 y 200, 50 por defecto; `siguiente` es el `despuesDe` de la página siguiente, o `null` en la última.

### `GET /precios/costos?fecha=…` — `pricing.read` *(P16-B)*

El costo por unidad de uso de **todos** los ítems a una fecha —el listado de insumos—, en cuatro consultas fijas.

```json
{ "fecha": "2026-03-01T00:00:00.000Z",
  "costos": [ { "itemId": "…", "precioNeto": "2.000000000000", "costoBrutoDeUso": "0.001000000000",
                "costoNetoDeUso": "0.001176470588", "sobrecostoDeMerma": "0.000176470588" } ],
  "sinPrecio": ["…"] }
```

**Los que no tienen precio confirmado van en `sinPrecio`, no con un cero**: un cero parecería un costo, y un insumo a cero abarata el plato sin avisar. Los importes salen con su escala de almacenamiento: son costos de uso, que se multiplican por la cantidad de cada línea. `fecha` ausente = ahora; una fecha que no es ISO 8601 es **400**.

### `POST /precios` — `pricing.suggest`

```json
{ "itemId": "…", "purchaseArticleId": "…", "precio": "2.30",
  "ivaCompra": "0.15", "origen": "MANUAL", "validFrom": "2026-03-01T00:00:00.000Z",
  "nota": null }
```

**201** con `{ id }`. Nace en estado `SUGGESTED`: **no cuenta para ningún costo** hasta que alguien lo confirme.

**`precio` es mayor que cero** *(P16-B)*: `"0"` o `"-1"` son **400**. Hasta P16-B salían como 500 del `CHECK` (INC-012, cuarta recurrencia). Si todavía no se sabe el precio, no se registra.

**`ivaCompra` es la tasa de ESE precio, no la de la company.** El SPEC nombra `iva_compra` en la fórmula de §12 y no dice dónde vive; vive aquí porque en Ecuador el alimento sin procesar es 0 % y el detergente 15 %: una tasa única por company estaría equivocada para uno de los dos, y el error entra directo en el costo de cada plato. **Con `null` se toma la del artículo o, sin artículo, la del grupo del ítem; sin ninguna, 400** *(P16-A1, D-16.43: ya no hay valor por defecto de company)*.

**`purchaseArticleId` es obligatorio para un ítem `COMPRADO` y prohibido para uno `PRODUCIDO`** — **400** en los dos casos, con el motivo. Un importe sin presentación no dice nada: «2.30» solo significa algo junto a «el saco de 2 kg». Una preparación producida no se compra: su precio es el costo estándar por unidad de uso (**R10**).

**Y una preparación no lleva IVA de compra** *(P16-A1, D-16.51)*: su `ivaCompra` nace **`"0"`** ignore lo que diga su grupo —el costo estándar ya es neto, y netearlo otra vez subcostearía el plato—, y mandar cualquier tarifa distinta de cero es **400** con el motivo. `null` y `"0"` son las dos formas válidas. Lo mismo en el CSV `PRECIOS`: la columna `iva` de una preparación va vacía o en `0`.

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

**`fecha` es un parámetro, no «ahora».** Preguntar por el mes pasado devuelve el precio que estaba vigente entonces. **404** si el ítem no tiene ningún precio **confirmado** a esa fecha — que es distinto de que valga cero. **Una `fecha` que no es ISO 8601 es 400** *(P16-B, D-16.111)*: hasta entonces `fecha=basura` llegaba como fecha inválida y respondía ese mismo 404, que mentía.

---

## Productos (P4)

**La unidad de costeo es la porción, no el plato.** «Arroz con carne (segundo)» y «(plato fuerte)» son productos **distintos**: distinta receta, categoría, PVP y margen. El maestro es de la company y la activación es por ubicación, lo que permite comparar entre locales con un `GROUP BY product_id` en vez de emparejar por nombre.

### `GET /productos` — `product.read`

### `GET /productos/:id` — `product.read` *(P16-B)*

```json
{ "id": "…", "nombre": "Empanada de verde", "tipo": "SIMPLE", "categoria": "SNACK ATTACK",
  "estado": "ACTIVE", "empaqueItemId": null, "version": 4 }
```

**La ficha, con la `version` que las tres escrituras del producto piden de vuelta** (ADR-023). La versión es del **agregado**: sube con el empaque, con la configuración de **cualquier** ubicación y con los componentes. **404** idéntico si el producto no existe o es de otra company. `BODEGA` no tiene `product.read`: **403**.

### `GET /productos/:id/ubicaciones` — `product.read` *(P16-B)*

`[{ "locationId": "…", "activo": true, "pvp": "2.50", "rendimientoPorciones": "1" }]` — dónde está configurado el producto. **Filtrado por alcance** (D-16.113): `ADMIN` ve todas; un `GERENTE_LOCAL`, solo la suya.

### `GET /productos/ubicaciones?locationId=…` — `product.read` *(P16-B)*

`[{ "productId": "…", "nombre": "…", "tipo": "SIMPLE", "categoria": "…", "activo": true, "pvp": "2.50", "rendimientoPorciones": "1" }]` — **la carta de una ubicación**, con nombre: lo que la rejilla de ventas necesita. La ubicación tiene que estar en tu alcance (**403** si no). `BODEGA` no la recibe: la respuesta lleva PVP.

### `POST /productos` — `product.write`

```json
{ "nombre": "Empanada de verde", "tipo": "SIMPLE", "categoria": "SNACK ATTACK" }
```

**201** con `{ id }`. `tipo`: `SIMPLE` (receta a ítems) o `COMBO` (componentes que son productos simples). **409** si el nombre ya existe en la company.

### `PUT /productos/:id/ubicaciones` — `product.write`

```json
{ "locationId": "…", "activo": true, "pvp": "2.50", "rendimientoPorciones": "185", "version": 4 }
```

**200 `{ "version": 5 }`** *(P16-B; antes 204)*. `version` es la de `GET /productos/:id`; **409 `CONFLICTO_DE_VERSION`** si otra escritura del producto llegó antes — **aunque fuera en otra ubicación**, que es la deuda aceptada de D-16.20 (ADR-023). `PUT` y no `PATCH`: los tres valores se leen juntos y su coherencia se comprueba junta.

**`pvp` incluye IVA** (R14): `venta_neta = pvp / (1 + iva_venta)`. **Un producto activo necesita PVP** — **400** si `activo: true` con `pvp: null`, porque sin él se podría vender sin saber a cuánto y su margen saldría indefinido. Un plato a medio configurar se deja `activo: false`.

**`rendimientoPorciones` es cuántas porciones salen del lote.** Divide el costo de la receta. Con `null`, el costo por porción sale `0` en vez de dividir por cero (SPEC §14), y el lote sí se calcula: lo que falta es en cuántas partes repartirlo. **`"0"` ya no es una forma de decir «sin capturar»: es 400**, igual que un `pvp` de `"0"` *(P16-B; hasta entonces los dos salían como 500 del `CHECK`, INC-012)*.

### `PUT /productos/:id/empaque` — `product.write` *(P5)*

```json
{ "empaqueItemId": "…", "version": 5 }
```

**200 `{ "version": 6 }`** *(P16-B; antes 204)*, con la misma regla de `version` y **409** que la configuración por ubicación. `null` quita el empaque y su `empaque_neto` pasa a cero.

**El empaque es un ÍTEM, no una tabla propia.** Se compra, tiene artículo, tiene precio con vigencia y un día se cuenta en el inventario; darle tabla propia habría duplicado la cadena de costo entera. `empaque_neto` de SPEC §14 es exactamente el `costo_neto_uso` de ese ítem. El razonamiento completo está en **ADR-008**. **400 `ENTRADA_INVALIDA`** si el ítem de empaque no existe en tu company *(P16-B, D-16.112; antes un 404 «producto no encontrado» que señalaba lo que sí existía)*. **404** si el que no existe es el producto.

### `GET /productos/:id/componentes` · `PUT /productos/:id/componentes` — `product.read` / `product.write` *(P16-B)*

```json
{ "version": 6, "componentes": [ { "productId": "…", "nombre": "Café americano", "cantidad": "1" } ] }
```

La lectura trae los componentes de un combo con su nombre y la `version` del combo. La escritura manda `{ "version": 6, "componentes": [{ "productId": "…", "cantidad": "1" }] }` y **reemplaza la lista entera**: lo que no venga deja de ser componente. **200 `{ "version": 7 }`**, **409** con versión vieja (y la lista no cambia).

**400 con su motivo, antes de tocar la base** (D-16.114): el destino no es un `COMBO`; un componente no es `SIMPLE` —un combo dentro de otro—; el propio combo como componente; un producto repetido; un producto de otra company; `cantidad` de `"0"`; más de 50. `GERENTE_LOCAL` lee y no escribe: el combo es de la company entera.

---

## Recetas (P4)

**`BODEGA` no tiene `recipe.read` ni `recipe.write`**, y es la regla más dura de CLAUDE.md §4.3: las líneas de receta con sus cantidades **son** la receta. El filtrado va en la API, no en el frontend — aquí, en una fila de `role_permission` que no existe.

### `GET /recetas?locationId=…&productId=…&itemId=…&fecha=…` — `recipe.read`

La versión **vigente a una fecha**, y sobre cuál se edita. `productId` o `itemId`, exactamente uno: el destino de una receta es un producto de venta o una subpreparación. `fecha` ausente = hoy.

```json
{ "vigente": { "id": "…", "locationId": "…", "estado": "ACTIVE", "validFrom": "…", "nota": null,
               "lineas": [ { "itemId": "…", "cantidad": "18.14", "base": "EP", "estado": "ACTIVA", "orden": 0 } ] },
  "ultimaVersionId": "…" }
```

**Cambió de forma en P16-B** (antes devolvía la receta suelta, o `null`). `vigente` es `null` si no hay ninguna activa a esa fecha. **`ultimaVersionId` es la última versión CREADA** —en cualquier estado y con cualquier vigencia— y es lo que `PUT /recetas` pide de vuelta como `basadaEn`: no tiene por qué ser la vigente, porque se puede haber guardado una con vigencia futura.

### `PUT /recetas` — `recipe.write`

```json
{ "basadaEn": "…", "destino": { "clase": "producto", "productId": "…" },
  "locationId": "…", "validFrom": "2026-03-01T00:00:00.000Z", "nota": null,
  "lineas": [ { "itemId": "…", "cantidad": "18.14", "base": "EP", "estado": "ACTIVA" } ] }
```

**201** con `{ id }`, que es el `basadaEn` del siguiente guardado. **`basadaEn` es obligatorio** *(P16-B, ADR-023)*: el `ultimaVersionId` que se leyó, o `null` si no había ninguna. Si otra versión se creó entre medias —otro editor, una propagación, una importación— es **409 `CONFLICTO_DE_VERSION`** y no se escribe nada. El testigo es por **destino y ubicación**: guardar la receta de un local no bloquea a quien edita la de otro. **No es «editar»: crea una versión nueva** con su vigencia, y la anterior queda consultable — los costeos históricos no se recalculan (SPEC §9). Un trigger impide el `UPDATE` que lo rompería.

**`base` es `AP` o `EP`, y es la condicional más frágil del modelo (R4).** Si la cantidad está en `EP` —producto ya limpio— se aplica el rendimiento del ítem; si está en `AP` —tal como se compra— no. Implementarla al revés produce números plausibles y equivocados.

**`estado` es `ACTIVA` o `INACTIVA`.** Una línea inactiva cuesta **cero** y no se borra: conservarla deja ver qué se quitó y cuándo.

**400 si la receta crea un ciclo** (**R9**), directo o a cualquier profundidad, **al guardar y no al calcular**. El mensaje trae el camino dentro: `mayonesa → salsa → mayonesa`.

### `GET /recetas/versiones?locationId=…&productId=…&itemId=…` — `recipe.read` *(P16-B)*

`{ "versiones": [ …como vigente… ], "ultimaVersionId": "…" }` — todas las versiones de ese destino en esa ubicación, de la vigencia más reciente a la más antigua, `VOID` incluidas. La ubicación tiene que estar en tu alcance.

### `GET /recetas/propagacion?productId=…` — `recipe.propagate` *(P16-B)*

```json
[ { "id": "…", "productId": "…", "propagadaEn": "…", "revertidaEn": null,
    "destinos": [ { "locationId": "…", "anterior": "…", "creada": "…" } ] } ]
```

Las propagaciones de un producto, la más reciente primero, **50 como mucho**. Pide el permiso de propagar y no el de leer: la lista existe para revertir una, y quien no puede propagar no tiene nada que revertir. `anterior` es `null` donde no había receta.

### `GET /recetas/propagacion/previsualizacion?productId=…&origen=…` — `recipe.propagate`

**R11 exige mostrarlo antes de tocar nada:** cuántas ubicaciones se verían afectadas y **cuáles ya tienen receta propia que se perdería**. `origen` es la ubicación cuya receta se copiaría; los dos parámetros son UUID y **no admite otros** *(P16-B: antes eran dos `@Query` sueltos sin esquema; esta documentación decía `locationId`, y el parámetro siempre fue `origen`)*.

### `POST /recetas/propagacion` — `recipe.propagate`

```json
{ "productId": "…", "origen": "…", "destinos": ["…", "…"] }
```

**201** con `{ id }`. Propagar **sobrescribe por definición** —R11 ya obligó a ver qué se pisaba—, así que no lleva `basadaEn`; pero crea versiones nuevas, y un editor abierto en una ubicación destino recibe **409** al guardar en vez de pisar lo propagado. **`recipe.propagate` es un permiso separado y de nivel company**, y de ahí sale E18 sin un solo `if`: un `GERENTE_LOCAL` tiene `recipe.write` y no éste, así que gestiona su receta y recibe **403** al intentar sobrescribir la del local de al lado. Un gerente no decide cómo cocina otro local.

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
        "impactoMerma": "0",
        "lineas": [
          { "itemId": "…", "nombre": "Masa de maíz", "cantidad": "0.120000000000", "base": "EP",
            "estado": "ACTIVA", "costo": { "mostrar": "0.31", "exacto": "0.3120" },
            "participacion": "0.611764705882" }
        ]
      },
      "venta": {
        "vendible": true,
        "ventaNeta":           { "mostrar": "1.57", "exacto": "1.565217391304" },
        "ivaEnPrecio":         { "mostrar": "0.23", "exacto": "0.234782608696" },
        "margenContribucion":  { "mostrar": "1.00", "exacto": "1.001539130434" },
        "mcPct": "0.639872222222", "foodCostPct": "0.360127777778",
        "sumaControl": "1", "multiplicador": "2.776792187906"
      },
      "itemsSinCosto": [],
      "semaforoFoodCost": "AMBAR"
    }
  ]
}
```

**`semaforoFoodCost` lo decide la API** *(P16-B, D-16.105)*: `VERDE` hasta el `foodCostUmbralVerde` de la company, `AMBAR` hasta el `foodCostMaximo`, `ROJO` por encima. **Los bordes son del lado bueno**: exactamente en el umbral es verde, exactamente en el máximo es ámbar. `SIN_DATO` cuando el producto no es vendible —sin PVP no está en verde, está sin medir—. La pantalla lo pinta y no compara nada (la copia en el navegador fue INC-020).

**`costos.lineas` es el desglose de SPEC §13**, una entrada por línea de la receta y en su orden: el ítem, cuánto lleva, su costo y cuánto pesa en el costo neto del lote. **Sale solo si la sesión tiene `recipe.read`; si no, `null`** (D-16.106): hoy los cuatro roles con `costing.read` también leen recetas, y la regla es para el rol que algún día no lo haga — las cantidades son la receta misma (§4.3).

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

Un solo producto, con la misma forma que un elemento de `productos`, más `pvpSimulado`. **404** si el producto no existe en tu company.

**`?pvp=3.00` simula un precio de venta sin guardarlo** *(P16-B, D-16.107)*: recalcula solo el lado de venta —venta neta, margen, food cost, multiplicador y semáforo— con la **misma** función que el costeo real, y deja los costos intactos. `pvpSimulado` repite el valor usado, o `null` sin simulación. Nada se escribe. Un `pvp` de `"0"` es **400**.

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
      "costoTotal": "100.000000000000",     // en una COMPRA con desglose, el NETO
      // P16-A1: los cuatro importes de una COMPRA nueva (D-16.10). Una fila
      // anterior, o una MERMA/AJUSTE, trae "desglose": "SIN_DESGLOSE" y NINGUNO
      // de los tres campos siguientes — ausentes, no en null.
      "desglose": "CONOCIDO",
      "totalBruto": "115.000000000000",
      "ivaTarifaAplicada": "0.150000000000",
      "ivaRecuperableAplicado": true,
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
  "costoTotal": "115.00",        // obligatorio en COMPRA: EL TOTAL DE LA FACTURA, CON IVA
  "purchaseArticleId": "…",      // solo en COMPRA: en qué presentación se compró
  "ivaTarifa": null,             // solo en COMPRA, opcional: manda sobre artículo y grupo
  "occurredAt": "2026-03-15T00:00:00.000Z",
  "note": null
}
```

→ `201 { "id": "…" }` — **y nada más.** Ver la nota de cabecera.

**Una `COMPRA` se netea al entrar** *(P16-A1, D-16.9, D-16.10)*. El bodeguero teclea el total de la factura; la tarifa sale de **cuerpo > artículo > grupo del ítem**, la recuperabilidad de `GET /ajustes`, y el libro guarda los cuatro importes: bruto, tarifa aplicada, recuperabilidad aplicada y `total_cost` = neto (`neto = recuperable ? bruto / (1 + tarifa) : bruto`, SPEC §12). Son la foto del momento: cambiar el ajuste después no reescribe el libro. **Nunca se asume una tarifa**: sin ninguna, **400** con el mensaje que dice dónde ponerla.

| Error | Cuándo |
|---|---|
| `400` | cantidad cero · signo contrario al tipo · fecha futura (con un minuto de holgura de reloj) · `COMPRA` sin importe · **`COMPRA` sin tarifa de IVA en ningún nivel** · `ivaTarifa` fuera de 0..1 o en un tipo que no es `COMPRA` · artículo de otro ítem |
| `403` | la ubicación no está en tu alcance |
| `404` | el ítem no existe en tu company |

### `POST /inventario/movimientos/:id/correccion` — `inventory.write`

**R3, la única forma de deshacer.** Inserta un movimiento **del mismo tipo**, de cantidad e importe invertidos, con la **fecha del original** — corregir es decir «esto que registré el día 3 no pasó», y ponerle fecha de hoy dejaría el saldo del día 3 mal para siempre.

Que conserve el tipo no es un detalle: es lo que hace que `compras_del_mes` (SPEC §16) se cancele sola. **Y copia el desglose entero** *(P16-A1, D-16.41)*: la corrección de una compra con los cuatro importes lleva los cuatro, así Σ(bruto) del mes se cancela igual que Σ(neto).

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

## Períodos y conteo físico (P7)

**Dos permisos separan contar de conciliar, y esa línea es CLAUDE.md §4.3.**
`BODEGA` tiene `count.write` y `period.read`; no tiene `count.read`. La hoja de
conteo no lleva stock teórico ni nada derivado de él, y la conciliación —que sí
lo lleva— le devuelve 403.

| Endpoint | Permiso | Quién lo tiene |
|---|---|---|
| `GET /periodos` | `period.read` | Todos, `BODEGA` incluido |
| `POST /periodos/:id/reapertura` | `period.reopen` | **Solo `OWNER`** |
| `POST /conteos` · `GET /conteos` · `GET /conteos/:id/hoja` · `PUT /conteos/:id/lineas` · `POST /conteos/:id/confirmacion` | `count.write` | `OWNER`, `ADMIN`, `GERENTE_LOCAL`, `BODEGA` |
| `POST /conteos/:id/cierre-de-periodo` | `count.write` **y** `period.close` | `OWNER`, `ADMIN`, `GERENTE_LOCAL` |
| `GET /conteos/:id` | `count.read` | Todos **menos `BODEGA`** |

### `GET /periodos?locationId=…` — `period.read`

Los meses de una ubicación **de los que alguien ya se ha ocupado**. Un mes sin
fila está abierto: la ausencia es el estado (ADR-010 §3).

```json
[
  {
    "id": "01a06e…", "locationId": "01a06e…",
    "anio": 2026, "mes": 3, "etiqueta": "2026-03",
    "inicioEn": "2026-03-01T05:00:00.000Z",
    "finEn": "2026-04-01T05:00:00.000Z",
    "estado": "CERRADO",
    "cerradoEn": "2026-04-03T14:22:10.412Z", "cerradoPor": "01a06e…",
    "reabiertoEn": null, "reabiertoPor": null
  }
]
```

`inicioEn` y `finEn` son **instantes resueltos**, no un mes: `2026-03-01T05:00Z`
es la medianoche del 1 de marzo en Guayaquil. El intervalo es semiabierto
`[inicioEn, finEn)`, así que un movimiento en `finEn` exacto es de abril.

### `POST /periodos/:periodId/reapertura` — `period.reopen`

```json
{ "motivo": "faltó una factura de febrero" }
```

`204` sin cuerpo. `motivo` es **obligatorio** (3–500 caracteres) y viaja al
evento `period.reopened` de `audit_log`.

| Código | Cuándo |
|---|---|
| `403` | Cualquier rol que no sea `OWNER` |
| `409` | El período está abierto: no hay nada que reabrir |
| `404` | Ese período no existe en la company |

### `POST /conteos` — `count.write`

```json
{ "locationId": "01a06e…", "anio": 2026, "mes": 3, "note": null }
```

`201 { "id": "…" }`. **El corte es el fin del mes, no el día en que se cuenta**:
«el conteo de marzo» significa el estado al cerrar marzo, se levante el 2 de
abril o el 5. La fecha real de captura queda en `creadoEn`.

Crea la fila del período si no existía. `409` si ese mes ya tiene un conteo
confirmado.

### `GET /conteos?locationId=…` — `count.write`

La lista, **sin ninguno de los tres valores**: `valorTeorico` y `valorFisico`
son datos prohibidos para `BODEGA`, que es quien más usa esta pantalla.

```json
[
  {
    "id": "01a06e…", "locationId": "01a06e…",
    "anio": 2026, "mes": 3, "etiqueta": "2026-03",
    "estado": "CONFIRMADO",
    "corteEn": "2026-04-01T05:00:00.000Z",
    "creadoEn": "2026-04-02T13:10:00.000Z",
    "confirmadoEn": "2026-04-02T18:44:02.113Z",
    "note": null
  }
]
```

### `GET /conteos/:countId/hoja` — `count.write`

**La hoja para contar, a ciegas.** Lista **todos** los ítems almacenables —los
`COMPRADO` y las preparaciones con `llevaStock`—, tengan saldo o no.

```json
{
  "conteo": { "…": "igual que en la lista" },
  "filas": [
    { "itemId": "01a06e…", "nombre": "Cebolla paiteña",
      "unidadDeUso": "kg", "cantidad": "8.500000000000" },
    { "itemId": "01a06e…", "nombre": "Aceite de girasol",
      "unidadDeUso": "lt", "cantidad": null }
  ]
}
```

`cantidad: null` es **«sin anotar todavía»**. Si la hoja trajera solo los ítems
con saldo, la sola presencia de una fila diría «de esto el libro cree que hay
algo» y su ausencia diría «cero»: el conteo dejaría de ser ciego por la puerta
de atrás.

### `PUT /conteos/:countId/lineas` — `count.write`

```json
{ "lineas": [ { "itemId": "01a06e…", "cantidad": "8.5" } ] }
```

`204`. **Reescribe la hoja entera**: es un `PUT` porque la pantalla es una
grilla y lo que el usuario ve al guardar es lo que queda. Un ítem que
desaparece de la lista deja de estar contado.

| Código | Cuándo |
|---|---|
| `400` | Cantidad negativa (*«si no había nada, la cantidad es cero»*), dos líneas del mismo ítem, o un ítem que no existe |
| `409` | El conteo ya está confirmado |

**Cero es un dato**: significa «miré y no había». `null` —no mandar la línea—
significa «nadie miró», y son cosas distintas (D7).

### `POST /conteos/:countId/confirmacion` — `count.write`

`204` **y nada más**. Congela el stock teórico y el costo de cada línea, y
materializa una línea por cada ítem con saldo, incluidas las de lo que nadie
contó. La conciliación que acaba de calcularse **no viaja de vuelta**: quien
confirma puede ser `BODEGA`.

`409` si ya está confirmado, o si ese período ya tiene otro conteo confirmado.

### `POST /conteos/:countId/cierre-de-periodo` — `count.write` + `period.close`

Cierra el mes de la ubicación del conteo. `204`.

| Código | Cuándo |
|---|---|
| `403` | Falta `period.close` — `BODEGA` cuenta pero no sella |
| `409` | El conteo sigue en borrador |
| `409` | El mes todavía no ha terminado |
| `409` | El mes ya está cerrado |

**A partir de aquí, toda escritura del libro con fecha dentro de ese mes
devuelve `409`**, incluida la corrección de un movimiento anterior —que conserva
la fecha del original (R3)—. Para modificarlo hay que reabrir.

### `GET /conteos/:countId` — `count.read`

**La conciliación. `BODEGA` recibe 403.**

```json
{
  "conteo": { "…": "igual que en la lista" },
  "filas": [
    { "itemId": "01a06e…", "nombre": "Cebolla paiteña", "unidadDeUso": "kg",
      "contado": "8.500000000000", "teorico": "10.000000000000",
      "diferencia": "-1.500000000000", "valorDeDiferencia": "-3.000000000000",
      "costoUnitario": "2.000000000000" },
    { "itemId": "01a06e…", "nombre": "Aceite de girasol", "unidadDeUso": "lt",
      "contado": null, "teorico": "4.000000000000",
      "diferencia": null, "valorDeDiferencia": null,
      "costoUnitario": "5.000000000000" }
  ],
  "valorTeorico": "40.000000000000",
  "valorCubierto": "20.000000000000",
  "valorFisico": "37.000000000000",
  "cobertura": "0.500000000000",
  "comprasDelPeriodo": "40.000000000000",
  "valorInicial": null,
  "consumoReal": null
}
```

| Campo | Qué es |
|---|---|
| `diferencia` | `contado − teorico`. **`null` si nadie contó** — no es cero: es «sin verificar» |
| `valorTeorico` | Lo que el libro dice que hay, todo el inventario |
| `valorCubierto` | La parte de `valorTeorico` que alguien fue a verificar |
| `valorFisico` | El inventario final de SPEC §16: **lo contado donde se contó, lo teórico donde no** |
| `cobertura` | `valorCubierto / valorTeorico`. `null` si no había nada que verificar — no es «0 %» |
| `costoUnitario` | El `costo_neto_uso` con que se valoró. **Un cero significa «este ítem no tiene precio confirmado»** |
| `valorInicial` | El `valorFisico` del conteo confirmado del mes anterior. `null` si no lo hubo |
| `consumoReal` | `inicial + compras − final físico` (SPEC §16). **`null` sin inventario inicial**: no se inventa |

**La cobertura viaja siempre pegada al consumo real**, y no es decoración: un
consumo calculado sobre el 12 % del valor no es un consumo real, es una
estimación. Sobre un conteo en **borrador** la conciliación se calcula al vuelo
—es la previsualización que un gerente quiere antes de sellar el mes—; sobre uno
confirmado se lee lo congelado, y da el mismo número dentro de un año.

## Analítica (P8)

**Las seis vistas del Excel, por ubicación y por mes.** Todas se calculan sobre un contexto único: la carta costeada a la fecha del corte, las ventas del mes, el consumo teórico, los agregados del libro y el conteo confirmado.

**Tres permisos separan tres audiencias**, y la línea es CLAUDE.md §4.3:

| Endpoint | Permiso | Quién lo tiene |
|---|---|---|
| `POST`/`GET /analitica/ventas` | `sales.write` / `sales.read` | `OWNER`, `ADMIN`, `GERENTE_LOCAL` (+ `LECTURA` en lectura) |
| `POST`/`GET /analitica/costos-fijos` | `cost.write` / `cost.read` | Ídem |
| `GET /analitica/resumen` · `menu-engineering` · `food-cost-real` · `punto-de-equilibrio` · `inventario` | `analytics.read` | Todos **menos `BODEGA`** |
| `GET /analitica/reposicion` | `replenishment.read` | **Todos, `BODEGA` incluido** |
| `GET /consolidado` · `/consolidado/productos` · `/consolidado/compras` | `analytics.consolidated.read` | `OWNER`, `ADMIN`, `LECTURA`. **`GERENTE_LOCAL` NO** |

### El consolidado de company — `analytics.consolidated.read`

**Tres rutas, y ninguna acepta `locationId`.** Esa ausencia es la barrera 3 de CLAUDE.md §4.1: el alcance sale de la sesión, nunca del parámetro. Un consolidado con `locationId` sería una vista por ubicación con otro nombre.

| Ruta | Qué devuelve |
|---|---|
| `GET /consolidado?anio&mes` | El total de la cadena: aporte por ubicación, totales y los cuatro porcentajes |
| `GET /consolidado/productos?anio&mes` | El mismo producto en cada ubicación, con mínimo, máximo y brecha |
| `GET /consolidado/compras?anio&mes` | Lo que cada ubicación pagó por cada ítem y en qué artículo |

**`GERENTE_LOCAL` recibe 403 en las tres.** Ver la cadena entera es la escalada horizontal de §4.4 — la misma línea que el criterio E18 traza en la propagación de recetas. Sigue viendo, sin cambios, las vistas de su ubicación.

**Los porcentajes del consolidado se recalculan sobre los totales, nunca se promedian** (ADR-012 §1). Y **una ubicación sin datos de ese mes no suma cero**: sale en `sinDatos` con su nombre.

```jsonc
{
  "anio": 2026, "mes": 3,
  "ubicaciones": [
    { "locationId": "…", "nombre": "Centro", "estadoDelPeriodo": "CERRADO",
      "ventaNeta": "869.565217391304", "consumoTeorico": "200" }
  ],
  "sinDatos": [{ "locationId": "…", "nombre": "Sur recién abierto" }],
  "cerradas": 1, "abiertas": 1,
  "totales": { "unidades": "140", "ventaNeta": "…", "comprasDelMes": "288" },
  "foodCostTeoricoPct": "0.207474226804",   // Σconsumo ÷ Σventa, NO el promedio
  "margenPct": "…", "cobertura": null
}
```

**`estadoDelPeriodo` no es decorativo.** El período es de una ubicación (ADR-010 §1), así que el total puede mezclar meses cerrados con meses todavía abiertos —cuyo número aún puede cambiar—, y quien lo lee tiene derecho a saberlo.

### `POST /analitica/ventas` — `sales.write`

```json
{ "locationId": "…", "anio": 2026, "mes": 3,
  "ventas": [ { "productId": "…", "unidades": "320" } ] }
```

**204.** **Reemplaza la carga entera del mes**: lo que se manda es lo que queda. Es lo que hace posible la grilla de CLAUDE.md §10 —«una grilla editable con el período anterior precargado, no un formulario por producto»—, y lo que D9 pide: el caso de uso recibe un lote «sin importar si viene de digitación, importación o un sistema externo».

`unidades` es un **entero**: el dominio lo modela como `Count`, y la base lo hace cumplir con `units = trunc(units)`.

| Código | Cuándo |
|---|---|
| `400` | El mismo producto dos veces en el lote |
| `409` | El período está cerrado (D6): si la cifra de ventas de un mes sellado cambiara, su food cost real cambiaría con ella |

### `GET /analitica/ventas` — `sales.read`

```json
[ { "productId": "…", "nombre": "Bolón de verde", "unidades": "320" } ]
```

**200 siempre, y `[]` si el mes no se ha abierto.** No devuelve `PERIODO_SIN_DATOS`: para una carga, un mes sin fila de período no tiene ventas, y la lista vacía es la verdad. Ese 404 es de las **seis vistas**, no de aquí.

`nombre` desde P16-A2, con el mismo contrato que en menu engineering: vacío si el producto ya no está en la carta.

### `POST /analitica/costos-fijos` — `cost.write`

```json
{ "locationId": "…", "anio": 2026, "mes": 3,
  "costos": [
    { "concepto": "Nomina", "clasificacion": "MANO_DE_OBRA", "importe": "3000.00" },
    { "concepto": "Arriendo", "clasificacion": "OTRO_FIJO", "importe": "1200.00" },
    { "concepto": "Comision tarjeta", "clasificacion": "VARIABLE", "importe": "0.03" } ] }
```

**204.** T6 del Excel, con el campo que SPEC §17 pide por su nombre.

**`clasificacion` es un enum, no texto libre.** El Excel identifica la mano de obra por el prefijo `"Sueldos*"` y su propia nota dice que «es frágil»: un concepto llamado «Nómina» quedaría fuera del prime cost sin que nada avisara, y el prime cost decide si un local es viable.

**`importe` significa dos cosas según la clasificación:** `VARIABLE` lo trae como **fracción de la venta neta** (`0.03` es 3 %); las otras dos, como **monto mensual**. Lo declara el catálogo, no el nombre del concepto.

**`400` si un concepto se repite**, comparando sin espacios de sobra y sin distinguir mayúsculas: «Arriendo» y «arriendo » son el mismo gasto, y contarlo dos veces daría una utilidad operativa plausible y equivocada.

### Las seis vistas y el mes sin abrir

`GET /analitica/resumen`, `/menu-engineering`, `/food-cost-real`, `/punto-de-equilibrio`, `/inventario` y `/reposicion` devuelven **`404 PERIODO_SIN_DATOS`** cuando en esa ubicación y ese mes no hay nada registrado —ni ventas, ni movimientos, ni conteo—. No es un error de la petición: es un mes que nadie ha trabajado todavía, y devolver ceros haría creer que se analizó. Distíngase de `RECURSO_NO_ENCONTRADO` **por el `code`**, no por el estado (D-16.2).

El consolidado es la excepción: no propaga el 404, lo convierte en su lista `sinDatos` (ADR-012).

### `GET /analitica/food-cost-real` — `analytics.read`

SPEC §16 entero, **con `diferenciaConciliacion` a la vista**:

```json
{ "consumoReal": "4300", "consumoTeorico": "4000",
  "varianzaUsd": "300", "varianzaPct": "0.075",
  "foodCostTeoricoPct": "0.266666666666", "foodCostRealPct": "0.286666666666",
  "brechaEnPuntos": "2", "costoVentasTeorico": "4380",
  "costoVentasSegunCosteo": "4380", "diferenciaConciliacion": "0.00" }
```

**`diferenciaConciliacion` tiene que ser `"0.00"`. Siempre.** Es R7, y se devuelve para que se pueda mirar sin abrir una consola. `brechaEnPuntos` va en **puntos porcentuales**, no en fracción: 2 significa dos puntos.

Los porcentajes son `null` —no cero— cuando la venta neta del mes es cero: un food cost sobre venta cero no es «0 %», es una pregunta sin respuesta.

### `GET /analitica/menu-engineering` — `analytics.read`

```json
{ "productos": [ { "productId": "…", "nombre": "Bolón de verde", "unidades": "210",
    "popularidad": "0.233333333333", "indicePopularidad": "1",
    "margenContribucion": "6.65", "cuadrante": "ESTRELLA" } ],
  "mcPromedio": "2", "unidadesTotales": "900", "productosActivos": 3 }
```

**`nombre` desde P16-A2.** Antes había que pedir `GET /costeo` en paralelo —la carta entera costeada— solo para traducir ids a texto. Sale vacío si el producto ya no está en la carta de la company: la venta ocurrió igual y la fila no se esconde.

`cuadrante` es `ESTRELLA`, `CABALLO`, `ROMPECABEZAS`, `PERRO`, `SIN_DATOS` (activo sin unidades, o sin PVP) o `INACTIVO`. **`índice ≥ 1` es popular**, y el empate exacto es determinista: el índice se calcula con una sola división para que un producto que debe dar `1` dé `1` y no `0.999999999999`.

El `mcPromedio` es **ponderado por unidades**, no la media simple.

### `GET /analitica/punto-de-equilibrio` — `analytics.read`

SPEC §17. `unidadesEquilibrioMes`, `ventaNetaEquilibrio` y `margenDeSeguridad` son **`null` cuando el margen de contribución neto por unidad no es positivo**: cada unidad vendida pierde dinero y no hay cantidad que alcance el equilibrio. Un número negativo ahí se leería como una meta alcanzable.

`manoDeObra` suma a `costosFijos` **y** a `primeCost`, y es correcto: son dos preguntas distintas sobre el mismo dinero.

### `GET /analitica/inventario` — `analytics.read`

SPEC §18, por ítem: `stockInicial`, `compras`, `mermasYAjustes`, `consumoTeorico`, `stockTeorico`, `valorTeorico`, `conteoFisico`, `diferencia`, `valorDeDiferencia`, `diasCobertura`, `puntoDeReorden` y `estado`.

`estado` es `SIN_CONSUMO`, `FALTAN_COMPRAS`, `REPONER` u `OK`, en ese orden de evaluación — que no es intercambiable: un ítem que no se consume está siempre por debajo de su reorden, y clasificarlo como `OK` por esa vía escondería que nadie sabe si sobra o falta.

**`mermasYAjustes` lleva el signo del libro**, no el del Excel: una merma llega en negativo y se **suma**. SPEC §18 la resta porque allí se capturan en positivo.

### `GET /analitica/resumen` — `analytics.read`

Los indicadores clave con su semáforo: `VERDE`, `AMBAR`, `ROJO` o **`SIN_DATO`**. El cuarto no es un nivel de gravedad: es la ausencia de medición, y va aparte para que ninguna interfaz lo pinte de verde. La varianza se juzga en **valor absoluto**: consumir un 8 % menos de lo teórico es tan sospechoso como un 8 % más.

### `GET /analitica/reposicion` — `replenishment.read`

**Lo único de P8 que `BODEGA` recibe** — SPEC §4:

```json
[ { "itemId": "…", "nombre": "Cebolla paiteña", "semaforo": "REPONER" } ]
```

Tres campos, y **ninguno es una cantidad**. `FALTAN_COMPRAS` y `REPONER` colapsan en `REPONER`; `SIN_CONSUMO` y `OK`, en `OK`: distinguirlos ya sería un dato sobre el stock teórico.

Se construye desde otro caso de uso y con otro tipo, **no filtrando la vista de inventario**. Un campo que se calcula y luego se quita ya viajó por el cable alguna vez.

## Salud

`GET /health` (liveness, no toca la base) y `GET /ready` (readiness, sí la toca). Públicas y fuera del limitador: las sondea el orquestador cada pocos segundos.
