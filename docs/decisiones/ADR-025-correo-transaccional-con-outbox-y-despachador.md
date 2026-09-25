# ADR-025 — El correo transaccional: un outbox en la misma transacción, un despachador con rol propio, y el token que vive solo en vuelo

**Fecha:** 2026-09-10 · **Paquete:** P16-A1 · **Estado:** aceptada
**Cierra:** D-16.12, D-16.15, D-16.16, D-16.19, D-16.23, D-16.26, D-16.27, D-16.31, D-16.34, D-16.46, D-16.47, D-16.48; el «cualquier cuarta merece la misma discusión» que ADR-006 dejó escrito sobre las funciones `SECURITY DEFINER`

---

## Contexto

Hasta P16-A1 el sistema «enviaba» correo así: `InvitarUsuario` llamaba a `MailerPort.send()`
**después** de confirmar la transacción que creaba al invitado, y el adaptador real no existía
(`MAIL_ADAPTER=real` lanzaba). En producción el selector era `fake`: la invitación existía en la
memoria del proceso de la API y en ningún otro sitio. El aviso de bloqueo del login salía por el
mismo camino. Y no había restablecimiento de contraseña: quien la olvidaba no tenía forma de entrar.

La pasada P16 necesita tres cosas antes de la primera pantalla nueva: que una invitación **llegue**
a una bandeja real (evidencia 2 de la parada «entrega al piloto»), que se pueda reenviar, y que una
contraseña olvidada se pueda restablecer sin que nadie del equipo intervenga. Las tres mandan
correo, y las dos últimas escriben **sin sesión**.

Lo que manda por encima: CLAUDE.md §4.1 (ninguna escritura sin tenant efectivo, y el cliente de
base solo en la capa de transacción-con-tenant) y §4.3 (un token en claro vale una cuenta). El
usuario cerró D-16.12…D-16.34 en el plan; este ADR registra **cómo** se cumplen y qué se descartó.

---

## Decisión 1 — El outbox es transaccional: la API encola y no envía nada

`email_outbox` es una tabla más del tenant, y **se escribe dentro de la misma transacción** que
crea lo que el correo anuncia. `escribirEnOutbox(tx, …)` (`shared/infrastructure/persistence/outbox.ts`)
recibe el `tx` y no abre uno: `RepositorioDeOrganizacion.invitar()` inserta al invitado y su
correo en una sola `run(companyId)`; `password_reset_request` inserta el token y su correo en una
sola función. Si falla el `INSERT` del usuario no hay correo; si no se puede encolar, no hay
usuario. La prueba lo mide en las dos direcciones: con la dueña se cierra el outbox a invitaciones
(un `CHECK … NOT VALID` temporal) y `POST /usuarios` sale 500 **sin fila en `app_user`**.

`InvitarUsuario` ya no conoce `MailerPort`. Tampoco `IniciarSesion`: el aviso de bloqueo al quinto
fallo se encola como plantilla `BLOQUEO` bajo el tenant de la cuenta, sin enlace y con `datos = {}`.
Con esto la afirmación «la API solo encola» es verdad y no intención: `DependenciasDeIam` no
inyecta `MAILER_PORT`, y `SharedModule` lo sigue cableando únicamente porque el selector
`MAIL_ADAPTER` se honra en los dos procesos (ver Decisión 5).

**Por qué no un envío directo con reintento en memoria.** Una invitación que la base confirmó y
el proveedor no aceptó —caída, timeout, redespliegue en ese segundo— sería una cuenta `INVITED`
cuyo enlace nadie tiene, sin rastro de que faltó un correo. El outbox convierte «falló el envío» en
una fila `PENDIENTE` con su error, que el back office ve y el despachador reintenta.

---

## Decisión 2 — Un rol propio, en un proceso propio

Quien entrega es **`costeo_despachador`**: `NOBYPASSRLS`, `CONNECTION LIMIT 2`, `30s / 10s / 3s`,
creado por `roles.sql` en un cluster nuevo y por `npm run rol:despachador` en uno que ya existía
(la migración **falla en alto** si no está, como la de P11 con el rol del back office; por eso
`desplegar.sh` los crea en el paso 5/8, antes de migrar). Lo que ve lo ve por **dos políticas
permisivas sobre exactamente dos tablas**, y sus privilegios son los de sus cinco operaciones:

| Tabla | Privilegio | Para qué |
|---|---|---|
| `email_outbox` | `SELECT, UPDATE` | tomar, reservar, marcar. Sin `INSERT` (no crea correos) ni `DELETE` (un fallido es evidencia) |
| `rate_limit_hit` | `DELETE`, y `SELECT` **solo sobre la columna `at`** | purgar lo viejo sin poder leer una sola clave |
| todo lo demás | nada | `42501`, tabla por tabla, en `correo-despachador.spec.ts` |

Y corre en **un tercer binario**, `apps/api/src/despachador.ts` (servicio `correo` en compose,
misma imagen que `api` sin `build`, `command` propio, `restart: unless-stopped`, sin puertos, con
un latido en archivo como `healthcheck`). `AppModule` no importa `CorreoModule`, y tres cosas lo
hacen cumplir: cuatro reglas de `audit:forbidden` (`correo.rules.mjs`), dos de `dependency-cruiser`
(`correo-inalcanzable-desde-la-app`, `correo-no-entra-desde-otros-modulos`) y una prueba que
pregunta al contenedor de `AppModule` construido de verdad si tiene `DespachadorConnection`. El
esquema de entorno del despachador **no acepta `DATABASE_URL`** y verifica el rol de
`DESPACHADOR_DATABASE_URL` en el campo (INC-008).

### La alternativa que se descartó: el rol de la aplicación con bypass

Era la opción corta: una política permisiva sobre `email_outbox` para `costeo_app` y un
`setInterval` dentro de la API. Se descartó por dos razones que no son de estilo:

1. **Marcar y purgar son privilegios que la aplicación no debe tener.** `UPDATE` sobre la cola y
   `DELETE` sobre `rate_limit_hit` en el mismo contenedor de inyección que todos los controladores
   del cliente es un `@Inject` mal puesto de distancia de que un endpoint cierre correos o vacíe el
   límite de tasa. Es el mismo argumento de ADR-017 §1, y por eso la solución es la misma: otro
   proceso.
2. **`costeo_app` no puede ver la cola entera.** La política del outbox para la app es
   `company_id = current_company()`: la app encola bajo su tenant. Un despachador dentro de la API
   tendría que fijar cada tenant por turno —o saltarse RLS—, y cualquiera de las dos cosas rompe
   la Barrera 2 para una tarea que no tiene tenant.

También se descartó `BYPASSRLS` para el despachador (como el back office): con `NOBYPASSRLS`, una
tabla nueva sin política es invisible para él, que es el fallo silencioso *bueno* aquí — un
despachador no debe ver nada que no sea su cola. El back office necesita lo contrario, y por eso
son dos decisiones distintas con dos roles distintos.

---

## Decisión 3 — Dos funciones `SECURITY DEFINER` que escriben, y por qué son las únicas

ADR-006 dejó tres definer de solo lectura (`auth_lookup`, `session_lookup`, `invitation_lookup`) y
escribió que «cualquier cuarta merece la misma discusión». Esta es la discusión.

El restablecimiento ocurre **sin sesión**: quien lo pide no puede entrar, y por eso lo pide. No hay
tenant que fijar, así que la aplicación no puede escribir por su camino normal. Las opciones eran:

| Opción | Qué implica |
|---|---|
| (a) Política permisiva sin tenant para `costeo_app` sobre `password_reset_token` y `email_outbox` | Una tabla de tokens legible entera por la app: exactamente lo que un volcado bajo RCE se llevaría. Y el `company_id` del correo lo tendría que adivinar la app |
| **(b) Dos funciones con la forma exacta del hueco** | Entra un correo y sale nada; entra un hash y sale una fila o ninguna. Ninguna admite otro filtro que su clave |

Se eligió (b). Las dos son `VOLATILE SECURITY DEFINER SET search_path = pg_catalog, public`, con
`REVOKE EXECUTE FROM PUBLIC` y `GRANT` solo a `costeo_app`, y corren como `costeo_migrator`: por
eso cada tabla lleva su política `_migrator` (con `FORCE`, RLS aplica también a la dueña).

- **`password_reset_request(p_email, p_token_hash, p_expires_at, p_datos) RETURNS void`** busca el
  usuario **`ACTIVE`** por correo; con él, inserta el token y encola el correo con el `company_id`
  y `user_id` **que la propia función lee** —la aplicación no los sabe, y es lo que deja el correo
  atribuido a su tenant sin que nadie lo haya fijado—; sin él, no hace nada y devuelve igual.
- **`password_reset_consume(p_token_hash, p_ahora) RETURNS TABLE(user_id, company_id)`** marca
  `used_at` en un `UPDATE … RETURNING` solo si `used_at IS NULL AND expires_at > p_ahora`, y
  devuelve la fila si el usuario sigue `ACTIVE`. Devolver `company_id` no es comodidad: sin él no
  habría tenant con el que escribir la contraseña ni revocar las sesiones (D-16.47). Todo lo
  demás —leer el correo del usuario, la política de contraseñas, el hash, revocar **todas** las
  sesiones, auditar— lo hace la aplicación **por su camino normal**, bajo `run(companyId)`.

**Qué las acota.** `password_reset_token` no tiene política para `costeo_app` y tiene sus
privilegios revocados enteros: la app no puede leer, insertar ni enumerar tokens, ni con
`set_config`. Con `request` no se puede saber si un correo existe (misma respuesta), y con
`consume` no se puede probar un token sin gastarlo. Son las **únicas dos definer que escriben**, y
las cinco quedan inventariadas en `docs/sistema/seguridad.md`.

**El canal de tiempo de `/olvido` se reconoce, no se finge.** Con usuario, la función hace dos
`INSERT` más; sin usuario, solo el `SELECT`. Es un residuo de milisegundos. Escribir algo también
en el ramal vacío habría mezclado el limitador con la función y no lo cerraría del todo, así que se
asume: lo acota el límite de tasa (10/h por IP, 3/h por destinatario; ADR-026), que impide
muestrearlo, y una prueba exige que la diferencia de **medianas** entre ramales quede por debajo de
50 ms — la escala de un `INSERT`, nunca la de un Argon2id, que es lo que un cambio descuidado
metería en un solo ramal.

**El token se gasta antes de validar la contraseña.** Una contraseña débil obliga a pedir otro
enlace. La alternativa exigía una tercera definer de lectura sin consumo, o dejar vivo un token
contra el que ya se falló.

---

## Decisión 4 — El token en claro vive solo mientras el correo está en vuelo

El despachador necesita el enlace con el token para escribir el correo, así que `email_outbox.datos`
lo lleva **en claro** mientras la fila es `PENDIENTE`. Tres cosas lo acotan:

1. **Solo el despachador lee `datos`.** La migración revoca el `SELECT` de tabla a `costeo_app` y
   `costeo_backoffice` y lo concede **por columnas, todas menos `datos`**. Ni una aplicación
   comprometida que fije cualquier tenant con `set_config`, ni el back office con su `BYPASSRLS`,
   pueden leer un token en vuelo (`42501`, probado con los dos roles y control positivo). El
   `INSERT` de la app no necesita la columna porque `createMany` no emite `RETURNING`.
2. **Al cerrar el correo, `datos` se reemplaza por `{plantilla, destinatario}`** (`datosSaneados`,
   la única lista de lo que sobrevive) en la misma sentencia que lo marca `ENVIADO` o `FALLIDO`.
   El enlace deja de existir en la base cuando ya está en el buzón, o cuando no va a estarlo nunca.
   Un correo `PENDIENTE` para siempre sería un token en claro para siempre: por eso hay tope.
3. **Ninguna lectura devuelve `datos`**: ni `GET /correo/salud` (contadores e instantes, probado
   sobre la respuesta cruda) ni la salud por invitación que P16-C añadirá. Y ninguna de las tres
   rutas lo escribe en `audit_log`, comprobado leyendo el log con el rol del back office — con la
   dueña, que solo tiene política de `INSERT` sobre `audit_log`, un `count(*)` da 0 aunque el token
   esté dentro (INC-007).

### La alternativa que se descartó: cifrar el campo con una clave del despachador

`datos` cifrado con AES-256-GCM y la clave solo en el entorno del servicio `correo` cerraría el
punto 1 también frente a un **volcado de la base**: hoy, quien tenga la copia entera (el
superusuario, un respaldo descifrado) lee los tokens en vuelo de ese instante. Se descartó **por
ahora**, con la señal escrita:

- Lo que protege ya lo cubre otra capa: el respaldo va cifrado con `age` (D-16.37), el
  superusuario vive fuera del entorno de la API, y la ventana es la de un correo en vuelo (segundos
  en operación normal; quince minutos como mucho, con los cinco reintentos).
- Lo que cuesta no es poco: una clave más que rotar con re-cifrado de las filas pendientes, un
  despachador que no puede arrancar sin ella, y `GET /correo/salud` sin poder leer nada del
  contenido ni siquiera en el futuro.
- **La señal para reabrirlo: más de un operador con acceso a la base.** Hoy hay uno. Cuando la
  base la miren dos personas, un token en claro en una columna deja de ser «lo que ve el
  superusuario» y pasa a ser «lo que ve alguien que no es el dueño del sistema»; ese día el cifrado
  del campo vale lo que cuesta, y se escribe el ADR que reemplaza a este punto.

---

## Decisión 5 — Resend como proveedor único, por HTTP y sin SDK

Tres adaptadores cumplen `MailerPort`: `fake` (memoria), `consola` (destinatario y asunto por
`stdout`; el cuerpo entero **solo fuera de producción**, porque lleva el enlace) y **`resend`**:
`POST https://api.resend.com/emails` con `Authorization: Bearer`, cuatro campos (`from`, `to`,
`subject`, `text`), `AbortSignal.timeout(10 s)`, y un error que lleva el estado HTTP y **nunca el
cuerpo de la respuesta** (acaba en `email_outbox.error`, que leen la aplicación y el back office).
El `fetch` entra por constructor, y así se prueba con uno falso: 2xx, 5xx, 401, timeout real, fallo
de red.

Se consideró SMTP genérico (`nodemailer`: una dependencia con las suyas, un servidor que configurar
y una entregabilidad que depende del reverso de la IP del VPS) y Amazon SES (una cuenta de AWS
para un solo uso). Resend es una llamada HTTP de diez líneas con el dominio verificado por DKIM,
SPF y DMARC desde su panel, que es lo que decide si la invitación cae en spam. **Único** no
significa que `MailerPort` conozca a Resend: significa que no se construye una abstracción sobre
varios proveedores para el único que hay (OPTIMIZACION.md §1). El segundo será otro adaptador.

Dos reglas de arranque que no son de formato: `resend` sin `RESEND_API_KEY` o sin `RESEND_REMITENTE`
**no arranca** (al construir el módulo, no al primer envío), y **en producción el despachador
rechaza `fake`**: marcaría `ENVIADO` lo que nadie recibió, sin un solo error en ningún log. La
elección del adaptador vive en un solo sitio (`mailer.provider.ts`) para la API y el despachador,
y por eso la API también conoce `RESEND_*` aunque no envíe: el `.env` es uno.

**El envío real no se ha ejercitado en este paquete**: depende de la cuenta de Resend del usuario y
de su dominio. Es un paso del runbook de puesta en marcha con la evidencia que hay que guardar.

---

## Decisión 6 — `siguiente_intento_en`: la espera, la reserva y el cierre ordenado

El plan no tenía esta columna, y sin ella los cinco reintentos habrían sido cinco pasadas seguidas
(veinticinco segundos en total). Hace tres cosas:

**La espera creciente.** `decidirReintento` (dominio puro): 1 → 2 → 4 → 8 minutos, y al quinto
fallo `FALLIDO` con `datos` saneado y el último error como evidencia. Un proveedor caído no vuelve
en cinco segundos, y golpearlo cada pasada solo consume su límite de tasa.

**La reserva junto a `FOR UPDATE SKIP LOCKED`.** El bloqueo de fila dura lo que la transacción, y
el envío —una llamada HTTP de hasta diez segundos— **no** se hace con la transacción abierta.
Sin más, dos pasadas concurrentes (el contenedor viejo que aún no murió mientras arranca el nuevo)
tomarían el mismo correo. En la misma transacción que las lee, las filas quedan con
`siguiente_intento_en = ahora + 5 min`; si el proceso muere a medias, la reserva caduca y el
correo vuelve solo. Y se **renueva fila a fila** justo antes de cada envío, con `WHERE
siguiente_intento_en = <la firma con la que se tomó>`: si otra instancia la volvió a tomar, cero
filas y el caso de uso la **cede** (ni envía ni marca). Así la reserva cubre un envío y su marca,
no el lote entero, y `CORREO_LOTE` puede ser lo que el operador quiera.

**El cierre ordenado sin `enableShutdownHooks()`.** Los ganchos de Nest ejecutan `onModuleDestroy`
—el `$disconnect()` del pool— al recibir la señal, con la pasada a medias, y después re-emiten la
señal sin receptor: el proceso moría en el acto y un correo ya aceptado por el proveedor quedaba
`PENDIENTE` para reenviarse a los cinco minutos, en el caso rutinario de un redespliegue. Ahora
`SIGTERM`/`SIGINT` solo hacen `bucle.detener()`; la pasada en curso termina, después se cierra el
contexto y el proceso sale con 0. La regla `despachador-sin-ganchos-de-nest` de `audit:forbidden`
impide que vuelva.

**La ventana de doble envío que queda, dicha.** `enviar` y `marcarEnviado` van en `try` distintos:
si el proveedor aceptó y lo que falla es la marca, el error **sube** sin pasar por `marcarFallo`
(la fila queda con su reserva); solo si la base vuelve antes de que caduque, se reenvía una vez.
Son los milisegundos entre el `2xx` y el `UPDATE`. Cerrarla exigiría idempotencia en el proveedor
(Resend admite `Idempotency-Key`), y es la primera mejora si alguna vez se ve un duplicado.

---

## Decisión 7 — `HORAS_DE_RESTABLECIMIENTO = 1`, en el entorno; `DIAS_DE_INVITACION = 7`, constante

El enlace de restablecimiento vive **una hora** por defecto (entero entre 1 y 24, D-16.34): un
token que vale una cuenta y viaja por correo debe caducar antes de que el buzón cambie de manos, y
quien lo pidió está delante del teclado. Es variable de entorno porque un piloto con correo lento
puede necesitar más sin un despliegue. La invitación caduca a los **siete días** y sigue siendo
constante: quien la recibe puede no abrirla hoy, y ese plazo no cambia por despliegue. Los dos
correos dicen su caducidad hasta los minutos, en UTC.

---

## Consecuencias

**Lo que mejora.** Una invitación o un restablecimiento que la base confirmó **se entrega o deja
rastro** de por qué no. El sistema envía correo real con un proveedor verificado, y lo hace un
proceso que no tiene ni la cadena de la aplicación ni acceso a ninguna otra tabla. Un token en
claro existe en la base solo el tiempo que un correo tarda en salir, y solo para un rol. El aviso
de bloqueo del login, que en producción no existía, ahora llega.

**Lo que cuesta, sin adornos.**

- **Un tercer proceso que operar**: su rol, su contraseña (`COSTEO_DESPACHADOR_PASSWORD`), su
  cadena, su `healthcheck` sobre un latido, su tarjeta en el back office. Un correo se queda
  `PENDIENTE` si el servicio `correo` no está en pie, y nada en la API lo dice: lo dice
  `GET /correo/salud` y `docker compose ps`.
- **El correo llega con hasta `CORREO_INTERVALO_MS` de retraso** (cinco segundos), más los
  reintentos si el proveedor falla. Para invitaciones y restablecimientos es invisible; para un
  código de un solo uso con TTL de minutos (SEGURIDAD.md §2.3, sin construir) habría que medirlo.
- **Una fila `FALLIDO` no se reintenta sola.** Es evidencia; el reenvío es una acción de alguien
  (`POST /usuarios/:id/reenvio-de-invitacion`, o pedir otro enlace).
- **El envío real sigue sin ejercitarse** hasta que exista la cuenta de Resend con el dominio
  verificado. Está dicho en el runbook y en `ESTADO.md`.
- **El limitador global y `rate_limit_hit` son dos almacenes** (memoria del proceso y PostgreSQL):
  con una réplica de la API, el primero cuenta por réplica. Está dicho en `app.module.ts`.

**Lo que habría que hacer si esto cambia.** Un segundo proveedor es otro adaptador de `MailerPort`
y una entrada más en `mailer.provider.ts`. Un segundo operador con acceso a la base reabre la
Decisión 4. Una réplica del despachador ya está contemplada (reserva y renovación); una réplica de
la API obliga a mover el limitador global a la base o a Redis.
