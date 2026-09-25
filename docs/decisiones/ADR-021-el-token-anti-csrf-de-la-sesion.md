# ADR-021: El token anti-CSRF de la sesión — synchronizer en claro, en el cuerpo, y en los dos procesos

> Architecture Decision Record. Vive en `docs/decisiones/ADR-021-el-token-anti-csrf-de-la-sesion.md`. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-09-10 |
| Paquete | P16-A2 |
| Decisores | Usuario (U4) / Claude Code |

**Supersede en parte a [ADR-006](ADR-006-las-tres-barreras-del-aislamiento.md)**, que en su tabla de decisiones de sesión escribió «`SameSite=Strict` es la defensa CSRF: no hay petición cruzada que lleve credencial» y, en su tabla de alternativas, «`Authorization: Bearer` … reabre el CSRF que `SameSite=Strict` cierra». ADR-006 **no se edita** —la regla de `docs/decisiones/README.md` es que un ADR aceptado es inmutable—: las dos frases quedan como estaban y este documento es el que dice por qué ya no bastan. Lo que **sigue vigente** de ADR-006 es todo lo demás: el token opaco de 32 bytes, el hash en la base, la vida de la sesión, la rotación por login y el rechazo de `Authorization: Bearer` (que se mantiene, aunque ahora por una razón más modesta: no hay cliente que lo pida).

---

## Contexto

El usuario decidió **U4: token CSRF completo**, que es lo que `docs/SEGURIDAD.md` §4.2 pedía desde el principio —«`SameSite=Strict` en cookies **+ token CSRF** en toda mutación del panel (double-submit o synchronizer)»— y que P1 aplazó apoyándose en el atributo de la cookie.

### Por qué `SameSite=Strict` no basta, dicho sin adornos

La frase de ADR-006 era cierta **suponiendo que el navegador cumpla**, y esa suposición es exactamente la que un servidor no puede comprobar:

1. **`SameSite` lo aplica el cliente, no la API.** Un navegador que no entienda el atributo lo ignora entero y manda la cookie. La API no se entera: la petición le llega idéntica a una legítima. El token, en cambio, lo comprueba el servidor, que es la única parte de esa conversación que este proyecto controla.

2. **`SameSite` mira el *sitio*, no el *origen*.** `promo.midominio.com` es el **mismo sitio** que `app.midominio.com`: una página de marketing en un subdominio, un `wildcard` de DNS mal cerrado o un bucket con dominio propio mandan la cookie con toda normalidad. Es el escenario realista para un SaaS con dominio propio, que es a donde va este producto (ADR-016).

3. **Y no se argumenta por redundancia.** «Dos defensas por si una falla» es una excusa cómoda. Lo que sostiene esta es que **las dos fallan por motivos distintos y ninguna cubre el hueco de la otra**: una cookie `Strict` no protege del subdominio, y un token no protege de un XSS en la propia página. Juntas dejan menos hueco que cualquiera de las dos por separado.

### Lo que había que decidir

Cinco cosas, y ninguna es obvia: qué patrón, dónde se guarda el token, por dónde viaja, qué pasa con las sesiones ya abiertas, y si el back office —otro proceso, otra sesión— lo lleva también.

---

## Opciones consideradas

### 1. El patrón

| Opción | A favor | En contra |
|---|---|---|
| **Synchronizer token** (el servidor guarda el token en la fila de la sesión y lo compara con la cabecera) | El servidor tiene la verdad; nada depende de que el cliente haga bien su parte; revocar la sesión revoca el token | Una columna más y una lectura más… que no cuesta nada, porque `session_lookup` ya corre en cada petición y la columna está en la MISMA fila |
| Double-submit cookie (una segunda cookie legible que el JS copia a la cabecera) | Sin estado en el servidor | El token viaja en una cookie, que es **el canal del que se defiende**: el navegador la manda sola en la petición cruzada. Y la protección depende de que el atacante no pueda escribir cookies del sitio — lo que un subdominio comprometido sí puede hacer, que es justo el hueco 2 de arriba |

### 2. Dónde se guarda

| Opción | A favor | En contra |
|---|---|---|
| **En claro en `session.csrf_token`** | Permite devolverlo en `GET /auth/sesion` tras recargar la página, sin rotarlo y sin romper las demás pestañas | Un volcado de `session` revela tokens CSRF vivos |
| Hasheado, como el token de sesión | Simetría con la credencial | Haría imposible devolverlo: solo se conocería en el instante del login, y una recarga obligaría a **rotarlo** —cerrando las otras pestañas— o a guardarlo en `localStorage`, que es peor |

**El argumento que decide es que no es una credencial.** Quien tenga la columna no puede entrar: la credencial es la cookie, de la que la base guarda solo el SHA-256. Y quien ya tenga la cookie de la víctima **no necesita el token**: está actuando *como* ella, no *contra* ella — el CSRF protege del sitio cruzado que no puede leer la respuesta, no del robo de sesión. Un volcado de `session` habilita, por tanto, exactamente nada.

### 3. Por dónde viaja

En el **cuerpo** de `POST /auth/login` y de `GET /auth/sesion`, y vuelve en la cabecera **`X-CSRF-Token`**. No en una cookie (ver arriba). Que el JavaScript de la página pueda leerlo **no contradice** el `HttpOnly` de la sesión: son dos cosas distintas, y el token *tiene* que ser legible por la página porque su trabajo es que la página lo ponga en una cabecera que un sitio cruzado no puede poner.

### 4. Las sesiones abiertas antes de la migración

| Opción | A favor | En contra |
|---|---|---|
| Rellenarlas con un token generado en SQL | Nadie pierde la sesión | Deja sesiones vivas cuyo token **nadie ha entregado al cliente**: navegarían con normalidad y fallarían al guardar, con un 403 que el usuario no puede arreglar |
| **Tratar la sesión sin token como inválida (401)** | El usuario vuelve a entrar de inmediato y recibe una sesión completa; el tipo queda `string` y no `string \| null` en todo el código de encima | El despliegue de este paquete cierra las sesiones abiertas |

Se eligió la segunda. La columna nace **nullable y sin relleno**; `ValidarSesion` lanza `SesionInvalidaError('sin_csrf')` → 401. Media sesión no es una sesión.

### 5. El back office

| Opción | A favor | En contra |
|---|---|---|
| **Que lo lleve también** | SEGURIDAD.md §4.2 dice «toda mutación del panel», y éste es el panel con más poder del sistema: cinco escrituras que cambian el plan o el estado de cualquier company | Un poco más de código: una columna en `backoffice_session`, un guard propio y tres líneas en su guion de navegador |
| Dejarlo fuera, con su señal | Sus mutaciones ya están protegidas de hecho | Lo están por **propiedades accidentales del despliegue de hoy** |

Se eligió que **lo lleve**. Es cierto que hoy sus mutaciones son `fetch` con `Content-Type: application/json` desde su propia página —que un sitio cruzado no puede emitir sin un preflight que `cors: false` rechaza— y que escucha en loopback tras un túnel SSH (ADR-018). Pero las tres cosas que lo protegen son accidentes: **el día que alguien sirva un `<form method="post">` desde estas mismas rutas —un formulario HTML no necesita preflight— la defensa desaparece sin que ningún check avise**. El token no depende de ninguna de las tres. El coste medido fue de un guard de 40 líneas y una columna, y no había razón para pagar la deuda en vez del código.

---

## Decisión

**Toda mutación (`POST`, `PUT`, `PATCH`, `DELETE`) de los dos procesos exige la cabecera `X-CSRF-Token`, que se compara en tiempo constante con el token guardado en claro en la fila de la sesión; el fallo es 403 `CSRF_INVALIDO`.** El token lo genera el mismo CSPRNG que el de sesión (32 bytes, `base64url`), **nace con la sesión y muere con ella**, viaja en el cuerpo del login y de `GET /auth/sesion`, y jamás en una cookie.

**Qué significa exactamente «nace con la sesión»** —y qué no—: cada sesión recibe **su** token, generado por el servidor, que no vale en ninguna otra sesión ni siquiera del mismo usuario. **No hay rotación dentro de la sesión, y volver a entrar no invalida el token anterior:** `IniciarSesion` no revoca las sesiones abiertas (a propósito, porque el móvil y el ordenador a la vez son dos sesiones vivas), así que un segundo login añade una sesión con un token nuevo y deja la primera intacta con el suyo. Lo que la generación por sesión sí garantiza es lo que importa contra la fijación: **el token nunca lo elige el cliente**, y un token plantado por un tercero no coincide con ninguna fila.

### Las piezas, y dónde están

| Pieza | Dónde |
|---|---|
| Columna `session.csrf_token` y `backoffice_session.csrf_token`, nullable, con `CHECK` de longitud | `prisma/migrations/20260910202336_p16a2_csrf/` |
| `session_lookup` devuelve el token: **cero consultas extra** | la misma migración (`DROP` + `CREATE`: cambia el tipo de retorno) |
| Generación en el login | `iam/application/casos-de-uso/iniciar-sesion.ts` · `backoffice/application/casos-de-uso/sesion.ts` |
| Rechazo de la sesión sin token (401) | `iam/application/casos-de-uso/validar-sesion.ts` · `ValidarSesionDeOperador` |
| Comparación en tiempo constante y qué cuenta como mutación | `shared/infrastructure/http/csrf.ts` (una sola vez, para los dos procesos) |
| El error tipado | `shared/domain/errors/csrf-invalido.ts` → `CSRF_INVALIDO` → 403 en `error.filter.ts` |
| Los guards | `iam/…/csrf.guard.ts` (global, entre sesión y permisos) · `backoffice/…/csrf-de-operador.guard.ts` |
| `GET /auth/sesion` → `{ userId, permisos, alcance, csrf }` | `iam/…/auth.controller.ts` |
| El cliente | `apps/web/src/lib/csrf.ts` + `lib/api.ts` · `apps/api/src/navegador/backoffice.ts` |

### Por qué se comparan los **hashes** y no los tokens

`timingSafeEqual` exige buffers de la misma longitud: con longitudes distintas **lanza**. Comparar los tokens crudos obligaría a mirar la longitud primero, y esa comprobación —instantánea— es en sí misma un oráculo que revela el tamaño del token bueno. Hasheando los dos lados con SHA-256 la longitud es siempre 32 bytes, deja de decir nada, y la comparación entera corre en tiempo constante. El hash aquí **no guarda nada**: es un igualador de longitud. Es el único sitio del sistema donde se compara un secreto en JavaScript —el token de sesión se compara por índice dentro de SQL—, y por eso la función vive aparte, con su nombre y su prueba.

### Lo que queda fuera del guard, y por qué no es un agujero

| Fuera | Por qué |
|---|---|
| `GET`, `HEAD`, `OPTIONS` | Un CSRF sirve para provocar un **efecto**; el sitio cruzado no puede leer la respuesta. Exigir token en una lectura no cierra nada y rompe toda la navegación |
| Las rutas `@Publico()` de activación, olvido y restablecimiento | **No hay sesión que proteger.** Sin cookie, el navegador no adjunta ninguna credencial: lo único que el sitio cruzado lograría es una petición que cualquiera puede hacer con `curl`. Lo que las protege del abuso es el límite de tasa (ADR-026), que es su problema real. Y exigirles token sería imposible: el token nace **con** la sesión |
| `POST /auth/login` — también público, pero **por otra razón** *(corregido tras la revisión de P16-A2)* | Aquí el párrafo de arriba **no vale, y decir que valía era falso**: una petición cruzada al login no *usa* una credencial, la **crea**. `SameSite` gobierna el envío de la cookie, no su almacenamiento, así que el `Set-Cookie` de esa respuesta se guarda igual y la víctima se queda con **la sesión del atacante** abierta; todo lo que escriba después —conteos, ventas, recetas— acaba dentro de la company de él. Es *login CSRF* / fijación de sesión. **Lo que lo cierra es que la API analiza solo `application/json`** (`bootstrap.ts`, `bodyParser: false` + `useBodyParser('json')`): un `<form>` cruzado no puede emitir ese tipo de contenido y un `fetch` cruzado necesita un preflight que decide la lista blanca de CORS. Exigirle token seguiría siendo imposible —nace con la sesión— |
| `POST /auth/logout` | **No** queda fuera: exige token como cualquier mutación. Cerrarle la sesión a alguien desde fuera es un ataque pequeño, pero es un ataque |

---

## Alternativas descartadas

### 1. Double-submit cookie

Ya explicada arriba. Se descarta porque mete el token en el canal del que defiende y porque su seguridad depende de que nadie pueda escribir cookies del sitio — que es precisamente lo que un subdominio comprometido sí puede.

### 2. Verificación de `Origin` / `Referer` como capa extra

SEGURIDAD.md §4.2 la nombra como **«capa extra»**, y **no se implementa en P16-A2**. Las razones, por orden de peso:

- **Duplicaría la lista blanca de CORS y derivaría de ella.** Los orígenes válidos de la app cliente ya viven en `CORS_ORIGENES`, validados uno a uno en el esquema de entorno. Una segunda comprobación con su propia lista es una segunda lista que mantener; con la misma lista, es una comprobación que no añade nada que el preflight no haga ya.
- **En desarrollo y en las pruebas esa lista está vacía**, porque `cors` queda en `false` cuando no hay orígenes. La comprobación tendría que llevar un «si la lista está vacía, pasa», que es exactamente la forma de condicional que **falla abierto** y que este proyecto rechaza en todas partes.
- **El back office no tiene lista de orígenes que consultar**: `cors: false` y un puerto de loopback que cambia. La comprobación sería un adivina-el-origen, o no existiría ahí — y entonces la «capa extra» solo cubriría la mitad menos expuesta.
- **Y `supertest` no manda `Origin`.** Exigir la cabecera rompería las treinta suites de integración; aceptar su ausencia deja el hueco abierto para cualquier cliente que simplemente no la mande. Ninguna de las dos lecturas es defendible.

**Señal para reabrirlo:** el día que la API sirva a un cliente que no sea el propio `apps/web` —una app móvil, una integración— o que el back office se publique fuera de loopback, la comprobación de `Origin` vuelve a la mesa **con su lista propia y explícita**, no derivada de CORS.

### 3. Rotar el token en cada mutación

Es lo más estricto y lo más frágil: dos pestañas abiertas se pisan el token, y la segunda falla con un 403 que el usuario lee como «la aplicación está rota». No hace falta para lo que la rotación previene: la **fijación** ya está cortada porque el token lo genera siempre el servidor, uno por sesión, y ninguno que elija un tercero coincide con una fila.

**Pero el síntoma que este párrafo usa como argumento no desaparece solo porque no rotemos** *(corregido tras la revisión de P16-A2)*. Se da sin ningún atacante: pestaña A abierta, el usuario vuelve a entrar en la pestaña B, la cookie `sesion` del sitio se sobrescribe —mismo nombre, mismo `Path`— y la pestaña A pasa a navegar con la sesión de B conservando en memoria el token de A. Toda mutación de A responde 403 hasta que alguien recargue. Por eso `apps/web/src/lib/api.ts` **reintenta una sola vez**: ante un 403 `CSRF_INVALIDO` en una mutación tira el token de memoria, lo vuelve a pedir con `GET /auth/sesion` —que la cookie autentica, sea de la sesión que sea— y repite la petición; si el segundo intento vuelve a fallar, el error sube con el mensaje del backend. Y está escrito de forma que no pueda ser dos: el reintento llama a la función interna, no a `llamar`, así que no hay camino por el que se repita. Un bucle de reintentos contra un 403 es una denegación de servicio contra el propio servidor.

### 4. Derivar el CSRF del token de sesión (`hash(sesion)`)

Ahorra una columna y **rompe el mecanismo**: quien robe la cookie recalcula el token. Los dos tokens se generan por separado, y la prueba unitaria de `iniciar-sesion` usa un doble que devuelve **valores distintos en cada llamada** justamente para que ese error no pueda colarse sin que nadie lo vea.

---

## Consecuencias

**Lo que se gana**

- La defensa contra CSRF deja de depender de que el navegador cumpla, y cubre el caso del subdominio del mismo sitio, que `SameSite` no cubre.
- `GET /auth/sesion` existe: el frontend deja de adivinar sus permisos y su alcance, que es lo que el armazón de P16 necesitaba (pantalla 1).
- El back office queda protegido **por contrato** y no por accidente de despliegue.
- `CSRF_INVALIDO` es distinguible de `PERMISO_DENEGADO` aunque los dos sean 403: la reacción del cliente es opuesta —uno se arregla recargando, el otro pidiendo permisos— y un 403 indistinguible manda al usuario al sitio equivocado.

**Lo que se sacrifica o queda condicionado**

- **El despliegue de este paquete cierra todas las sesiones abiertas.** Es la consecuencia de no rellenar la columna, y se acepta: el sistema todavía no tiene piloto.
- Un volcado de `session` revela tokens CSRF vivos. No habilita nada por sí solo (ver «dónde se guarda»), pero es información que antes no estaba ahí. **Ese razonamiento vale para un volcado de la tabla y no se extiende a los logs**, que van al agregador, a un ticket y a un tercero: `X-CSRF-Token` se borra en `redact` como la cookie y el `authorization`, y `logger.options.spec.ts` clava la lista entera *(corregido tras la revisión de P16-A2: la cabecera se introdujo sin tocar `redact` y el token salió en claro en el log de cada mutación)*.
- **La API dejó de aceptar cuerpos `application/x-www-form-urlencoded`.** Es el precio de cerrar el login CSRF (ver la tabla de arriba) y no cuesta nada hoy —ningún endpoint recibe formularios—, pero es una restricción global que hay que recordar: el día que alguien necesite un `<form>` nativo contra esta API, la respuesta correcta **no** es volver a encender el analizador, sino darle a esa ruta su propio token en un campo oculto.
- Todo cliente HTTP nuevo tiene que aprender el token. Hoy son dos —`apps/web` y el guion del back office— y los dos lo hacen.
- Las pruebas de integración necesitan emparejar cookie y token: lo resuelve `apps/api/test/soporte/csrf.ts`, el **único** helper de integración del proyecto, y su cabecera explica por qué existe y qué sigue copiándose por archivo.

**Qué habría que hacer si esto cambia**

- Si algún día se admite `Authorization: Bearer` (un cliente que no sea navegador), ese camino **no lleva cookie** y por tanto no necesita token — pero entonces hay que decidirlo explícitamente en el guard, no dejarlo caer por omisión.
- Si el back office pasa a servir formularios HTML nativos, el token ya está: lo único que cambia es que el `<form>` tiene que llevarlo, y un `<form>` no puede poner cabeceras. Ese es el momento de añadir un campo oculto, y de volver a escribir un ADR.
