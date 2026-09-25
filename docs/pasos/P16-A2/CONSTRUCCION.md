# P16-A2 — Documento de construcción

**Paquete:** P16-A2 — API · `shared` + sesión + CSRF + lecturas de catálogo + arreglos · **Inicio:** 2026-09-10 · **Estado:** 🟡 **construido, pendiente de auditoría final y commit** (cierre documental: 2026-09-10)

> Segundo paquete de código de la pasada P16 → P20 (`docs/pasos/P16/PLAN.md`, sección P16-A2). Las
> decisiones cerradas por el usuario están en `ESTADO.md` → «Pasada P16 → P20» (U1–U8, D-16.1…D-16.64)
> y son vinculantes. El paquete se construye en **varias etapas encadenadas**, cada una con su
> sección aquí; **este documento se añade, nunca se borra**.
>
> **Etapas y su estado**
>
> | Etapa | Qué | Estado |
> |---|---|---|
> | 1 | La sesión y el token CSRF completo (U4, SEGURIDAD.md §4.2, ADR-021) | ✅ construida |
> | 2 | `error.filter.ts` (tres errores → 400) · `PERIODO_SIN_DATOS` → 404 · CORS + `DELETE` · `CONSULTA_*` `.strict()` · `nombre` en ventas y menu-engineering | ✅ construida |
> | 3 | Lecturas de catálogo (`/catalogo/unidades`, `/items/:id`, `/articulos/:id`), `CrearItem` valida unidad, P2002 → 409 | ✅ construida · ✅ revisada y corregida |

---

## Resumen

*(una línea por etapa, al cerrarla)*

- **Etapa 1 — CSRF.** Toda mutación de los dos procesos —app cliente y back office— exige la cabecera
  `X-CSRF-Token`, comparada en tiempo constante con un token de 256 bits guardado en claro en la fila
  de la sesión; el fallo es **403 `CSRF_INVALIDO`**. Aparece `GET /auth/sesion` →
  `{ userId, permisos, alcance, csrf }`, que es lo que permite recuperar el token tras recargar la
  página y lo que el armazón del frontend (pantalla 1) necesitaba para saber qué puede el usuario.
  Los tres comentarios del árbol que afirmaban que `SameSite=Strict` hacía innecesario el token están
  reescritos. **ADR-021** lo registra y **supersede en parte a ADR-006**.
- **Etapa 2 — la frontera HTTP.** Los tres errores de borde que salían como `500 INTERNAL_ERROR`
  —identificador, unidad de uso y decimal— son ahora `400 ENTRADA_INVALIDA` con un mensaje que dice
  qué corregir (INC-012 llevado a los tipos); «mes sin abrir» tiene código propio,
  **`PERIODO_SIN_DATOS`**, sin cambiar de estado (D-16.2); los **ocho** esquemas de consulta pasan a
  `.strict()`, así que un parámetro de más se rechaza en vez de descartarse en silencio con un 200;
  CORS gana `DELETE`, declara sus cabeceras en vez de reflejarlas y expone `x-correlation-id` y
  `Retry-After`; y los DTO de ventas y menu engineering publican el **nombre** del producto, lo que
  deja sin trabajo al rodeo del frontend que costeaba la carta entera para traducir ids a texto.
- **Etapa 3 — las lecturas de catálogo.** Aparecen `GET /catalogo/unidades` —para que una pantalla
  ofrezca los diez códigos en vez de un campo libre— y las dos fichas, `GET /catalogo/items/:id` (con
  su grupo y sus artículos dentro) y `GET /catalogo/articulos/:id` (con su ítem): un recurso de otra
  company da **404 con el mismo texto** que uno inventado, y la pertenencia va en el WHERE de cada
  lectura. El alta suelta de ítem comprueba por fin que la unidad **exista** y no solo que esté bien
  escrita (INC-012), con el mismo mensaje que el lote. Y las tres escrituras del catálogo que
  reventaban con un `P2002` sin traducir —renombrar un ítem, reimportar artículos, la carrera de los
  dos lotes— salen ahora como **409** con el nombre que sobra dentro.

## Objetivo del paquete

Criterio de aceptación: las 🔴 de la sección P16-A2 del plan en verde, `npm run audit` en verde,
migraciones reversibles verificadas con `migrate:verify`, y la documentación al día.

---

# Etapa 1 — La sesión y el token CSRF completo

## Plan de la etapa

Lo que el plan pide en una línea (`PLAN.md:149`): **CSRF** (`session.csrf_token`, `X-CSRF-Token`,
403 `CSRF_INVALIDO`, helper de pruebas, ADR-021) · `GET /auth/sesion` → `{ userId, permisos, alcance, csrf }`.

### Hallazgos de la lectura que cambiaron el diseño

| Hallazgo | Consecuencia |
|---|---|
| `session_lookup` devuelve 13 columnas y **`CREATE OR REPLACE` no sirve** al cambiar el tipo de retorno | La migración hace `DROP` + `CREATE` y repite `REVOKE … FROM PUBLIC` + `GRANT … TO costeo_app`: una función nueva nace sin los privilegios de la anterior |
| El token viaja en la MISMA fila que ya se lee en cada petición | Cero consultas nuevas. Añadir el token no cuesta nada en el camino crítico |
| **No hay un solo `timingSafeEqual` en el repositorio** | Es el primer sitio donde este sistema compara un secreto en JavaScript (el de sesión se compara por índice dentro de SQL). La función vive aparte, con su nombre y su prueba |
| Ya hay **dos** copias de un `sha256 → hex` (iam y backoffice) | Una tercera para el CSRF habría sido un clon de `jscpd`. Se reutiliza `GeneradorDeTokens` en la app cliente y `randomBytes` ya presente en el back office; lo que se comparte es la **comparación**, no el hash |
| Las 30 suites de integración hacen **205 mutaciones** con cookie | Sin un mecanismo de emparejamiento cookie↔token, tocarlas una a una era inviable y frágil. De ahí el único helper de integración del proyecto (abajo) |
| El bloque `roles` de `autenticacion-y-autorizacion.spec.ts` le asigna `LECTURA` (rol de company) al gerente | La prueba del alcance `{clase:'ubicaciones'}` de `GET /auth/sesion` tiene que vivir **antes** de ese bloque. El orden de los `describe` es parte del dato |

---

## Qué se construyó

### La migración `20260910202336_p16a2_csrf`

`session.csrf_token TEXT` y `backoffice_session.csrf_token TEXT`, **nullable**, con un `CHECK` de
longitud (`NULL` o 32–128) en cada una, y `session_lookup` rehecha para devolver la columna. Ninguna
tabla nueva (M6 no aplica) y **ningún `GRANT`**: `costeo_app` ya tiene `INSERT`/`UPDATE` sobre
`session` desde P1 (líneas 570 y 574 de su migración) y una columna nueva la cubren los privilegios
de tabla.

`down.sql` en espejo: devuelve `session_lookup` a la firma de P15 —con su `DROP` + `CREATE` y su
`REVOKE`/`GRANT`—, suelta las dos restricciones explícitamente y deja que el DDL de Prisma quite las
columnas. `migrate:verify` **4/4 en verde**.

**Los dos `CHECK` son ⚪ estructurales** y tienen su sección en `docs/sistema/guardas-de-dominio.md`
(M11): el token lo genera siempre el servidor y ningún endpoint acepta un `csrf_token` de entrada,
así que no hay petición que pueda violarlos. Están para que un `UPDATE` a mano no meta una cadena
vacía, que el comparador leería como «sin token» en un sitio y como «token» en otro.

### Las dos decisiones que la migración escribe

**El token se guarda EN CLARO.** No es una credencial de acceso: quien tenga la columna no puede
entrar, porque la credencial es la cookie de sesión, de la que la base guarda solo el SHA-256. Y
quien ya tenga la cookie de la víctima **no necesita** el token: está actuando *como* ella y no
*contra* ella — el CSRF protege del sitio cruzado que no puede leer la respuesta, no del robo de
sesión. Guardarlo hasheado, además, haría imposible devolverlo en `GET /auth/sesion`, que es lo que
permite recuperarlo tras una recarga sin rotarlo (rotar rompe las demás pestañas) y sin meterlo en
`localStorage`. Lo que se pierde: un volcado de `session` revela tokens CSRF vivos, que por lo
anterior no habilitan nada.

**Las sesiones ya abiertas no se rellenan: se invalidan.** La columna nace nula para ellas y
`ValidarSesion` lanza `SesionInvalidaError('sin_csrf')` → **401**, de modo que el usuario vuelve a
entrar y recibe una sesión completa. La alternativa —rellenarlas con un valor generado en SQL— deja
sesiones vivas cuyo token nadie ha entregado al cliente: navegarían con normalidad y fallarían al
guardar, con un 403 que el usuario no puede arreglar. El coste aceptado es que **el despliegue de
este paquete cierra las sesiones abiertas**; el beneficio es que `csrfToken` es `string` y no
`string | null` en todo el código de encima.

### La generación

`IniciarSesion` pide **dos** tokens al mismo `GeneradorDeTokens` (32 bytes, `base64url`) y los guarda
juntos. No se deriva uno del otro —un CSRF que fuera `hash(sesión)` se recalcularía desde la cookie
robada— y el token nace **con la sesión** y muere con ella: no rota en medio, y **volver a entrar no
invalida el anterior**, porque abrir sesión no revoca ninguna (D-16.73; la primera redacción de este
párrafo decía lo contrario y era falsa). Lo que la generación por sesión sí garantiza es lo que
importa contra la fijación: el token **nunca lo elige el cliente** y ninguno vale en otra sesión.
El doble de la prueba unitaria devuelve **valores distintos en cada llamada**,
justamente para que el error de derivar uno del otro no pueda colarse sin que nadie lo vea.

Sale en el **cuerpo** de `POST /auth/login`, junto a `expiraEn`. Que sea legible por el JavaScript de
la página no contradice el `HttpOnly` de la sesión: son dos cosas distintas, y el token *tiene* que
ser legible, porque su trabajo es que la página lo ponga en una cabecera que un sitio cruzado no
puede poner. En una cookie sería lo contrario de protegerlo — el navegador la mandaría sola,
justo en la petición cruzada de la que defiende.

### `GET /auth/sesion`

```json
{ "userId": "018f…", "permisos": ["catalog.read"], "alcance": { "clase": "ubicaciones", "ids": ["018f…"] }, "csrf": "8Kb…" }
```

Sin `@Requiere(...)`: el mínimo de la API es estar autenticado, y esto no devuelve nada que el
usuario no sea ya. **No lleva `companyId`**, y no es un olvido: el tenant no es un dato que el cliente
pueda usar (Barrera 3) y publicarlo solo invitaría a intentarlo. `alcance` conserva la **unión
discriminada** del puerto y no se aplana a una lista, porque un `ids: []` que significara «todas» es
la convención que alguien lee al revés una vez y convierte en fuga.

**Cero consultas nuevas**: todo lo que devuelve ya está en el objeto que `SesionGuard` dejó en el
`WeakMap` de la petición.

### La comprobación

`CsrfGuard`, global, **entre** `SesionGuard` y `PermisosGuard`. Ese orden no es estético: sin sesión
no hay token con el que comparar, y comprobar permisos de una petición que ni siquiera es del usuario
sería autorizar un ataque antes de rechazarlo.

Lo que queda fuera y por qué no es un agujero:

- **`GET`, `HEAD`, `OPTIONS`.** Un CSRF sirve para provocar un efecto; el sitio cruzado no puede leer
  la respuesta. Exigir token en una lectura no cierra nada y rompe toda la navegación.
- **Las rutas `@Publico()`** — login, activación, olvido y restablecimiento. **No hay sesión que
  proteger**: sin cookie el navegador no adjunta ninguna credencial, así que lo único que el sitio
  cruzado lograría es una petición que cualquiera puede hacer con `curl`. Lo que las protege del
  abuso es el límite de tasa (ADR-026), que es su problema real. Y exigirles token sería imposible:
  el token nace **con** la sesión.
- **`POST /auth/logout` NO queda fuera.** Cerrarle la sesión a alguien desde fuera es un ataque
  pequeño, pero es un ataque.

**La comparación va con `timingSafeEqual` sobre los SHA-256 de los dos lados.** `timingSafeEqual`
exige buffers de la misma longitud y **lanza** si no lo son; comparar los tokens crudos obligaría a
mirar la longitud primero, y esa comprobación instantánea es en sí misma un oráculo que revela el
tamaño del token bueno. Hasheando, la longitud es siempre 32 bytes y deja de decir nada. El hash aquí
**no guarda nada**: es un igualador de longitud.

### El back office: también lo lleva

Su sesión vive en otra tabla, otro proceso y otro contenedor de inyección, así que tiene su propio
guard (`CsrfDeOperadorGuard`); lo que comparte con la app cliente es la comparación en tiempo
constante, que vive **una sola vez** en `shared/infrastructure/http/csrf.ts`.

**Por qué se decidió que lo llevara**, aunque su exposición sea menor: SEGURIDAD.md §4.2 pide «token
CSRF en toda mutación del panel», y éste es el panel con más poder del sistema —cinco escrituras que
cambian el plan o el estado de cualquier company—. Es cierto que hoy sus mutaciones son `fetch` con
`Content-Type: application/json` desde su propia página, que un sitio cruzado no puede emitir sin un
preflight que `cors: false` rechaza, y que escucha en loopback tras un túnel SSH. **Pero las tres
cosas que lo protegen son propiedades accidentales del despliegue de hoy**: el día que alguien sirva
un `<form method="post">` desde estas mismas rutas —un formulario HTML no necesita preflight— la
defensa desaparece sin que ningún check avise. El coste medido fue un guard de 40 líneas, una columna
y tres líneas en su guion de navegador; no había razón para pagar la deuda en vez del código.

### Los comentarios que U4 revierte

Tres sitios del árbol afirmaban que el token no hacía falta. Se reescriben, **no se borran en
silencio**, porque el argumento que sostenían era razonable y hay que decir por qué ya no basta:

| Dónde | Qué decía | Qué dice ahora |
|---|---|---|
| `iam/…/cookies.ts` | «no hace falta un token anti-CSRF porque no hay petición cruzada que lleve credencial» | Las tres razones por las que sí hace falta: `SameSite` lo aplica el **navegador** y no la API; mira el **sitio** y no el **origen**, así que un subdominio propio manda la cookie; y la defensa en profundidad no se argumenta por redundancia sino porque **las dos fallan por motivos distintos** |
| `iam/…/sesion.guard.ts` | «admitir `Bearer` reabriría el CSRF que `SameSite=Strict` cierra» | Se sigue rechazando `Bearer`, pero por una razón más modesta y más cierta: hoy el único cliente es un navegador |
| `test/integracion/pentest.spec.ts` (A7) | «`SameSite=Strict` es lo que para el CSRF» | Lo paran dos cosas, y la segunda es la que manda porque la comprueba el servidor |

**ADR-006 no se toca**: es inmutable por la regla de `docs/decisiones/README.md`. ADR-021 dice qué
parte suya supersede y por qué.

### El frontend, lo mínimo para no dejarlo roto

- `apps/web/src/lib/csrf.ts` (nuevo): el token en memoria, con su `guardarCsrf` / `csrfEnMemoria`.
- `lib/api.ts`: `X-CSRF-Token` en toda mutación, y `'DELETE'` admitido en el tipo del método. Si el
  token no está en memoria —porque la pestaña se recargó— lo pide con `GET /auth/sesion` **antes** de
  mutar; no hay recursión, porque esa es una lectura. Y si el que tenía **dejó de valer** —dos
  pestañas, dos sesiones, la cookie del sitio sobrescrita—, `llamar()` reintenta la mutación **una
  sola vez** con uno nuevo antes de dejar subir el error *(añadido en la revisión; ADR-021
  §Alternativa 3)*.
- `app/entrar/page.tsx` lo guarda al entrar; `componentes/Marco.tsx` lo limpia al salir.
- Las cuatro pantallas existentes siguen funcionando sin tocarlas. **No se construyó ninguna nueva.**

**Por qué el token vive en `lib/csrf.ts` y no en `lib/sesion.tsx`**, que es donde la etapa lo pedía:
`sesion.tsx` es un contexto de React y `api.ts` —que es quien necesita el token— no es un componente;
se llama desde manejadores de eventos y funciones sueltas, donde no hay contexto que leer. Un módulo
con una variable es lo que las dos partes pueden compartir sin que la capa de transporte dependa de
React. Queda anotado como desviación consciente.

---

## Decisiones de la etapa

| # | Decisión |
|---|---|
| D-16.65 | **Synchronizer token, no double-submit.** El token vive en la fila de la sesión y viaja en el cuerpo; una segunda cookie legible sería el mismo canal que se está protegiendo y dependería de que nadie pueda escribir cookies del sitio — que es justo lo que un subdominio comprometido sí puede |
| D-16.66 | **En claro en `session.csrf_token`.** No es una credencial de acceso, y guardarlo hasheado impediría `GET /auth/sesion`, que es lo que evita rotarlo en cada recarga. Riesgo aceptado y escrito: un volcado de `session` revela tokens CSRF vivos, que sin la cookie no habilitan nada |
| D-16.67 | **La sesión sin token es inválida (401), no una sesión que no puede mutar (403).** Sin relleno de las filas viejas; el despliegue cierra las sesiones abiertas, y a cambio `csrfToken` es `string` en todo el código de encima |
| D-16.68 | **El back office lleva su propio token**, con guard propio y columna propia. Lo que hoy lo protege son propiedades accidentales del despliegue; el token no depende de ninguna |
| D-16.69 | **No se implementa la verificación de `Origin`/`Referer`** que SEGURIDAD.md §4.2 llama «capa extra». Duplicaría la lista blanca de CORS y derivaría de ella; en desarrollo y en las pruebas esa lista está vacía, así que la comprobación necesitaría un «si está vacía, pasa» que **falla abierto**; el back office no tiene lista que consultar (`cors: false`, puerto de loopback variable); y `supertest` no manda `Origin`. **Señal para reabrirlo:** un cliente que no sea `apps/web`, o el back office publicado fuera de loopback. ADR-021, alternativa descartada 2 |
| D-16.70 | **Un único helper de integración, `test/soporte/csrf.ts`**, y solo porque el problema es de *correspondencia* y no de comodidad: las suites manejan hasta cuatro sesiones a la vez y toda mutación necesita cookie y token **emparejados**. `servidor()`, `sembrarTenant()` y `entrar()` se siguen copiando por archivo |
| D-16.71 | **La comparación se hace sobre los SHA-256 de los dos lados**, no sobre los tokens: `timingSafeEqual` lanza con longitudes distintas, y comprobar la longitud antes sería un oráculo del tamaño del token |
| D-16.72 | **El token del frontend vive en `lib/csrf.ts`** (módulo con estado) y no en el contexto de React, porque `api.ts` se ejecuta fuera de React y no puede leer un contexto |

---

## Consultas del camino crítico

**Ninguna consulta nueva.** El token viaja en `session_lookup`, que ya se ejecutaba en cada petición,
y sale de la misma fila (`s."csrf_token"`): no hay JOIN nuevo, ni índice nuevo, ni una segunda
lectura. `GET /auth/sesion` no consulta nada — devuelve el objeto que el guard dejó en el `WeakMap`.

El coste añadido por petición mutante es **dos SHA-256 sobre 43 bytes** en el guard. La alternativa
(comparar cadenas) habría sido más rápida y con canal de tiempo; el orden de magnitud aquí es de
microsegundos frente a los milisegundos de cualquier consulta.

---

## Pruebas

**Unitarias:** 839 en verde (`npm run test:unit`), 16 nuevas — 14 de la construcción y **2 de la revisión** (`logger.options.spec.ts`).

| Archivo | Qué comprueba |
|---|---|
| `shared/infrastructure/http/csrf.spec.ts` *(nuevo, 11)* | Que un token de **longitud distinta** no revienta con el `RangeError` de `timingSafeEqual` —sería un 500 en vez de un 403, y además un oráculo de longitud—; que la lista de métodos seguros no se deja engañar por las minúsculas; que sin método se trata como mutación; que una cabecera repetida se descarta entera |
| `shared/infrastructure/http/error.filter.spec.ts` *(+2)* | `CSRF_INVALIDO` → **403** con su propio `code`, distinguible de `PERMISO_DENEGADO`; y que el motivo (`ausente` / `no_coincide`) **no** sale al cliente |
| `iam/…/iniciar-sesion.spec.ts` *(+1, y el doble arreglado)* | Que el token anti-CSRF **sí** se guarda en claro, que **no** es el de sesión, y —por el doble que ahora devuelve valores distintos en cada llamada— que no se deriva uno del otro |

**Integración:** 408 en verde, 30 archivos (`npm run test:integration`). Las 🔴 de la etapa viven en
`autenticacion-y-autorizacion.spec.ts`, `describe('token anti-CSRF')`, más dos en
`backoffice-interfaz.spec.ts`:

| 🔴 | Prueba |
|---|---|
| 🔴 | Una mutación **sin** la cabecera es **403 `CSRF_INVALIDO`** |
| 🔴 | Con el token de **otra sesión**, 403: no basta con traer «un» token |
| 🔴 | Con el token de su propia sesión, **pasa** (201) |
| 🔴 | Una **lectura** no necesita token |
| 🔴 | Una **ruta pública** sigue funcionando sin cabecera (202 en `/auth/password/olvido`) |
| 🔴 | El login lo devuelve en el **cuerpo** y **no en ninguna cookie** — se comprueba sobre las cabeceras `Set-Cookie` crudas, y que solo hay una |
| 🔴 | `GET /auth/sesion` devuelve **el mismo token** que el login, más `userId`, `permisos` y `alcance`; y **no** `companyId` |
| 🔴 | **Cada sesión lleva SU token**: al volver a entrar, la anterior sigue sirviendo con el suyo y los dos no son intercambiables *(corregida en la revisión — ver «Problemas»)* |
| 🔴 | Un **formulario cruzado no puede iniciar sesión**: el cuerpo va en JSON o no va *(añadida en la revisión)* |
| 🔴 | Una **sesión anterior a la migración** (se pone `csrf_token = NULL` con la dueña) no puede ni leer: **401 `SESION_INVALIDA`**, no 403 |
| 🔴 | `GET /auth/sesion` publica el alcance como **unión** (`{clase:'ubicaciones', ids:[…]}`), sin aplanarlo |
| 🔴 | Back office: mutación sin cabecera → 403 `CSRF_INVALIDO`; con su token → 204; y el token no viaja en su cookie |

Y la prueba de P1 «el token no viaja en el cuerpo» se **reescribió en vez de relajarse**: la lista de
claves del cuerpo sigue siendo cerrada (`['csrf','expiraEn']`) y ahora comprueba además que el valor
de la cookie **no aparece en el texto de la respuesta**, que es la propiedad que de verdad importaba.

### El helper, y qué NO es

`apps/api/test/soporte/csrf.ts` — `cookieConCsrf(respuesta)` saca la cookie de un login, apunta su
token y devuelve la cookie (sirve para los dos logins del sistema); `csrfDe(cookie)` devuelve el que
le toca. `csrfDe` **devuelve cadena vacía y no lanza** cuando no lo conoce, a propósito: las suites
mandan a posta cookies inventadas o manipuladas para comprobar que dan 401, y ahí el guard de sesión
corta antes que el de CSRF — lanzar convertiría esas pruebas en un fallo del helper.

Las 205 mutaciones existentes ganaron `.set('X-CSRF-Token', csrfDe(<cookie>))` con una transformación
mecánica; los tres sitios que la transformación no pudo tocar (una cookie construida con `??`, y dos
extracciones que solo miran atributos) se revisaron a mano.

---

## Problemas encontrados y cómo se resolvieron

| Problema | Cómo se vio | Solución |
|---|---|---|
| La prueba de P1 «en la base se guarda el HASH del token» pasó a fallar | `expected "…csrfToken:\"token-en-claro\"…" not to contain 'token-en-claro'` | El doble de `GeneradorDeTokens` devolvía **siempre lo mismo**, así que el CSRF quedaba igual al de sesión. Se arregló el doble (valor distinto por llamada), que además es lo que hace visible el error de derivar un token del otro |
| `abrirConteo` empezó a dar 403 en `periodos-y-conteo.spec.ts` | 31 fallos en dos archivos tras la transformación mecánica | La transformación no reconoce `.set('Cookie', datos.quien ?? admin)`. Se extrajo la expresión a una variable y se puso el token al lado |
| La prueba de `GET /auth/sesion` esperaba alcance de ubicaciones y recibía `{clase:'company'}` | `expected { clase: 'company' } to deeply equal { clase: 'ubicaciones', … }` | El bloque `roles`, que corre antes, le asigna `LECTURA` —rol de company— al mismo gerente. La prueba del alcance de ubicaciones se mudó **al bloque que corre antes**, con el porqué escrito al lado |
| La suite de integración tardó 2 077 s (frente a 184 s) | INC-014, base sucia tras varias corridas | `npm run db:reset -- --si` y de vuelta a 161 s. `docker stop costeo-api` antes de la suite (INC-016), y `docker start` al terminar |

**Ninguna incidencia nueva:** los cuatro problemas son de esta construcción y ya están cubiertos por
INC-014 / INC-016 o por la propia prueba que los detectó.

### Lo que encontró la revisión de la etapa, y qué se hizo con cada cosa

Cinco hallazgos, **los cinco reales**: se verificó cada uno contra el árbol y contra la API antes de
tocar nada. Ninguno era falso; el quinto resultó **peor** de lo que decía el revisor.

| # | Hallazgo | Verificación | Qué se hizo |
|---|---|---|---|
| 1 🔴 | **El token anti-CSRF salía EN CLARO en el log de cada mutación.** `redact.paths` de `logger.options.ts` seguía siendo el trío de P0 y nadie añadió la cabecera nueva | 34 líneas de la salida de integración contenían el token vivo; 0 contenían la cookie —esa sí estaba redactada— | La lista pasa a ser `CABECERAS_SIN_LOG`, **derivada de `CABECERA_DE_CSRF`** para que un renombrado no la deje atrás, y `logger.options.spec.ts` (nuevo, 2 pruebas) la clava entera. La fila **C14** de `AUDITORIA.md` nombra ahora las cuatro cabeceras y la regla de que un secreto nuevo entra ahí **en el mismo paquete** que lo introduce. Verificado: tras el arreglo, la salida de las 30 suites tiene **0 apariciones** de `x-csrf-token` |
| 2 🔴 | **La 🔴 «volver a entrar rota el token» no medía lo que decía, y la afirmación era falsa.** `IniciarSesion` no revoca ninguna sesión: medía cookie-nueva + token-viejo, que es la prueba de arriba | `iniciar-sesion.ts` no llama a ningún `revocar`; la sonda del revisor (sesión anterior + su propio token → **201**) se reprodujo | Se eligió la opción (b) —**no** cerrar sesiones al entrar: rompería el uso multidispositivo y sería otra decisión—. La prueba se sustituye por la que faltaba: la sesión anterior **sigue sirviendo con su token**, y los tokens no son intercambiables ni entre dos sesiones del mismo usuario. Se corrigen `docs/apis/app-cliente.md`, el comentario de `iniciar-sesion.ts`, la fila 🔴 de arriba y **ADR-021** (§Decisión y §Alternativa 3) |
| 3 🟠 | **26 aserciones de 403 comprobaban solo el estado**, varias de ellas 🔴 de CLAUDE.md §7. Como `CsrfGuard` corre antes que `PermisosGuard`, a una mutación sin cabecera le habría bastado el 403 de CSRF para pasar por prueba de permisos | Con un `GERENTE_LOCAL`, `POST /ubicaciones` sin cabecera responde `CSRF_INVALIDO`, no `PERMISO_DENEGADO` | Las 26 llevan ya `expect(...).toMatchObject({ code: 'PERMISO_DENEGADO' })`. Y como es automatizable, **es una regla de `audit:forbidden`**: `403-de-integracion-sin-su-code` exige una aserción de `code` dentro del mismo `it`. Se comprobó que **falla** borrando una a mano, no solo que pasa |
| 4 🟠 | **El cliente web no sabía recuperarse de un `CSRF_INVALIDO`**, y el caso se da sin atacante: dos pestañas, la segunda vuelve a entrar, la cookie del sitio se sobrescribe y la primera queda con un token que ya no vale — 403 en bucle hasta recargar | `grep -rn 'CSRF_INVALIDO' apps/web/src` no devolvía nada | `llamar()` reintenta **una sola vez** con contador explícito: tira el token, lo vuelve a pedir con `GET /auth/sesion` y repite; si vuelve a fallar, el error sube con el mensaje del backend. Anotado en ADR-021 §Alternativa 3, porque cambia su argumento |
| 5 🔴 | **La justificación de dejar el login fuera del guard era falsa.** Una petición cruzada al login no *usa* una credencial: la **crea** (login CSRF / fijación) | Y era peor que un error de redacción: Nest monta `urlencoded` por defecto, así que `POST /auth/login` con `Content-Type: application/x-www-form-urlencoded` **respondía 401 y no 400** — o sea, analizaba el formulario. Un `<form>` cruzado bastaba para dejar la sesión del atacante instalada en el navegador de la víctima | No se documenta como riesgo asumido: **se cierra**. `bootstrap.ts` pasa a `bodyParser: false` + `useBodyParser('json')`, así que la API solo entiende `application/json` —lo único que un `<form>` cruzado no puede emitir y que un `fetch` cruzado solo consigue con un preflight que decide CORS—. Ningún endpoint recibía formularios, así que no se pierde nada. Prueba nueva: «un formulario cruzado no puede iniciar sesión». Corregidos el comentario del guard y la tabla «Lo que queda fuera» de ADR-021 |

**Ninguna incidencia nueva tampoco aquí.** El hallazgo 2 es el **caso 11 de INC-007** —una
verificación en verde que no mide lo que dice; nuevo solo en que el sujeto es una prueba y no un
check— y sube su contador a 11, con su sección escrita en la ficha. El 1 y el 3 se convirtieron en
verificación automática en el mismo paquete, que es lo que CLAUDE.md §8 exige en vez de una ficha.

### Decisiones de la revisión

| # | Decisión |
|---|---|
| D-16.73 | **Volver a entrar NO cierra las sesiones anteriores**, y así se documenta. Se consideró implementarlo para que la 🔴 fuera verdad y se descartó: rompe el uso multidispositivo, es un cambio de comportamiento y necesitaría su propia decisión del usuario. Lo que la generación por sesión garantiza —y es lo que importa contra la fijación— es que **el token nunca lo elige el cliente** |
| D-16.74 | **La API analiza SOLO `application/json`.** `bodyParser: false` + `useBodyParser('json')` en `bootstrap.ts`. Cierra el login CSRF sin lista de orígenes y sin tocar D-16.69. Precio: ningún endpoint podrá recibir un `<form>` nativo; el día que haga falta, la respuesta es un token en campo oculto, **no** volver a encender el analizador |
| D-16.75 | **El proceso del back office se queda como está** (sigue con los dos analizadores). Su `NestFactory.create` vive en `backoffice.ts`, que **ninguna suite monta** —`backoffice-interfaz.spec.ts` arma su propia app—, así que cambiarlo sería código de producción sin prueba, justo lo que la cabecera de `bootstrap.ts` prohíbe. Y el ataque ahí vale poco: exige credenciales de operador válidas, escucha en loopback tras un túnel SSH, y lo único que consigue es que la víctima trabaje dentro de la sesión **del atacante**, registrada a su nombre. **Señal para reabrirlo:** el día que el back office se publique fuera de loopback, o que su lanzador entre en una suite |

---

## Deuda y pendientes de la etapa

- **`Origin`/`Referer` no se comprueba** (D-16.69), con su señal escrita en ADR-021.
- **`allowedHeaders` de CORS no se declara.** `X-CSRF-Token` pasa hoy porque el paquete `cors`
  refleja `Access-Control-Request-Headers` cuando `allowedHeaders` no está puesto: funciona **por
  reflejo y no por contrato**. Declararlo sigue siendo de la **etapa 2**, junto con el `DELETE` de
  `methods`; si se declara, tiene que incluir `Content-Type` y `X-CSRF-Token` o rompe todos los
  `POST` con JSON desde el navegador. *(La revisión sí tocó `bootstrap.ts`, pero solo el analizador
  de cuerpo —D-16.74—: son líneas distintas y no se adelanta nada de la etapa 2.)*
- **El back office sigue con los dos analizadores de cuerpo** (D-16.75), con su señal de reapertura.
- **`AccesoBloqueadoError` sigue sin `Retry-After`** (deuda de ADR-026, no de esta etapa).
- **El índice de ADR salta del 012 al 021**: los ADR-013…019 existen en la carpeta y no tienen fila
  en `docs/decisiones/README.md`. Heredado de P16-A1 (`CONSTRUCCION.md:700`), sigue sin tocarse: no
  es de esta etapa y meterlo aquí mezclaría dos cosas en un commit.

---

## Cómo probar manualmente lo construido

```bash
# 1. La base al día
npm run migrate:deploy && npm run migrate:verify

# 2. Entrar: el cuerpo trae el token
curl -si -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"...","contrasena":"..."}'
#    -> 200 {"expiraEn":"…","csrf":"8Kb…"}  +  Set-Cookie: sesion=…   (sin `csrf` en la cookie)

# 3. Mutar SIN la cabecera -> 403 CSRF_INVALIDO
curl -si -X POST http://localhost:3000/ubicaciones -b 'sesion=<token>' \
  -H 'content-type: application/json' -d '{"nombre":"Prueba","tipo":"LOCAL"}'

# 4. Con la cabecera -> 201
curl -si -X POST http://localhost:3000/ubicaciones -b 'sesion=<token>' \
  -H 'content-type: application/json' -H 'X-CSRF-Token: <csrf>' \
  -d '{"nombre":"Prueba","tipo":"LOCAL"}'

# 5. Recargar la pagina: el token se recupera
curl -s http://localhost:3000/auth/sesion -b 'sesion=<token>'
#    -> {"userId":"…","permisos":[…],"alcance":{…},"csrf":"8Kb…"}   (el MISMO de arriba)

# 6. En el navegador: entrar en apps/web, elegir sucursal, y guardar un conteo o
#    unas ventas. La cabecera se ve en la pestana de red; sin ella, 403.

# 7. (revision) Un formulario cruzado NO puede iniciar sesion: el cuerpo va en
#    JSON o no va. Antes de D-16.74 esto respondia 401 —o sea, lo analizaba—.
curl -si -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data 'email=...&contrasena=...'
#    -> 400 {"code":"ENTRADA_INVALIDA",…}   y NINGUN Set-Cookie

# 8. (revision) El token NO aparece en el log. Con la API en primer plano,
#    hacer la mutacion del paso 4 y mirar stdout: la linea «request completed»
#    no trae `x-csrf-token` ni `cookie`.
```

## Evidencia de la etapa

```
npm run audit:types        OK
npm run audit:lint         OK
npm run audit:forbidden    OK — 45 reglas sobre 443 archivos (la 45 es la de la revision)
npm run audit:arch         OK — 358 modulos, 1558 dependencias, 0 violaciones
npm run audit:complexity   OK
npm run audit:duplication  OK — Found 0 clones
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS
npm run audit:deadcode     OK (knip: solo «configuration hints»)
npm run audit:secrets      OK
npm run audit:deps         OK — sin vulnerabilidades altas fuera de las 4 aceptadas
npm run audit:sec-headers  OK — 19 pruebas
npm run audit:tests        OK — unitarias (sin base) e integracion en verde

npm run migrate:deploy     Applying migration `20260910202336_p16a2_csrf` — applied
npm run migrate:verify     1/4 ida · 2/4 ida y vuelta · 3/4 up->down->up idempotente ·
                           4/4 sin deriva + toda tabla con ENABLE + FORCE RLS

test:unit          59 archivos, 839 pruebas, 0 fallos
test:integration   30 archivos, 408 pruebas, 5 omitidas, 0 fallos (169 s, tras la revision)
```

## Incidencias registradas en esta etapa

Ninguna nueva. Se aplicaron las ya registradas: **INC-014** (base sucia → `npm run db:reset -- --si`)
e **INC-016** (`docker stop costeo-api` antes de la suite de integración, `docker start` al terminar).

---
---

# Etapa 2 — la frontera HTTP

**Inicio:** 2026-09-10 · **Estado:** ✅ construida

> Lo que el plan pide en su línea (`PLAN.md:149`) para esta etapa: `error.filter.ts` (tres errores →
> 400) · `PERIODO_SIN_DATOS` → 404 · CORS + `DELETE` · `CONSULTA_*` `.strict()` · `nombre` en ventas
> y menu-engineering. **Sin migración**: nada de lo de aquí toca el esquema.

## Plan de la etapa

### Hallazgos de la lectura que cambiaron el diseño

| Hallazgo | Consecuencia |
|---|---|
| El plan dice «`error.filter.ts` (tres errores → 400)» y **no nombra los tres** | Se identificaron en el árbol: son las tres familias de clases que extienden `Error` a secas, son alcanzables desde HTTP y hoy no se traducen. La lista y su justificación están abajo, y quedan como decisión por si el constructor tenía otras tres en la cabeza |
| `EscalaExcedidaError` es alcanzable **desde el borde y desde dentro** | Convertirlo en 400 habría enmascarado un bug del motor como error del usuario, y —más grave— el filtro habría dejado de escribir su traza en el log. Se cerró el camino de entrada en vez de reclasificar el error |
| Los mensajes de los tres **citan el valor que el usuario escribió** | Mientras eran 500 ese texto no salía del servidor; ahora sí. Hizo falta una función que lo recorte y le quite los caracteres de control — un `@Param` no pasa por `EsquemaPipe` |
| Dos comentarios del árbol justificaban por escrito que los `CONSULTA_*` **no** fueran `.strict()` | El argumento —los parámetros de rastreo de un navegador— era razonable y resultó falso por dos motivos distintos. Se reescriben, no se borran |
| `supertest` **no hace preflight** | Por eso `DELETE /usuarios/roles` llevaba desde P1 pasando todas las pruebas y siendo inalcanzable desde un navegador. La única forma de verlo es emitir el `OPTIONS` a mano, y no había ni una prueba de CORS en el repositorio |
| `RepositorioDeAnalitica` declara en su cabecera que solo toca **sus dos tablas** | El nombre del producto no puede salir de un `JOIN` a `product` desde ahí. Se pide al caso de uso de `recipes`, que es quien manda en los productos (ADR-011) |
| `datos.carta` ya trae el nombre de cada producto costeado | El `nombre` de menu engineering **no cuesta una consulta**: se estaba tirando |

---

## Qué se construyó

### 1. Los tres errores que salían como 500

Es INC-012 aplicado a los tipos, y la frase de esa incidencia se cumple igual aunque aquí no haya
base de por medio: **algo hace cumplir una regla y nadie la explica**. Allí era un `CHECK`; aquí, el
constructor de un tipo de dominio. El resultado era el mismo: `500 INTERNAL_ERROR`, mensaje genérico,
alerta de operación, y cero información para quien había escrito mal un dato suyo.

Los tres, con el porqué de que la clasificación sea **incondicional** y no una suposición sobre el
llamante:

| Clase | Qué la dispara | Por qué es entrada y nunca un fallo interno |
|---|---|---|
| `IdentificadorInvalidoError` | `GET /costeo/no-soy-uuid`, `GET /catalogo/articulos?itemId=basura`, `PUT /catalogo/items/:id`… 16 `@Param` y 5 `@Query` sin `ParseUUIDPipe` | Los identificadores que nacen dentro salen de columnas `uuid`, que no pueden traer otra cosa |
| `UnidadDeUsoInvalidaError` | `POST /catalogo/items` con `"KG"`, `"Litro"`, `"unid de medida"` | La unidad que nace dentro sale de `item.unit_of_use`, atada por clave foránea a `unit` |
| `ValorDecimalInvalidoError` | Un decimal con coma, exponente o separador de miles — **y ahora también con más de 30 decimales** | `desdeCadena` es la puerta de `cadena → número`, y esa puerta solo la cruzan valores que alguien escribió |

Las tres pasan a extender `ErrorDeDominio` con `codigo = 'ENTRADA_INVALIDA'`. **No hizo falta tocar
`error.filter.ts` para esto**, y eso es una señal de que el diseño de P0 era el correcto: el `Record`
exhaustivo ya mapeaba `ENTRADA_INVALIDA → 400`, así que lo único que faltaba era que el dominio
dijera de qué clase era su error. Vive todo en `shared/domain`, dominio importando dominio: ni una
dependencia nueva hacia afuera.

**Por qué `EscalaExcedidaError` NO se convirtió.** Es la decisión más discutible de la etapa y por eso
está escrita en tres sitios (el propio archivo, `guardas-de-dominio.md` y aquí). Ese error no es del
borde: es el techo de escala saltando **a mitad de un cálculo** —multiplicar suma escalas—, o sea un
bug del motor. Un 400 le diría al usuario que arregle algo que no es suyo, y el filtro dejaría de
escribir la traza en el log, que es lo único con lo que se diagnostica un desbordamiento. Lo que sí se
cerró es el camino por el que un dato de entrada llegaba hasta ahí: `desdeCadena` cuenta los decimales
**de la cadena** —antes de construir el valor, porque después ya se aceptó— y rechaza con el error de
entrada. Después de eso, si `EscalaExcedidaError` salta, es de casa y el 500 es la respuesta honesta.

**Lo que los mensajes obligaron a añadir.** Los tres citan el valor que el usuario escribió, y desde
que salen como 400 ese valor **vuelve al cliente**. `valorParaMensaje` lo recorta a 60 caracteres —el
cuerpo de un error no debe ser el eco de la petición— y le quita los caracteres de control: los
parámetros de ruta no pasan por `EsquemaPipe`, y un salto de línea dentro de un mensaje que acaba en
una línea de log parte esa línea en dos, y la segunda la escribe quien llamó. Se filtra por código y
no con una expresión regular porque un rango de control en un literal es justo lo que la regla
`no-control-regex` prohíbe.

También se limpió una fuga menor: `ValorDecimalInvalidoError` llevaba dentro el nombre del método
interno que lo lanzó (`Money.fromDecimalString`). Da igual mientras es un 500 —el mensaje no sale—;
ahora se mueve a `detalle`, que solo viaja al log. *(Cuando se escribió esta línea era falsa: nadie
leía `detalle`. La revisión de la etapa la convirtió en verdad — ver «Lo que encontró la revisión de
la etapa 2», hallazgo 2.)*

### 2. `PERIODO_SIN_DATOS` — el segundo 404

`PeriodoSinDatosError` pasa de `RECURSO_NO_ENCONTRADO` a un código propio. **El estado no cambia**:
sigue siendo 404, porque no hay nada que devolver. Lo que cambia es que la pantalla puede distinguir
dos situaciones opuestas que hasta ahora llegaban con la misma etiqueta:

- «**Este mes no se ha abierto**» es un estado normal del producto, se arregla cargando las ventas, y
  lo que corresponde enseñar es un camino, no un aviso rojo.
- «**No existe**» es un enlace roto o un id que no es tuyo.

Lo devuelven las **seis vistas** de analítica, que son las que pasan por `contexto()`.
`GET /analitica/ventas` y `/costos-fijos` **no**: para una carga, un mes sin fila de período es la
lista vacía, y así estaba ya. El consolidado tampoco lo propaga: lo convierte en su lista `sinDatos`
(ADR-012), y como lo hace con `instanceof` no le afectó el cambio de código.

Ningún cliente leía `RECURSO_NO_ENCONTRADO` en esos endpoints, así que el cambio de contrato no rompe
nada — se comprobó en `apps/web` y en las 30 suites antes de tocarlo.

### 3. `.strict()` en los ocho esquemas de consulta

Los ocho: `CONSULTA_DEL_MES`, `CONSULTA_DEL_MES_DE_COMPANY`, `CONSULTA_DE_COSTEO`,
`CONSULTA_DE_RECETA`, `CONSULTA_DE_SALDOS`, `CONSULTA_DEL_LIBRO`, `CONSULTA_DE_CONTEOS`,
`CONSULTA_DE_PERIODOS`.

**Lo que pasaba antes no era «se toleraba un parámetro de más»: era que el intento se perdía.** Con el
modo laxo de Zod la clave sobrante se descarta en silencio y la respuesta es **200**.
`GET /analitica/resumen?…&companyId=<otra>` respondía con los datos de la sesión y tiraba el
`companyId` sin dejar rastro. El alcance nunca llegó a moverse —el caso de uso ni mira ese parámetro—,
pero nada quedaba registrado. Es la asignación masiva de SEGURIDAD.md §3 vista desde la consulta, y es
exactamente la razón por la que todo cuerpo ya era estricto.

**Los dos comentarios que justificaban lo contrario se reescriben, no se borran.** El argumento decía
que un navegador puede añadir parámetros de rastreo a una URL —`utm_source` y compañía— y que
rechazar la petición por eso sería hostil. Era razonable, y resultó falso por dos motivos:

1. **No era «la única excepción del proyecto», como decía `recetas.dto.ts`: eran ocho.** Un comentario
   que dice «única» y no lo es deja de avisar de nada. Y mientras tanto `esquema.pipe.ts` afirmaba en
   su cabecera que «TODO esquema de este proyecto es `.strict()`»: dos archivos mintiendo en sentidos
   opuestos. Con este cambio la afirmación de `esquema.pipe.ts` pasa a ser verdad, igual que las
   cabeceras de `analitica.dto.ts` y `periodos.dto.ts`, que decían lo mismo.
2. **`utm_source` no llega a esta API.** El rastreo se pega a la URL de una *página*, que sirve
   `apps/web`; esto son llamadas `fetch` cuya URL construye el propio cliente carácter a carácter.

La refutación completa vive en `recetas.dto.ts` —que es de donde colgaba el argumento— y
`costeo.dto.ts` apunta allí en vez de repetirla.

### 4. CORS

```
methods:        GET, POST, PUT, PATCH, DELETE
allowedHeaders: Content-Type, X-CSRF-Token
exposedHeaders: x-correlation-id, Retry-After
maxAge:         600
```

- **`DELETE`.** El comentario que había —«un `DELETE` permitido en CORS sobre una API que no borra
  nada es superficie regalada»— dejó de ser cierto en P1: `DELETE /usuarios/roles` existe. Desde el
  navegador era **inalcanzable**, porque el preflight lo rechazaba, y ninguna prueba lo veía porque
  `supertest` no hace preflight.
- **`allowedHeaders` declaradas, no reflejadas.** Sin la línea, el paquete `cors` devuelve lo que el
  navegador haya pedido en `Access-Control-Request-Headers`: `X-CSRF-Token` pasaba **por reflejo y no
  por contrato**, y la lista blanca de cabeceras era en la práctica `*`. Era la deuda que la etapa 1
  dejó anotada. `Content-Type` va primero porque sin él no pasa ningún `POST` con cuerpo JSON — y
  desde D-16.74 la API solo entiende JSON, así que no habría forma de escribir nada.
- **`exposedHeaders`** *(no estaba en la línea del plan; se añade y se justifica)*. Por defecto el
  navegador solo deja leer siete cabeceras fijas, y ninguna es nuestra: el mensaje de los 5xx pide
  literalmente citar `x-correlation-id` y el JavaScript de la página **no podía leerlo**, y
  `Retry-After` (D-16.64) llegaba sin que el cliente pudiera decir cuánto esperar.
- **`maxAge: 600`** *(tampoco estaba en la línea del plan)*. Sin él, **toda** mutación son dos viajes,
  y esta aplicación se usa de pie en una bodega con mala conexión (CLAUDE.md §10). Diez minutos es
  corto a propósito: un cambio de la política se propaga en minutos, no al día siguiente.

**En producción `CORS_ORIGENES` sigue vacío a propósito** —un solo origen, servido por el mismo
Caddy—, y con la lista vacía `createApplication` deja `cors: false`. Por eso la suite de CORS levanta
su propia app con orígenes declarados: probar la política con la configuración de producción sería
probar que no hay política.

### 5. El `nombre` en ventas y menu engineering

Los dos DTO devolvían solo `productId`, y la pantalla lo resolvía pidiendo **`GET /costeo` en
paralelo** —costear la carta entera— para unir por clave en el navegador. El propio archivo lo tenía
anotado: «queda anotado que lo limpio sería que la API publicara el nombre».

Dos caminos distintos, y ninguno de los dos toca una tabla ajena (ADR-011):

- **Menu engineering: cero consultas nuevas.** `ContextoDelPeriodo.carta` ya trae el nombre de cada
  producto costeado. `ConsultarMenuEngineering` devuelve ahora `MenuConNombres` —el `Menu` y un mapa
  aparte— y el DTO los une al borde. **El nombre no entra en `ProductoClasificado`**, que es dominio
  puro: ahí se clasifica por unidades, popularidad y margen, y un nombre no mueve un cuadrante.
  Meterlo sería meter presentación en el único sitio del módulo que corre con la base apagada.
- **Ventas: una consulta más, y la barata.** `RepositorioDeAnalitica` dice en su cabecera que solo
  toca **sus dos tablas**; un `JOIN` a `product` desde ahí sería un segundo sitio que mantener en
  sincronía con `recipes`. Así que `ConsultarVentas` recibe `ListarProductos` —el caso de uso de
  `recipes`, que se exporta ahora— y une el nombre en aplicación, igual que `vistas.ts` hace con el
  catálogo de ítems. Para el frontend es un ahorro neto grande: deja de costear la carta entera.

`nombre` sale **vacío** si el producto ya no está en la carta de la company. Se devuelve la fila
igual: las unidades vendidas ocurrieron, y esconderlas cambiaría el total del mes.

**Nadie gana acceso a nada nuevo.** Los cuatro roles con `sales.read` (`OWNER`, `ADMIN`,
`GERENTE_LOCAL`, `LECTURA`) tienen ya `product.read`; `BODEGA` no tiene ninguno de los dos y sigue sin
tenerlos.

### 6. El frontend, lo que dejó de hacer falta

- `app/menu/page.tsx`: se va el `Promise.all` con `/costeo`, el `Map` de nombres y el estado que lo
  guardaba. Una llamada en vez de dos, y la más cara de las dos era la que sobraba.
- `app/ventas/page.tsx`: **se borra un `catch` de 404 que era código muerto** y además escondía
  enlaces rotos: tragaba *cualquier* 404 y lo convertía en lista vacía, cuando esta carga devuelve
  `[]` y nunca 404. Sigue pidiendo `/costeo` porque necesita la carta entera —categoría y estado de
  cada producto—, no solo nombres; eso es trabajo de la pantalla 3 (P16-B).

---

## Decisiones de la etapa

| # | Decisión |
|---|---|
| D-16.76 | **Los «tres errores → 400» son `IdentificadorInvalidoError`, `UnidadDeUsoInvalidaError` y `ValorDecimalInvalidoError`.** El plan no los nombra; se eligieron por ser las tres familias que extienden `Error` a secas, son alcanzables desde HTTP y no se traducen. Coinciden con los tres síntomas del inventario de la API (id no-UUID, unidad mal escrita, decimal imposible) |
| D-16.77 | **La traducción va en el DOMINIO, no en un `if` del filtro.** Las tres clases pasan a `ErrorDeDominio`; `error.filter.ts` no se toca para esto. Un `instanceof` por clase en la función pura habría hecho que `shared/infrastructure` importara de tres carpetas de dominio y habría engordado una función que ya rozaba el presupuesto de `audit:complexity` |
| D-16.78 | **`EscalaExcedidaError` se queda en 500.** No es del borde: es un desbordamiento a mitad de cálculo. Lo que se cierra es su camino de entrada, con la guarda de decimales en `desdeCadena`. Un 400 ahí enmascararía un bug del motor y le quitaría la traza al log |
| D-16.79 | **El valor citado en un mensaje de error se recorta y se limpia** (`valorParaMensaje`). Desde que estos errores son 400, ese texto vuelve al cliente y acaba en el log |
| D-16.80 | **`PERIODO_SIN_DATOS` reemplaza al código anterior en esa clase**, no se añade al lado. Mismo estado (404), distinto `code`. Es un cambio de contrato y se acepta porque el único cliente es `apps/web` y no lo leía |
| D-16.81 | **`.strict()` en los ocho, sin excepciones**, y los dos comentarios que defendían lo contrario se reescriben con la refutación en vez de borrarse |
| D-16.82 | **CORS gana también `exposedHeaders` y `maxAge`**, que no estaban en la línea del plan. El primero porque el mensaje de error pide citar una cabecera que el navegador no podía leer; el segundo porque sin él toda mutación son dos viajes en una app mobile-first |
| D-16.83 | **El nombre del producto se une en APLICACIÓN, no en el repositorio ni en el dominio.** En menu engineering, al borde y sin consulta nueva; en ventas, pidiéndoselo a `recipes` con `ListarProductos` (que se exporta ahora) en vez de meter un `JOIN` a `product` en un repositorio que declara tocar solo sus dos tablas |
| D-16.84 | **Una suite nueva para el borde (`frontera-http.spec.ts`) y otra para CORS (`cors.spec.ts`).** La segunda es obligada —necesita una app con orígenes declarados, y la regla es una app de Nest por archivo—; la primera es una elección: estas reglas no son de ningún módulo y se rompen todas a la vez |

---

## Consultas del camino crítico

**Una sola consulta nueva en todo el paquete, y solo en `GET /analitica/ventas`**: la lista de
productos de la company (`ListarProductos`, un `SELECT` por `company_id` sobre `product`). Va en
`Promise.all` con la lectura de ventas, así que no añade latencia serie.

El balance para la pantalla es **muy favorable**: hasta ahora esa misma pantalla pedía `GET /costeo`
—que costea la carta entera: recetas, cascada de subpreparaciones, precios vigentes— únicamente para
traducir identificadores en texto. Menu engineering ni siquiera eso: su nombre sale del contexto que
ya estaba cargado.

`.strict()` no añade trabajo: Zod ya recorría el objeto; lo que cambia es qué hace con lo que sobra.
`maxAge` en CORS **quita** trabajo: un preflight cada diez minutos en vez de uno por mutación.

---

## Pruebas

**Unitarias:** 852 en verde (`npm run test:unit`), **13 nuevas**.

| Archivo | Qué comprueba |
|---|---|
| `shared/domain/errors/valor-en-mensaje.spec.ts` *(nuevo, 6)* | Que el salto de línea y el retorno desaparecen —son los que parten una línea de log en dos—, que el nulo y el `DEL` también, que lo largo se recorta y se marca, y que los acentos y las eñes **no** se tocan: son texto legítimo |
| `shared/infrastructure/http/error.filter.spec.ts` *(+5)* | Los tres errores → 400 `ENTRADA_INVALIDA` con su mensaje accionable; que el decimal **no** revela el método interno que lo lanzó y que ese dato está en `detalle`; que el valor citado sale recortado y sin controles; y `PERIODO_SIN_DATOS` → 404 con código propio |
| `shared/domain/decimal/nucleo.spec.ts` *(+2)* | Que una cadena con más decimales de los que el sistema conserva lanza `ValorDecimalInvalidoError` y **no** `EscalaExcedidaError` —que es la distinción entera de D-16.78— y que el límite exacto sí pasa |

**Integración:** 437 en verde, 32 archivos, 5 omitidas (`npm run test:integration`). **29 nuevas** en
dos archivos nuevos y en `analitica.spec.ts`:

| 🔴 | Prueba | Dónde |
|---|---|---|
| 🔴 | Un id de **ruta** mal formado es 400 `ENTRADA_INVALIDA`, y el mensaje dice «UUID» | `frontera-http` |
| 🔴 | Un id de **consulta** mal formado, igual | `frontera-http` |
| 🔴 | El mensaje del id **no es un eco**: 400 caracteres entran, el mensaje sale corto | `frontera-http` |
| 🔴 | `KG`, `Litro` y `unid de medida` son 400, y el mensaje trae ejemplos válidos | `frontera-http` |
| 🔴 | Un importe con 31 decimales es 400 y el mensaje habla de decimales | `frontera-http` |
| 🔴 | Las **seis** vistas responden 404 `PERIODO_SIN_DATOS` en un mes sin abrir | `frontera-http` |
| 🔴 | Un recurso que de verdad no existe **sigue siendo** `RECURSO_NO_ENCONTRADO`: los dos 404 se separan | `frontera-http` |
| 🔴 | `GET /analitica/ventas` de ese mismo mes es **200 con `[]`**, no 404 | `frontera-http` |
| 🔴 | Los **ocho** esquemas rechazan un parámetro de más con 400 `ENTRADA_INVALIDA` | `frontera-http` |
| 🔴 | …y **sin** el parámetro de más ninguno da 400, que es lo que prueba que el 400 vino de ahí | `frontera-http` |
| 🔴 | El consolidado **rechaza** un `locationId` en vez de tirarlo (barrera 3) | `frontera-http` |
| 🔴 | Preflight de `DELETE` con `X-CSRF-Token` desde un origen de la lista: 204, con métodos y cabeceras | `cors` |
| 🔴 | `Content-Type` sigue permitido — sin él no pasa ningún `POST` con JSON | `cors` |
| 🔴 | `Allow-Credentials: true` y el origen **nunca** `*` | `cors` |
| 🔴 | `x-correlation-id` y `Retry-After` **expuestos** | `cors` |
| 🔴 | Un origen fuera de la lista **no recibe el eco de su origen** | `cors` |
| 🔴 | Menu engineering trae `nombre`, y no es el id | `analitica` |
| 🔴 | `GET /analitica/ventas` también | `analitica` |
| 🔴 | **A `BODEGA` no le llega ninguno de los dos**, y el nombre del producto no aparece en el cuerpo | `analitica` |
| 🔴 | El semáforo de `BODEGA` sigue sin traer nombres de **producto** (los de ítem sí: es lo que hay que reponer) | `analitica` |

**Por qué la prueba de `.strict()` está parametrizada.** El defecto es del pipe, no de la ruta: ocho
`it` idénticos con otra URL no comprueban ocho cosas, comprueban una ocho veces, y el día que
aparezca un noveno esquema nadie recordaría escribir el noveno bloque. Aquí se añade una fila. Y cada
ruta se prueba **dos veces** —con el parámetro de más y sin él— porque un 400 solo significa algo si
la misma petición sin la clave sobrante no lo da: si no, estaría midiendo un permiso que falta o un
id mal escrito. Es la lección de INC-007 aplicada por adelantado.

**Las pruebas de `nombre` no crean datos a propósito.** `cargarVentas` es por REEMPLAZO: sembrar allí
borraría las ventas del mes de esa ubicación y las pruebas siguientes medirían otro dataset. Las
cuatro son de solo lectura sobre lo que dejó el bloque de menu engineering.

---

## Problemas encontrados y cómo se resolvieron

| Problema | Cómo se vio | Solución |
|---|---|---|
| `audit:lint` rechazó la primera versión de `valorParaMensaje` | `no-control-regex`: un rango de control dentro de un literal de expresión regular | Se filtra por código de carácter, con dos constantes con nombre. La regla tiene razón: en una regex esos caracteres se leen mal y se copian peor |
| Y `audit:forbidden` cazó el **resto** de ese primer intento: un carácter de control 0x00 **vivo dentro de un comentario** | `[sin-caracteres-de-control] apps/api/src/shared/domain/errors/valor-en-mensaje.ts:24` | El comentario que explicaba por qué no se usa una regex de control **contenía los caracteres de control**, sobrevividos de la versión anterior del archivo. Se reescribió sin citarlos. Es la regla nacida de la octava recurrencia de INC-007, y funcionó: ese carácter no se ve al leer el archivo, solo con `cat -v` |
| Y la segunda versión, también | `@typescript-eslint/no-misused-spread`: `[...cadena]` descompone emojis y caracteres compuestos | `for…of` sobre la cadena, que itera por punto de código sin la trampa |
| `audit:duplication` encontró un clon **nuevo**, creado por el propio cambio | Al envolver los dos esquemas del mes en `.strict()`, sus dos líneas coaccionadas quedaron idénticas: 70 tokens | Se extrajo `MES_COACCIONADO`. Es exactamente para lo que sirve el check: avisar de que dos fronteras han empezado a repetirse |
| La prueba de CORS «un origen ajeno no recibe NINGUNA cabecera» falló | `expected 'true' to be undefined` — el paquete `cors` emite `Allow-Credentials` sin mirar el origen | **La prueba estaba mal, no el código.** `Allow-Credentials`, `Allow-Methods` y `Allow-Headers` describen la política, no al llamante; la única cabecera que decide es `Allow-Origin`. La prueba mide ahora eso, con el porqué escrito al lado para que nadie la «arregle» al revés |

**Ninguna incidencia nueva.** Los cuatro son de esta construcción y los detectó el check o la prueba
que existía para detectarlos. INC-016 aplicada: `docker stop costeo-api` antes de la suite de
integración.

---

## Deuda y pendientes de la etapa

- **Los `@Param` siguen sin `ParseUUIDPipe`.** Ahora dan 400 en vez de 500, que es el arreglo que
  pedía el plan, pero el 400 lo produce el constructor del tipo **dentro del manejador**: la petición
  ya pasó por guards y pipes. Poner `ParseUUIDPipe` en los 16 `@Param` cortaría antes y es
  estrictamente mejor; no se hizo aquí porque toca ocho controladores de seis módulos y esta etapa es
  de `shared`. Queda para P16-B/C, que ya los abre.
- **Los 5 `@Query('x')` crudos siguen sin esquema** (`GET /precios`, `/precios/costo/:itemId`,
  `/catalogo/articulos`, `/catalogo/items`, `/recetas/propagacion/previsualizacion`). Sus valores se
  validan al construir el identificador —de ahí el 400 de arriba—, pero **no son `.strict()`**: un
  parámetro de más ahí se sigue descartando en silencio. `GET /precios/pendientes` está en P16-B y es
  el sitio natural para cerrarlo. *(La revisión: la deuda estaba anotada aquí y **negada** en
  `docs/apis/app-cliente.md`, que es el documento que lee quien integra. Ahora las cinco rutas están
  nombradas allí.)*
- **`GET /precios/costo/:itemId?fecha=basura` sigue devolviendo un 404 mentiroso** («ese ítem no tiene
  precio a esa fecha») en vez de un 400: `new Date('basura')` da `Invalid Date` y todas las
  comparaciones dan `false`. No es un 500, así que no entraba en esta etapa; queda anotado.
- **La cabecera de `esquema.pipe.ts` ya no miente**, y las de `analitica.dto.ts` y `periodos.dto.ts`
  tampoco. No hacía falta tocarlas: lo que se cambió fue el código para que dijeran la verdad.
- **El índice de ADR sigue saltando del 012 al 021** (heredado de P16-A1 y de la etapa 1).

---

### Lo que encontró la revisión de la etapa 2, y qué se hizo con cada cosa

Cuatro hallazgos, **los cuatro reales**: cada uno se reprodujo antes de tocar nada, y el primero se
reprodujo además al revés —quitando el arreglo, para ver la prueba nueva en rojo—.

| # | Hallazgo | Verificación | Qué se hizo |
|---|---|---|---|
| 1 🔴 | **La 🔴 del preflight no medía lo que la etapa dice haber arreglado.** Las dos aserciones de cabeceras (`toContain('x-csrf-token')`, `toContain('content-type')`) piden justo las cabeceras que el paquete `cors` **refleja** cuando `allowedHeaders` no está puesto: salen verdes con la lista declarada y con la lista abierta | Servidor de prueba con el propio paquete: con la config **vieja**, pedir `x-inventado` devuelve `x-inventado`; con la **nueva**, devuelve `Content-Type,x-csrf-token`. Y quitando `allowedHeaders` de `bootstrap.ts`, la suite entera seguía verde | Prueba nueva —**la única que distingue lista declarada de reflejo**—: un preflight que pide `x-inventado` y afirma que `access-control-allow-headers` **es exactamente** `Content-Type,x-csrf-token`. Se comprobó que **falla** sin `allowedHeaders`: 1 de 8 en rojo y las otras 7 en verde, que es exactamente la ceguera denunciada. Las dos aserciones débiles se quedan —el `it` que las lleva sí mide el `DELETE`— con una nota encima que dice qué NO miden y dónde está la que sí, para que nadie «simplifique» la nueva a un `toContain` |
| 2 🟠 | **«Se mueve a `detalle`, que solo va al log» era falso: nadie leía `detalle`.** `ErrorFilter` solo escribía —y solo la traza— cuando el estado es ≥ 500. Al pasar los tres errores de borde a 400, su contexto interno dejó de aparecer en ninguna parte: el cambio no reubicaba el diagnóstico, lo borraba | Buscar `.detalle` en `apps/api/src` sin los specs devolvía **solo la declaración** del campo; el único `logger` del filtro vive dentro del `if (status >= 500)` | Se eligió hacerlo verdad, no rebajar la frase: `diagnosticoDe(error)` compone `code` + `detalle`, y `ErrorFilter` lo escribe en nivel **`debug`** para todo error de dominio 4xx. `debug` y no `warn` porque un 4xx no es un incidente. Los valores pasan por `valorParaMensaje`: varios vienen de quien llamó (`plan`, `estado`, `concepto`) y un salto de línea ahí parte la línea del log en dos. Tres pruebas unitarias sobre la función pura, y corregidas las cabeceras de `error-de-dominio.ts` y `nucleo.ts`, que llevaban prometiendo un log que no existía |
| 3 🟠 | **`.strict()` abrió en la otra puerta el eco que `valorParaMensaje` acababa de cerrar.** El mensaje de Zod para `unrecognized_keys` lleva los NOMBRES de las claves verbatim, y desde la etapa 2 ese texto sale al cliente: un `?<clave de 300 caracteres>=1` volvía entero en el cuerpo del 400 | Un `.strict()` con una clave de 300 caracteres da un `issue.message` de **329** caracteres que empieza por `Unrecognized keys: "uuuu…` | `textoDelProblema` trata `unrecognized_keys` como caso propio: mensaje en español (`sobran parametros (2): utm_source, gclid`), solo las **tres** primeras claves, y cada una por `valorParaMensaje`. Tres pruebas unitarias: que nombra y cuenta, que **no** devuelve la clave larga, y que limpia un carácter de control dentro de una clave —que el pipe no revisa, porque solo mira los valores— |
| 4 🟠 | **`docs/apis/app-cliente.md` afirmaba que «todos» los esquemas de consulta son estrictos.** No lo son: cinco lecturas toman el parámetro suelto con `@Query('x')` y siguen ignorando las claves de más con 200. La deuda estaba anotada en esta ficha y **negada** en el documento que lee quien integra | Buscar `@Query(` en los controladores: seis líneas sin `EsquemaPipe`, en cinco rutas | El contrato dice ahora qué es estricto (los ocho `CONSULTA_*`, enumerados) y **nombra las cinco rutas que no lo son**, con su fecha de cierre (P16-B). Una afirmación falsa menos en el documento de integración |

**Ninguna incidencia nueva.** El hallazgo 1 es **INC-007 otra vez** —una verificación verde que no
mide lo que su título afirma—, ahora dentro de una prueba escrita en esta misma etapa; no se sube el
contador por segunda vez en el mismo paquete que ya lo subió a 11, pero la lección se aplicó donde
tocaba: **la prueba nueva se vio en rojo antes de darla por buena**. Los hallazgos 2 y 4 son
comentarios que dejaron de avisar, que es exactamente el defecto que esta etapa persiguió en
`recetas.dto.ts`.

### Decisiones de la revisión

| # | Decisión |
|---|---|
| D-16.85 | **El 4xx de dominio deja rastro en el log, en nivel `debug`.** Se descartó rebajar la frase de `error-de-dominio.ts` y aceptar la pérdida: el campo ya existía, la promesa llevaba desde P0 escrita, y cumplirla costó una función pura de cuatro líneas. No sube a `warn`: un 4xx es lo normal en una API pública y llenaría el log de operación de ruido que no es un incidente |
| D-16.86 | **El mensaje de las claves sobrantes se escribe aquí y no se hereda de Zod.** El de la librería es texto en inglés dentro de un mensaje en español y, sobre todo, un eco sin recorte de lo que llegó por el cable. Se nombran tres claves y se dice cuántas eran: suficiente para corregir la URL, insuficiente como amplificador |
| D-16.87 | **La prueba que discrimina se escribe con `toBe` sobre la lista entera**, no con un `not.toContain`. Comprobar que `x-inventado` no está pasaría también si la lista fuera `Content-Type` a secas —o sea, con `X-CSRF-Token` fuera y todas las mutaciones rotas desde el navegador—. La lista es un contrato de dos elementos: se clava entera |

---

## Cómo probar manualmente lo construido

```bash
# 1. Los tres errores: 400 y no 500
curl -si 'http://localhost:3000/costeo/no-soy-uuid?locationId=<uuid>' -b 'sesion=<token>'
#    -> 400 {"code":"ENTRADA_INVALIDA","message":"\"no-soy-uuid\" no es un ProductId valido..."}

curl -si -X POST http://localhost:3000/catalogo/items -b 'sesion=<token>' \
  -H 'content-type: application/json' -H 'X-CSRF-Token: <csrf>' \
  -d '{"nombre":"Harina","tipo":"COMPRADO","unidadDeUso":"KG","rendimiento":"1","grupoId":null,"confianzaDePrecio":"FACTURA","llevaStock":null}'
#    -> 400 ENTRADA_INVALIDA, y el mensaje sugiere "kg", "lt", "unid"

# 2. Un mes sin abrir: 404 con SU codigo
curl -si 'http://localhost:3000/analitica/resumen?locationId=<uuid>&anio=2001&mes=1' -b 'sesion=<token>'
#    -> 404 {"code":"PERIODO_SIN_DATOS",...}

# 3. Un parametro de mas ya no se descarta
curl -si 'http://localhost:3000/analitica/resumen?locationId=<uuid>&anio=2026&mes=3&utm_source=x' -b 'sesion=<token>'
#    -> 400 ENTRADA_INVALIDA  (antes: 200)

# 4. CORS: el preflight de un DELETE. Necesita CORS_ORIGENES con algo dentro.
curl -si -X OPTIONS http://localhost:3000/usuarios/roles \
  -H 'Origin: http://localhost:3001' \
  -H 'Access-Control-Request-Method: DELETE' \
  -H 'Access-Control-Request-Headers: x-csrf-token'
#    -> 204 con Access-Control-Allow-Methods: ...,DELETE
#            Access-Control-Allow-Headers: Content-Type,x-csrf-token
#            Access-Control-Expose-Headers: x-correlation-id,Retry-After
#            Access-Control-Max-Age: 600
# Con `Origin: https://otro-sitio.test` NO sale Access-Control-Allow-Origin.

# 5. El nombre del producto
curl -s 'http://localhost:3000/analitica/ventas?locationId=<uuid>&anio=2026&mes=3' -b 'sesion=<token>'
#    -> [{"productId":"...","nombre":"Bolon de verde","unidades":"320"}]
```

## Evidencia de la etapa

```
npm run audit:types        OK
npm run audit:lint         OK
npm run audit:forbidden    OK — 45 reglas sobre 447 archivos
npm run audit:arch         OK — 360 modulos, 1574 dependencias, 0 violaciones
npm run audit:complexity   OK
npm run audit:duplication  OK — Found 0 clones
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS
npm run audit:deadcode     OK (knip: solo «configuration hints»)
npm run audit:secrets      OK
npm run audit:sec-headers  OK — 19 pruebas

test:unit          60 archivos, 852 pruebas, 0 fallos
test:integration   32 archivos, 437 pruebas, 5 omitidas, 0 fallos
```

**Tras la revisión de la etapa** (los cuatro hallazgos arreglados):

```
npm run audit:types        OK
npm run audit:lint         OK
npm run audit:forbidden    OK — 45 reglas sobre 447 archivos
npm run audit:arch         OK — 360 modulos, 1576 dependencias, 0 violaciones
npm run audit:complexity   OK
npm run audit:duplication  OK — Found 0 clones
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS
npm run audit:deadcode     OK (knip: solo «configuration hints»)

test:unit                       60 archivos, 858 pruebas, 0 fallos   (+6)
test:integration cors           8 pruebas, 0 fallos                  (+1)
test:integration frontera-http  18 pruebas, 0 fallos
test:integration autenticacion  36 pruebas, 0 fallos

# la prueba nueva de CORS, comprobada EN ROJO quitando `allowedHeaders`:
#   x no refleja una cabecera que nadie declaro: la lista es exacta
#     -> expected 'x-inventado' to be 'Content-Type,x-csrf-token'
#   y las otras 7 de la suite, VERDES: la ceguera que denuncia el hallazgo 1
```

**Sin migración en la revisión**, así que `migrate:deploy` / `migrate:verify` siguen siendo los de la
etapa 1.

**Sin migración en esta etapa**, así que `migrate:deploy` / `migrate:verify` no aplican: la última
sigue siendo la de la etapa 1 (`20260910202336_p16a2_csrf`), verificada allí 4/4.

## Incidencias registradas en esta etapa

Ninguna nueva. Se aplicó **INC-016** (`docker stop costeo-api` antes de la suite de integración,
`docker start` al terminar).

---

# Etapa 3 — las lecturas de catálogo que faltaban, y sus arreglos

**Inicio:** 2026-09-10 · **Estado:** ✅ construida

> Lo que el plan pide en su línea (`PLAN.md:149`) para esta etapa: `GET /catalogo/unidades`,
> `GET /catalogo/items/:id`, `GET /catalogo/articulos/:id`, `CrearItem` valida unidad, `P2002` → 409,
> `PUT /catalogo/articulos/:id`, `PUT /catalogo/grupos/:id`, doc al día. **Los dos `PUT` ya estaban**
> (P16-A1, D-16.45): no se rehicieron. **Sin migración**: nada de aquí toca el esquema, y por eso M11
> no obliga a nada — aun así `guardas-de-dominio.md` gana dos filas, que se explican abajo.

## Plan de la etapa

### Hallazgos de la lectura que cambiaron el diseño

| Hallazgo | Consecuencia |
|---|---|
| La persistencia ya estaba entera: `unidades()`, `buscarItem`, `buscarArticulo` y `buscarGrupo` existen y están probados | Las tres rutas nuevas **no tocan el repositorio para leer**. Lo único que se añadió allí fue `listarUnidades`, y por la razón de abajo |
| `unidades()` devuelve `factorABase`, que es un `Ratio`, y **no** devuelve `unit.name` | Justo al revés de lo que una pantalla necesita. Publicar el `Ratio` expondría el interior del tipo decimal (ADR-003); meter el nombre en `UnidadDelCatalogo` metería presentación en el único tipo del módulo que corre con la base apagada. Se separan las dos lecturas |
| `ItemsController` ya tenía **3** dependencias y `GestionDeArticulos` también | Una cuarta rompe `max-params`. Hizo falta un `GestionDeItems` y un controlador propio para las unidades — que además es lo correcto, ver abajo |
| Etapa 2 ya convirtió `IdentificadorInvalidoError` y `UnidadDeUsoInvalidaError` en 400 | Las fichas nuevas nacen con el `:id` mal formado dando **400** sin escribir una línea, y el «`"KG"` es 400» de esta etapa salió gratis. Lo que quedaba era lo que la FORMA no ve |
| `CrearItemsEnLote` **prometía en su cabecera** un `catch` de duplicado «como respaldo» | No existía. La carrera entre la lectura de nombres y el `createMany` era un 500 |
| El lote de ARTÍCULOS no comprobaba los nombres de artículo en absoluto | Reimportar el mismo archivo era un 500 **determinista**, no una carrera |
| El mismo «esta unidad no está en el catálogo» estaba escrito **tres veces**, con tres mensajes | Y solo uno enumeraba las válidas, que es el dato que sirve. Se unifica en dominio |

---

## Qué se construyó

### 1. `GET /catalogo/unidades`

Devuelve `{ codigo, nombre, dimension }` de las diez unidades. **Y nada más**: el `factorABase` no sale.

**Por qué son dos lecturas del mismo `unit` y no una.** `unidades()` es la lectura del **dominio**: lleva
`factorABase` porque `factorDeConversion` multiplica con él, y no lleva nombre porque un nombre no
entra en ningún cálculo. `listarUnidades()` es la lectura que se **publica**: lleva el nombre, porque
un desplegable de `g / kg / mg / lb / oz…` sin «gramo» al lado es peor que el campo libre que venía a
sustituir, y no lleva el factor, porque un `Ratio` serializado es el interior del tipo decimal saliendo
por el cable — exactamente lo que ADR-003 prohíbe. Son dos proyecciones con dos propósitos, no una
duplicación: el precio de fundirlas habría sido meter presentación en `UnidadDelCatalogo`, que es el
tipo con el que corre el único trozo del módulo que se prueba con la base apagada.

**Ordenadas por dimensión y dentro por tamaño** —`mg, g, oz, lb, kg`—, no alfabéticamente: así la
lista se lee como una escala. Hay una prueba que lo fija, porque es la clase de detalle que alguien
«simplifica» a un `orderBy: code` sin notar lo que se pierde.

**Controlador propio (`UnidadesController`) y no una ruta más.** La razón de forma es que
`ArticulosController` ya iba lleno; la de fondo, que decide, es que **esto no es un recurso del
tenant**: las demás rutas del catálogo leen filas de una company, y esta lee una tabla global que
ninguna company puede cambiar y que la aplicación no puede escribir (`REVOKE INSERT` desde P2). Tenerlo
en un archivo aparte, con eso escrito en la cabecera, es lo que evita que alguien le cuelgue un `POST`
sin darse cuenta de lo que está tocando.

### 2. Las dos fichas

`GET /catalogo/items/:id` devuelve el ítem, **su grupo entero** —con el nombre y la `ivaTarifa`, que es
la que heredan sus compras sin artículo (D-16.9)— y **sus artículos**. `GET /catalogo/articulos/:id`
devuelve el artículo con **su ítem dentro**.

**La ficha del ítem es un superconjunto de la fila de la lista.** `grupoId` sigue estando además de
`grupo`, a propósito: así el cliente usa el mismo tipo en la lista y en la ficha en vez de dos que
divergen.

**IDOR: la pertenencia va en la consulta, no en un `if` posterior.** Las cuatro lecturas que componen
las dos fichas llevan `companyId` en su WHERE. La diferencia con filtrar después no es de estilo: un
`if` se olvida al añadir la quinta lectura, y un WHERE no. Y un recurso ajeno da **404 con el mismo
texto** que uno inventado — hay una prueba que compara los dos mensajes carácter a carácter, porque
«existe pero no es tuyo» convierte la ruta en un oráculo para averiguar el catálogo del vecino.

**Nada de esto es confidencial frente a `BODEGA` (CLAUDE.md §4.3), y se comprueba.** Lo que esa lista
protege son las líneas de receta y todo lo que permite despejarlas; un ítem con su unidad y su
rendimiento no es ninguna de las dos cosas, y `BODEGA` ya los lee en las listas desde P2 porque los
necesita para contar inventario. Las fichas **no publican ni un campo nuevo**: componen lo que ya
salía por separado. Las dos pruebas de §4.3 lo verifican sobre el **cuerpo crudo**, no sobre lo que
la pantalla pinte.

> **Sobre el «403 del rol que no puede»: no existe, y es deliberado.** Los cinco roles
> —`OWNER`, `ADMIN`, `GERENTE_LOCAL`, `BODEGA`, `LECTURA`— tienen `catalog.read` desde P2. Ninguna
> lectura del catálogo devuelve 403 a nadie autenticado, y estas tres no son la excepción. Lo que sí
> se prueba es el otro lado: `GERENTE_LOCAL` lee y **no escribe** (ya estaba), y sin sesión el catálogo
> global tampoco se lee, aunque la tabla no tenga tenant.

### 3. `CrearItem` comprueba que la unidad EXISTA

Es INC-012 en el alta suelta. `unidadDeUso()` valida la **forma** —minúsculas, corta, sin espacios— y
por eso deja pasar `"l"`, que está perfectamente formado y no existe: el litro es `lt`. Esa fila
llegaba al `INSERT` y moría en `item_unit_of_use_fkey`, un mensaje que no dice ni qué columna ni
cuáles son las buenas. El lote lo comprobaba **desde P14b**, donde apareció cargando un catálogo de
verdad; el alta suelta, no.

Ahora es **400 `ENTRADA_INVALIDA`** con las diez válidas enumeradas en el mensaje. La clave foránea
sigue siendo la garantía; esto es la explicación.

**La comprobación estaba escrita tres veces y ahora está una**, en
`catalog/domain/catalogo-de-unidades.ts` (dominio puro, con su `.spec.ts` al lado): `buscarUnidad`,
`mensajeDeUnidadDesconocida` y `exigirUnidad`. Los cuatro llamantes —el alta de ítem, el alta de
artículo y los dos lotes— usan ahora **el mismo mensaje**, que es el bueno: el que enumera las
válidas. Antes, dos de los tres decían solo «no está en el catálogo» y quien lo leía tenía que
adivinar cuál sí.

### 4. `P2002` → 409: las tres escrituras que quedaban

El patrón ya existía en dos formas —`esDuplicado` en los `create`, `intentarCambio` en los
`updateMany`— y tres escrituras se lo saltaban:

| Escritura | Qué pasaba | Qué pasa |
|---|---|---|
| `actualizarItem` | Renombrar un ítem a un nombre ocupado: **500**. Era la única de las tres `actualizar*` que no pasaba por `intentarCambio` | `ResultadoDeCambio` como sus hermanas → **409** `CONFLICTO`, «Ya existe un ítem con ese nombre.» |
| `crearArticulosEnLote` | Reimportar el mismo archivo de artículos: **500 determinista**. No miraba los nombres de artículo en absoluto | Pre-chequeo como el de ítems → **409** con la lista de los que sobran |
| Los dos lotes, en carrera | Entre la lectura de nombres y el `createMany` cabe otra transacción. La cabecera de `crearItemsEnLote` prometía un `catch` que **no existía** | `aPruebaDeChoques` lo captura y **relee fuera** |

**Por qué el rescate relee fuera y no dentro.** En PostgreSQL un error aborta la transacción: después
del `P2002` ninguna consulta más corre dentro de ella, así que no se puede preguntar allí mismo qué
nombres chocaron. Por eso el `try` envuelve la llamada entera —no el `createMany`— y la relectura abre
una transacción nueva. El precio es una consulta de más, y solo en el camino que antes era un 500.
**Y si la relectura no encuentra ninguno, el error original se vuelve a lanzar**: ese `P2002` no era
de estos nombres, y un «estos ya existen: » con la lista vacía manda a buscar donde no hay nada, que
es peor que el 500 honesto.

**`ResultadoDeLoteDeArticulos` es un tipo nuevo del puerto del catálogo, no una variante de
`ResultadoDeLote`.** Ese tipo lo comparten cuatro módulos; añadirle `articulos_en_uso` obligaría a
`pricing`, `recipes` e `inventory` a tratar un caso que en ellos no puede ocurrir, y una rama muerta
que el compilador exige se lee como si pudiera pasar. Hacía falta un nombre distinto porque en ese
método `nombres_en_uso` significa, heredado, lo contrario: «estos **ítems** no existen».

**La prueba que no es obvia y sin la cual las demás no valen:** *un nombre que solo usa otra company no
da 409*. El índice es `(company_id, name)`, no `(name)` — sin esa prueba, «renombrar da 409» pasaría
también con el aislamiento roto.

---

## Decisiones de la etapa

| # | Decisión |
|---|---|
| D-16.88 | **`GET /catalogo/unidades` publica `{ codigo, nombre, dimension }` y no el factor a base.** Hay dos lecturas de `unit` —`unidades()` para el dominio, `listarUnidades()` para el borde— porque las dos cosas que cada consumidor necesita son disjuntas: el factor es para multiplicar y el nombre es para enseñar. Fundirlas habría metido presentación en `UnidadDelCatalogo`, que es dominio puro |
| D-16.89 | **Las unidades van en su propio controlador.** No es un recurso del tenant: es una tabla global y de solo lectura para la aplicación. La razón de `max-params` habría bastado, pero la de fondo es la que se escribe en la cabecera |
| D-16.90 | **La ficha del ítem trae el grupo entero y los artículos; la del artículo trae el ítem entero.** Una llamada por pantalla, y la ficha es un superconjunto de la fila de la lista (`grupoId` se queda junto a `grupo`) para que el cliente no necesite dos tipos |
| D-16.91 | **Un recurso de otra company es 404 con el mismo texto que uno inventado**, y hay una prueba que compara los dos mensajes. La pertenencia va en el WHERE de cada lectura, nunca en un `if` posterior |
| D-16.92 | **La comprobación de «esa unidad existe» se unifica en `catalog/domain/catalogo-de-unidades.ts`** y los cuatro llamantes comparten el mensaje que enumera las válidas. Antes había tres versiones y solo una servía para corregir |
| D-16.93 | **`ResultadoDeLoteDeArticulos` vive en el puerto del catálogo**, no como variante del `ResultadoDeLote` compartido: los otros tres módulos que reciben lotes no pueden toparse con ese caso |
| D-16.94 | **El rescate de un `P2002` de lote relee en una transacción NUEVA.** No es una preferencia: la transacción que falló está abortada y dentro de ella ya no corre ninguna consulta |
| D-16.95 | **Las tres rutas nuevas no llevan prueba de 403 porque no existe tal rol.** Los cinco roles tienen `catalog.read`. Lo que se prueba en su lugar es que sin sesión no hay lectura y que `GERENTE_LOCAL` sigue sin poder escribir |

---

## Consultas del camino crítico

- **`GET /catalogo/unidades`**: un `SELECT` de diez filas sobre una tabla sin tenant. Es la lectura más
  barata del sistema y **quita** trabajo: la pantalla que la usa deja de mandar unidades inventadas.
- **`GET /catalogo/items/:id`**: tres lecturas, dos de ellas en `Promise.all` (el grupo y los
  artículos), todas por índice y todas con `company_id`. El grupo solo se pide si el ítem tiene uno.
- **`GET /catalogo/articulos/:id`**: dos lecturas por clave primaria.
- **`CrearItem`** paga ahora **una lectura más**: las diez unidades, sin tenant, solo en el alta. A
  cambio, un 500 menos.
- Las dos escrituras de lote **no pagan nada en el camino normal** (el pre-chequeo de artículos es una
  lectura que el lote de ítems ya hacía); la relectura del rescate solo ocurre donde antes había un 500.

---

## Pruebas

**Unitarias:** **6 nuevas** en `catalog/domain/catalogo-de-unidades.spec.ts`, con la base apagada: que
`buscarUnidad` devuelve `null` y no lanza —es lo que permite recoger todas las filas malas de un
lote—, que el mensaje **ordena y enumera** las válidas, y que `"l"`, bien formado e inexistente, es
`EntradaDeCatalogoInvalidaError` y no una clave foránea seis capas más abajo.

**Integración:** **19 nuevas**, todas en `catalogo.spec.ts` (una sola app de Nest por archivo). La
siembra del tenant gana un tercer usuario, `BODEGA`, que hacía falta para las dos pruebas de §4.3.

| 🔴 | Prueba |
|---|---|
| 🔴 | `GET /catalogo/unidades` devuelve las diez, con nombre y dimensión |
| 🔴 | …y **no** publica el factor a base: se comprueban las claves exactas de cada fila |
| 🟠 | …y las ordena por tamaño dentro de su dimensión (`mg, g, oz, lb, kg`) |
| 🔴 | `BODEGA` las lee |
| 🔴 | Sin sesión no se leen, aunque la tabla sea global |
| 🔴 | La ficha del ítem trae el grupo con su tarifa y sus artículos |
| 🟠 | Un ítem sin grupo trae `grupo: null` y `articulos: []` |
| 🔴 | **El ítem de otra company es 404 con el MISMO mensaje que uno inventado** |
| 🔴 | Un `:id` que no es UUID es 400, no 500 |
| 🔴 | **§4.3 — `BODEGA` lee la ficha del ítem y el cuerpo crudo no trae nada de la receta** |
| 🔴 | La ficha del artículo trae su tarifa y su ítem dentro |
| 🔴 | El artículo de otra company es 404, no 403 |
| 🔴 | **§4.3 — `BODEGA` sobre la ficha del artículo, sobre el cuerpo crudo** |
| 🔴 | `"l"` es 400 y el mensaje enumera las diez válidas |
| 🔴 | `"KG"` también es 400 (esa la corta la forma) |
| 🔴 | …y `"lt"` sigue pasando: la guarda no cierra la puerta buena |
| 🔴 | Renombrar un ítem a un nombre ocupado es **409, no un 500 del índice único** |
| 🔴 | **Un nombre que solo usa otra company NO da 409** — el índice es `(company_id, name)` |
| 🟠 | Renombrar un artículo sigue siendo 409 (regresión de P16-A1) |

**Y las que la revisión encontró que faltaban** (corrección de la etapa, abajo): **5 unitarias** en
`shared/infrastructure/persistence/rescate-de-choque.spec.ts` —las tres ramas del rescate de la
carrera, con la base apagada— y **3 de integración** en `importacion.spec.ts`:

| 🔴 | Prueba |
|---|---|
| 🔴 | **Reimportar el mismo `ARTICULOS` es `CONFLICTO` y nombra el artículo repetido**, no un 500 del índice único |
| 🔴 | …y **no deja ni una fila escrita** (se cuenta `purchase_article` antes y después) |
| 🟠 | El mismo nombre con **otra caja** también se para, y el mensaje explica que el choque ignora mayúsculas |

**Por qué la prueba de la unidad buena está al lado de las dos malas.** Un 400 solo significa algo si
la misma petición con la unidad correcta no lo da; si no, la prueba mediría que el alta está rota.
Es la misma lección que la etapa 2 aplicó a `.strict()`.

---

## Problemas encontrados y cómo se resolvieron

| Problema | Cómo se vio | Solución |
|---|---|---|
| Al partir `crearItemsEnLote` en «envoltorio + escritura», los dos envoltorios quedaban casi idénticos | Riesgo de clon de `jscpd`, que no admite ninguno ≥ 50 tokens | Un solo `aPruebaDeChoques` genérico, parametrizado por el lector de nombres y por cómo se construye la unión. Salió **0 clones**, y de paso la lógica del rescate está escrita una vez |
| `CrearItem` y `ActualizarItem` quedaron registrados dos veces en el módulo | Tras meterlos en `GestionDeItems`, sus proveedores sueltos ya no los inyectaba nadie | Se quitaron, como ya estaba hecho con `CrearGrupo` y `ActualizarGrupo`. `ListarItems` se queda: lo exporta el módulo |

**Ninguna incidencia nueva.** Lo que esta etapa cierra es la **tercera cara de INC-012** (la primera
fue el `CHECK`, la segunda el trigger, esta la clave foránea y el índice único), y la ficha de esa
incidencia ya predica la regla que se aplicó: la base garantiza, el dominio explica.

> **Corregido tras la revisión:** la etapa decía esto y **no subió el contador** de la ficha, que
> seguía en 2. Está en **3**, con su sección propia — y como tres recurrencias obligan a hacer la
> prevención, la prevención se hizo: las pruebas que faltaban y la regla nueva de
> `guardas-de-dominio.md`. El detalle, en «Lo que encontró la revisión de la etapa 3».

### Lo que encontró la revisión de la etapa 3, y qué se hizo con cada cosa

Cinco hallazgos. **Los cinco reales** —los cinco se reprodujeron antes de tocar nada— y ninguno era
un fallo de comportamiento: el código hacía lo que la etapa decía. Lo que faltaba era **lo que impide
que deje de hacerlo**: las pruebas de dos caminos 🔴, la medida de las dos pruebas de §4.3, y tres
cifras de evidencia que no reproducían.

| # | Hallazgo | Verificación | Qué se hizo |
|---|---|---|---|
| 1 🔴 | **El 409 de reimportar `ARTICULOS` y el rescate de la carrera no tenían NI UNA prueba.** `crearArticulosEnLote` solo lo consume el importador y `importacion.spec.ts` no se tocó en la etapa; `aPruebaDeChoques` tenía tres ramas y cero cobertura. Y `guardas-de-dominio.md` marca esos índices únicos como 🔴, cuyo contrato es «la guarda **y** la prueba de que devuelve 4xx» | `grep -rn "articulos_en_uso" apps/api/test/` → sin resultados. El comportamiento sí funcionaba, comprobado a mano | **Tres pruebas de integración** en `importacion.spec.ts` —el mismo archivo otra vez es `CONFLICTO` y nombra el artículo, **no deja ni una fila escrita**, y el caso de las mayúsculas— y **cinco unitarias** del rescate, que para poder existir **salió del repositorio** a `shared/infrastructure/persistence/rescate-de-choque.ts` (D-16.96). Verificadas en rojo por partida doble: apagando solo el pre-chequeo, las dos primeras **siguen verdes** —es el rescate de la carrera trabajando contra PostgreSQL de verdad— y apagando también el rescate, las tres fallan enseñando `Unique constraint failed on the constraint: purchase_article_company_id_name_key` con `"code": "P2002"` |
| 2 🟠 | **Falso 409 por diferencia de mayúsculas, y un mensaje que afirmaba algo falso.** El pre-chequeo compara con `clavePorNombre` (sin caja, sin espacios) y el índice único compara byte a byte: «AZUCAR YA 2KG» se rechazaba diciendo «ya existe en tu company» cuando lo que hay es «Azucar Ya 2kg», y antes de P16-A2 esa fila **se escribía** | Reproducido al revés: con el pre-chequeo desactivado ese mismo archivo **entra** —la base no ve choque— y la prueba nueva del caso se pone en rojo | **El criterio se mantiene** (D-16.97) y **el mensaje deja de mentir**: «… ya existen en tu company (los nombres se comparan sin distinguir mayúsculas ni espacios de sobra): …», en los dos lotes del catálogo. Queda escrito donde lo lee quien importa —`docs/runbooks/puesta-en-marcha.md`, tabla de errores del archivo real— y en la fila de `guardas-de-dominio.md`, con una prueba que lo fija |
| 3 🟠 | **Las dos 🔴 de §4.3 eran del molde que INC-007 denuncia: no podían fallar.** Buscar `receta`, `costo`, `margen`… como substring del JSON es verdadero por construcción del tipo: ningún campo de `ItemLeido`/`GrupoLeido`/`ArticuloLeido` puede contener esas cadenas. Y solo afirmaban ausencias: un cuerpo `{}` también pasaba | Leer los tres tipos del puerto al lado de la lista de prohibidos | Ahora **miden**: las claves EXACTAS de los tres niveles de cada ficha (`toEqual` sobre `Object.keys().sort()`) y **el cuerpo de `BODEGA` idéntico al de `ADMIN`**, que atrapa el fallo contrario —la proyección mutilada—. La lista de substrings se queda como alarma barata, con una cabecera que dice qué NO mide. **Verificadas en rojo**: con un `stockTeorico` de mentira en la ficha del ítem, `expected [ 'articulos', …(11) ] to deeply equal [ 'articulos', …(10) ]` con `+ "stockTeorico"`; con un `puntoDeReorden` en la del artículo, lo mismo. Ninguno de los dos nombres contiene ninguno de los seis substrings: la prueba vieja los habría dejado pasar |
| 4 🟠 | **El bloque de evidencia de la etapa no reproducía.** 456 archivos, 369 módulos y 870 unitarias, cuando el mismo árbol daba 453, 366 y 864 | Los tres comandos, otra vez, sin tocar nada | Reescrito con la salida real y con una nota que dice qué pasó. Las cifras de integración sí cuadraban y se conservan |
| 5 🟠 | **La etapa declara cerrar «la tercera cara de INC-012» y no subió el contador de la ficha**, que seguía en 2 — justo el umbral que según CLAUDE.md §8.3 obliga a hacer la prevención | `git status docs/incidencias/` no listaba INC-012 | Contador a **3** en la ficha y en el índice, con una sección «Tercera recurrencia» que nombra las dos restricciones nuevas. La prevención que el umbral obliga son las pruebas del hallazgo 1 más la regla nueva de `guardas-de-dominio.md`: **cada fila 🔴 cita el archivo de prueba** que comprueba su 4xx, no solo la guarda, y se dice explícitamente que una clave foránea o un índice único son 🔴 aunque M11 no pueda vigilarlos. Lo que **no** se hizo —automatizar «toda fila 🔴 cita una prueba»— queda anotado con su motivo en la ficha: exige reescribir las 45 filas 🔴 del documento |

**Ninguna incidencia nueva.** Los hallazgos 3 y 4 son **INC-007** otra vez, en sus dos caras: una
prueba que afirma más de lo que mide y un contador de evidencia que no se puede reproducir. No se
sube su contador por tercera vez en el mismo paquete —ya está en 11 por esta pasada—, pero sí se
aplicó la disciplina que su ficha pide: **las cuatro pruebas tocadas se vieron en rojo antes de darlas
por buenas**, y la salida de ese rojo está arriba. El hallazgo 5 sí sube el de INC-012, a 3.

### Decisiones de la revisión

| # | Decisión |
|---|---|
| D-16.96 | **El rescate del `P2002` de lote vive en `shared/infrastructure/persistence/rescate-de-choque.ts`, no dentro del repositorio.** Sus tres ramas no se pueden provocar a voluntad contra PostgreSQL —la carrera es, por definición, lo que no ocurre cuando uno mira—, y un camino que solo se recorre en un fallo raro es justo el que hay que poder probar barato. Fuera del repositorio no toca Prisma y se prueba con la base apagada. De paso, `esViolacionDeUnico` sustituye al `esDuplicado` local del catálogo: una definición menos del literal `P2002` |
| D-16.97 | **El choque de nombres de los lotes sigue ignorando mayúsculas y espacios de sobra, y el mensaje lo dice.** Las dos alternativas se descartaron con su motivo: comparar byte a byte como el índice rompería la coherencia con la deduplicación **dentro** del archivo —que ya usa `clavePorNombre`— y dejaría entrar dos filas que son la misma cosa escrita dos veces; y llevar la garantía a la base con un índice único sobre `lower(btrim(name))` es una migración que puede chocar con datos ya escritos en los tenants existentes, y eso no cabe en la corrección de una revisión. Si algún día se hace, el mensaje ya será cierto en los dos sentidos |
| D-16.98 | **Una prueba de §4.3 fija las claves exactas y compara con el rol que lo ve todo.** Una lista de nombres prohibidos solo puede crecer por detrás de los campos; un `toEqual` de claves obliga a decidir sobre **cualquier** campo nuevo el día que aparece, que es cuando la decisión es barata. La comparación con `ADMIN` cubre el otro lado: que la proyección no se haya quedado corta |
| D-16.99 | **Cada fila 🔴 de `guardas-de-dominio.md` cita, desde ahora, el archivo de prueba de su 4xx.** M11 solo alcanza a los `CHECK` y a los `RAISE`; las claves foráneas y los índices únicos no tienen dónde llevar el `-- GUARDA:` y por esa grieta entró la tercera recurrencia de INC-012. Las filas anteriores a P16-A2 se completan a medida que se tocan: reescribir las 45 de golpe es un paquete, no una corrección |

---

## Deuda y pendientes de la etapa

- **`GET /catalogo/items` y `GET /catalogo/articulos` siguen leyendo su parámetro con `@Query('x')`
  crudo**, así que un parámetro de más se sigue descartando en silencio. Es la deuda que la etapa 2
  dejó anotada para las cinco rutas, y estas dos son dos de ellas; se cierra en P16-B con el resto.
- **Los `@Param` del catálogo siguen sin `ParseUUIDPipe`.** Dan 400 desde la etapa 2, pero lo produce
  el constructor del tipo dentro del manejador. Misma deuda, mismo destino.
- **La ficha del ítem no trae sus precios.** El plan enumera tres llamadas para la pantalla 6
  (`/catalogo/items/:id`, los artículos —que ya vienen dentro— y `/precios/costos`), y los precios son
  de `pricing`: componerlos aquí sería que `catalog` leyera una tabla que no es suya.
- **El índice de ADR sigue saltando del 012 al 021**, heredado de P16-A1 y de las etapas 1 y 2.

---

## Cómo probar manualmente lo construido

```bash
# 1. Las unidades, para que nadie escriba "l"
curl -s 'http://localhost:3000/catalogo/unidades' -b 'sesion=<token>'
#    -> [{"codigo":"unid","nombre":"unidad","dimension":"CONTEO"}, ...]  sin factor

# 2. Y si aun asi lo escribe
curl -si -X POST http://localhost:3000/catalogo/items -b 'sesion=<token>' \
  -H 'content-type: application/json' -H 'X-CSRF-Token: <csrf>' \
  -d '{"nombre":"Leche","tipo":"COMPRADO","unidadDeUso":"l","rendimiento":"1","grupoId":null,"confianzaDePrecio":"FACTURA","llevaStock":null}'
#    -> 400 ENTRADA_INVALIDA  "La unidad "l" no esta en el catalogo. Las validas son: doc, g, gal, ..."

# 3. La ficha: el item, su grupo y sus articulos en una llamada
curl -s "http://localhost:3000/catalogo/items/$ITEM" -b 'sesion=<token>'

# 4. El mismo id, con la sesion de OTRA company -> 404, palabra por palabra igual
#    que con un uuid inventado
curl -si "http://localhost:3000/catalogo/items/$ITEM" -b 'sesion=<token-de-la-otra>'
#    -> 404 {"code":"RECURSO_NO_ENCONTRADO","message":"Ese item no existe en tu company."}

# 5. El 409 que era un 500: renombrar a un nombre ocupado
curl -si -X PUT "http://localhost:3000/catalogo/items/$OTRO" -b 'sesion=<token>' \
  -H 'content-type: application/json' -H 'X-CSRF-Token: <csrf>' \
  -d '{"nombre":"<un nombre que ya existe>","rendimiento":"1","grupoId":null,"confianzaDePrecio":"FACTURA","estado":"ACTIVE","llevaStock":null}'
#    -> 409 {"code":"CONFLICTO","message":"Ya existe un item con ese nombre."}

# 6. El lote de articulos, reimportado: antes 500, ahora 409 con la lista
npm run importar -- --archivo <el mismo CSV de ARTICULOS de antes>
```

---

## Evidencia de la etapa

> ⚠️ **Este bloque se reescribió en la corrección de la revisión.** Las tres primeras cifras que
> tenía —456 archivos, 369 módulos y 870 unitarias— **no reproducían**: sobre el mismo árbol daban
> 453, 366 y 864. Estaban extrapoladas, no medidas, y en un proyecto donde la evidencia escrita es
> lo que el auditor cree, una cifra que no se puede reproducir es INC-007 un nivel más arriba. Lo de
> abajo es la salida real de los comandos **después de la corrección**, que añade 2 archivos y 9
> pruebas más; entre paréntesis, lo que medía la etapa 3 antes de corregirse.

```
npm run audit:types        OK
npm run audit:lint         OK
npm run audit:forbidden    OK — 45 reglas sobre 455 archivos                (la etapa 3 sola: 453)
npm run audit:arch         OK — no dependency violations (368 modules, 1608 dependencies)   (366)
npm run audit:complexity   OK
npm run audit:duplication  OK — Found 0 clones
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS  (esta etapa no crea ninguna)
npm run audit:deadcode     OK

npm run test:unit          --workspace @costeo/api   62 archivos · 870 en verde
                                                     (la etapa 3 sola: 61 · 864; +6 suyas y +6 de la corrección)
npm run test:integration   --workspace @costeo/api   32 archivos · 460 en verde, 5 omitidas
                                                     (la etapa 3 sola: 457; +3 de la corrección)
npm run test:integration   -- catalogo               35 en verde   (eran 16 antes de la etapa 3)
npm run test:integration   -- importacion            10 en verde   (eran 7)
```

**Sin migración, así que no hay `migrate:deploy` ni `migrate:verify` que enseñar.**

## Incidencias registradas en esta etapa

Ninguna nueva. Se cierra la tercera cara de **INC-012** —la clave foránea y el índice único, después
del `CHECK` y del trigger— y queda recogida en `docs/sistema/guardas-de-dominio.md`, sección
`20260904162756_p2_catalogo`, con las dos filas nuevas.

**Su contador sube a 3** (ficha e índice), que es el umbral que CLAUDE.md §8.3 marca como «la
prevención no se hizo». La prevención que ese umbral obliga está escrita en la ficha: las pruebas de
4xx que faltaban para esos dos índices, y la regla de que **cada fila 🔴 de `guardas-de-dominio.md`
cite el archivo de prueba** que la comprueba — porque M11 no puede vigilar ni una clave foránea ni un
índice único, y por esa grieta entró esta tercera recurrencia.

---
---

# Cierre del paquete — lo construido, medido sobre el árbol entero

**Fecha:** 2026-09-10 · **Estado:** 🟡 construido, pendiente de auditoría final y commit.

Las tres etapas están arriba con su propia evidencia. Esta sección no las repite: mide el **árbol
completo** una vez cerradas las tres y sus revisiones, que es el único número que el commit puede
enseñar. Donde una cifra de etapa y esta difieran, **manda esta**: las de etapa se tomaron con el
paquete a medio construir.

## Lo que el paquete entrega, en una lista

| # | Qué | Dónde |
|---|---|---|
| 1 | Token anti-CSRF en toda mutación de los **dos** procesos, 403 `CSRF_INVALIDO` | `shared/infrastructure/http/csrf.ts` · `iam/…/csrf.guard.ts` · `backoffice/…/csrf-de-operador.guard.ts` |
| 2 | `GET /auth/sesion` → `{ userId, permisos, alcance, csrf }` | `iam/…/auth.controller.ts` |
| 3 | La API analiza solo `application/json` (cierra el *login CSRF*) | `bootstrap.ts` |
| 4 | Tres errores de borde → 400 `ENTRADA_INVALIDA`, con el valor recortado y limpio | `shared/domain/identity` · `shared/domain/unidad` · `shared/domain/decimal` · `shared/domain/errors/valor-en-mensaje.ts` |
| 5 | Todo 4xx de dominio deja su diagnóstico en el log (`debug`) | `shared/infrastructure/http/error.filter.ts` |
| 6 | `PERIODO_SIN_DATOS` — el segundo 404, con código propio | `analytics/domain/errores.ts` |
| 7 | `.strict()` en los **ocho** esquemas de consulta, con mensaje propio para las claves sobrantes | los cinco `*.dto.ts` · `shared/infrastructure/http/esquema.pipe.ts` |
| 8 | CORS: `DELETE`, cabeceras declaradas, expuestas y `maxAge` | `bootstrap.ts` |
| 9 | `nombre` del producto en ventas y en menu engineering | `analytics/application/casos-de-uso/` · `analitica.dto.ts` |
| 10 | `GET /catalogo/unidades` y las dos fichas del catálogo | `catalog/…/unidades.controller.ts` · `catalog/application/casos-de-uso/fichas.ts` |
| 11 | `CrearItem` exige que la unidad **exista**, con un mensaje compartido por los cuatro llamantes | `catalog/domain/catalogo-de-unidades.ts` |
| 12 | `P2002` → 409 en las tres escrituras que faltaban, con rescate de la carrera probado | `shared/infrastructure/persistence/rescate-de-choque.ts` |
| 13 | `X-CSRF-Token` en `redact`, derivado de la constante | `shared/infrastructure/observability/logger.options.ts` |
| 14 | Regla `403-de-integracion-sin-su-code` en `audit:forbidden` | `tools/audit/rules/repo.rules.mjs` |

Y en `apps/web`, **lo mínimo para no dejarlo roto**: `lib/csrf.ts` (nuevo), la cabecera y el
reintento único en `lib/api.ts`, el guardado al entrar y el borrado al salir, y los dos rodeos que
el `nombre` del producto dejó sin trabajo. **No se construyó ninguna pantalla nueva**: eso es el
armazón, y va después.

## Decisiones del paquete — D-16.65 … D-16.99

Treinta y cinco, registradas una a una en `ESTADO.md` → «Pasada P16 → P20». Por etapa: **65–72** y
**73–75** (etapa 1 y su revisión), **76–84** y **85–87** (etapa 2 y su revisión), **88–95** y
**96–99** (etapa 3 y su revisión). Las tres que más lejos llegan, porque cambian algo que vale para
todo el sistema y no solo para este paquete:

- **D-16.69** — `Origin`/`Referer` **no** se comprueba, con sus cuatro razones y su señal de
  reapertura. Está escrito en `docs/SEGURIDAD.md` §4.2 y en `docs/sistema/seguridad.md`, no solo en
  el ADR, porque es un apartamiento del estándar y el sitio donde se busca es el estándar.
- **D-16.74** — la API analiza **solo** `application/json`. Es una restricción global que hay que
  recordar el día que alguien quiera un `<form>` nativo.
- **D-16.99** — cada fila 🔴 de `guardas-de-dominio.md` cita desde ahora su archivo de prueba. Es la
  prevención que obliga la tercera recurrencia de INC-012.

## Números del árbol completo

```
npm run test:unit         --workspace @costeo/api    62 archivos · 870 pruebas · 0 fallos
npm run test:integration  --workspace @costeo/api    32 archivos · 460 en verde · 5 omitidas (465) · 177 s
```

Contra lo que cerró P16-A1 (**823** unitarias en 57 archivos; **400** de integración —395 en verde y
5 omitidas— en 30 archivos):

| | P16-A1 | P16-A2 | Δ |
|---|---|---|---|
| Unitarias | 823 (57 archivos) | **870** (62) | **+47**, +5 archivos |
| Integración (casos) | 400 (30 archivos) | **465** (32) | **+65**, +2 suites (`cors`, `frontera-http`) |
| Integración en verde | 395 | **460** | +65 · las 5 omitidas son las mismas de INC-016 |
| Reglas de `audit:forbidden` | 44 sobre 433 archivos | **45** sobre **455** | +1 regla, +22 archivos |
| Módulos de `audit:arch` | 351 · 1529 dependencias | **368** · **1608** | 0 violaciones en ambos |
| Migraciones | 15 | **16** | la de CSRF |
| Clones | 0 | **0** | |

Las **cinco archivos** de pruebas unitarias nuevos: `shared/infrastructure/http/csrf.spec.ts`,
`shared/domain/errors/valor-en-mensaje.spec.ts`,
`shared/infrastructure/observability/logger.options.spec.ts`,
`shared/infrastructure/persistence/rescate-de-choque.spec.ts` y
`catalog/domain/catalogo-de-unidades.spec.ts` — **los cinco corren con la base apagada**.

## Evidencia final, comando a comando

Con `costeo-api` parado (INC-016) y sobre el árbol exacto que se commitea:

```
npm run audit:types        EXIT 0
npm run audit:lint         EXIT 0
npm run audit:forbidden    OK — 45 reglas sobre 455 archivos                                   EXIT 0
npm run audit:arch         ✔ no dependency violations found (368 modules, 1608 dependencies)
                           OK — reglas de capa respetadas y guardian verificado                EXIT 0
npm run audit:complexity   EXIT 0
npm run audit:duplication  Found 0 clones.                                                     EXIT 0
npm run audit:migrations   OK — 16 migracion(es) reversibles y con RLS                         EXIT 0
npm run audit:deadcode     EXIT 0  (knip: solo «configuration hints»)
npm run audit:secrets      EXIT 0
npm run audit:deps         OK — sin vulnerabilidades altas fuera de las 4 aceptadas            EXIT 0
npm run audit:sec-headers  19 passed | 446 skipped (465)                                       EXIT 0

npm run migrate:deploy     16 migrations found · No pending migrations to apply.               EXIT 0
npm run migrate:verify     1/4 ida · 2/4 ida y vuelta · 3/4 up->down->up idempotente ·
                           4/4 sin deriva + toda tabla con ENABLE + FORCE RLS                  EXIT 0

npm run build --workspace @costeo/web                                                          EXIT 0
npm run medir-bundle       ok  126.9 KiB gzip  (piso, comun a todas)
                           ok  138.7 KiB gzip  /inventario  ·  138.7 KiB  /menu   (mayores)
                           presupuesto 200 / 350 KiB                                           EXIT 0
```

## `npm run bench` — se ejecutó, y el consolidado sigue donde lo dejó P16-A1

El paquete añade **una** consulta al camino de lectura (`listarProductos` en `GET /analitica/ventas`,
§Consultas de la etapa 2), así que I8 lo exige. Sobre base propia (`costeo_bench`, 200 productos,
14.000 líneas de receta, 219.000 movimientos), p95 de 30 corridas:

| Medición | P15 | P16-A1 (en reposo) | **P16-A2** | Límite |
|---|---|---|---|---|
| suelo del entorno (validar sesión) | 4,5 ms | 6,5 ms | **8,1 ms** | — |
| costeo de la carta (200 productos) | 75,3 | 89,6 | **120,9** ✅ | 400 |
| inventario valorizado (500 ítems) | 110,2 | 146,2 | **193,9** ✅ | 300 |
| **consolidado (10 ubicaciones)** | 677,5 | 940,9 | **944,0** ❌ | 800 |
| guardar una receta | 51,8 | 87,4 | **95,7** ✅ | 150 |

**No es regresión de este paquete, y se puede enseñar sin pedir que se crea:** el consolidado pasa de
940,9 a 944,0 ms —0,3 %, ruido— mientras el **suelo del entorno**, que es «validar sesión» y que este
paquete sí toca (una columna más en `session_lookup`), sube de 6,5 a 8,1 ms. Normalizado a ese suelo,
el consolidado cuesta hoy **116,5 «suelos»** frente a los **144,8** de P16-A1 y los **150,6** de P15:
relativamente, mejor que nunca. El resto de los presupuestos sube en la misma proporción que el
suelo y los tres siguen dentro.

**Y aun así el check tiene razón: 944 ms de 800 es rojo, y el umbral no se sube** (AUDITORIA.md I8).
Es la misma deuda que P16-A1 dejó abierta —las vistas materializadas de períodos cerrados, diseñadas
en ADR-012 §7— y sigue siendo **decisión del usuario**, anotada como duda abierta en `ESTADO.md` con
estos números. Se repite lo que P16-A1 dijo en voz alta y sigue siendo verdad: **CI no ejecuta el
bench**.

## Lo que queda dicho, no escondido

- **`Origin`/`Referer` no se comprueba** (D-16.69), con su señal escrita en tres sitios.
- **Un volcado de `session` revela tokens CSRF vivos.** No habilitan nada sin la cookie, y el
  razonamiento está en ADR-021; no se extiende a los logs, donde la cabecera va en `redact`.
- **El despliegue de este paquete cierra todas las sesiones abiertas** (D-16.67). Se acepta: no hay
  piloto todavía.
- **Los 16 `@Param` siguen sin `ParseUUIDPipe`.** Dan 400 desde la etapa 2, pero el 400 lo produce el
  constructor del tipo **dentro** del manejador: la petición ya pasó guards y pipes. Cortarlo antes
  es estrictamente mejor y toca ocho controladores de seis módulos; va a P16-B/C, que ya los abre.
- **Las cinco lecturas con `@Query('x')` crudo no son `.strict()`**: `GET /precios`,
  `/precios/costo/:itemId`, `/catalogo/articulos`, `/catalogo/items` y
  `/recetas/propagacion/previsualizacion`. Están **nombradas una a una** en `docs/apis/app-cliente.md`
  para que nadie lea «todos los esquemas son estrictos» y lo dé por hecho. Se cierran en P16-B.
- **`GET /precios/costo/:itemId?fecha=basura` devuelve un 404 mentiroso** en vez de un 400:
  `new Date('basura')` da `Invalid Date` y toda comparación da `false`. No es un 500, así que no
  entraba aquí.
- **El back office conserva sus dos analizadores de cuerpo** (D-16.75), con su señal de reapertura.
- **`AccesoBloqueadoError` sigue sin `Retry-After`** — deuda de ADR-026, no de este paquete.
- **El índice de ADR salta del 012 al 021**: los ADR-013…019 existen en la carpeta y no tienen fila
  en `docs/decisiones/README.md`. Heredado de P16-A1; meterlo aquí mezclaría dos cosas en un commit.
- **El consolidado no cabe en su presupuesto**, arriba, con la demostración de que no es de aquí.
- **No se automatizó «toda fila 🔴 de `guardas-de-dominio.md` cita una prueba»** (D-16.99): exige
  reescribir las 45 filas anteriores, que es un paquete y no una corrección. Las filas se completan
  a medida que se tocan, y eso queda anotado en la ficha de INC-012.
