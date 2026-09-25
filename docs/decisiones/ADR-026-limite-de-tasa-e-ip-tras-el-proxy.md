# ADR-026 — El límite de tasa y la IP del cliente tras el proxy

**Fecha:** 2026-09-10 · **Paquete:** P16-A1 · **Estado:** aceptada
**Cierra:** D-16.17, D-16.24, D-16.28, D-16.32, D-16.36, D-16.49, D-16.50; INC-022; la fila «token de invitación y de restablecimiento» de SEGURIDAD.md §2.1, que hasta aquí era estándar sin implementación

---

## Contexto

P16-A1 abre tres endpoints que escriben **sin sesión** o mandan correo a quien se pida
(`/auth/password/olvido`, `/auth/password/restablecimiento`, el reenvío de invitación) y hace que
`POST /usuarios` encole correo real. Sin límite, cualquiera puede inundar un buzón con enlaces de
restablecimiento, muestrear el canal de tiempo de `/olvido` (ADR-025, Decisión 3) o probar tokens
sin descanso. SEGURIDAD.md §2.1 lo exigía desde P0 («10 tokens inválidos desde una IP / hora»), y
hasta aquí ninguna ruta lo cumplía.

Y al ir a construirlo apareció lo que INC-022 registra: **detrás de Caddy toda petición llega con
la IP de Caddy**. Desde P14b el despliegue tiene proxy y la API seguía tomando
`socket.remoteAddress` con un comentario que decía «cuando el despliegue tenga proxy de
confianza…». El bloqueo por IP del login (25 fallos por hora, ADR-006) habría sido un **bloqueo
global** al vigésimo quinto fallo de cualquiera, el limitador global (300/min) contaba a todos en
una cubeta, y un límite por IP nuevo no habría medido nada. Un límite por IP sin la IP correcta es
peor que ninguno: parece que protege.

---

## Decisión 1 — `ipDelCliente`: se cree el proxy, y solo el proxy

Un solo camino, `shared/infrastructure/http/ip-del-cliente.ts`, y **no hay otra copia**: lo usan el
login (`login_attempt.ip`, `session.ip`, el eje de IP del bloqueo), el back office
(`backoffice_access_log.ip`, el login del operador), `LimitadorDeTasa` y el limitador global
(`LimitadorGlobalGuard extends ThrottlerGuard` con `getTracker`, que es el punto de extensión que
la librería documenta para proxies; registrado como `APP_GUARD` en `app.module.ts`).

La regla cabe en una línea: **se toma el último salto de `X-Forwarded-For` solo si el socket está en
`PROXY_DE_CONFIANZA`; si no, la IP es la del socket.** El último y no el primero: el primero lo
puso el cliente (o quien quiso); el último lo puso el proxy en el que se confía, con lo que vio en
su propio socket. Lo que no parsea como IP —puerto, `for=` de RFC 7239, zona, basura tras la coma—
cae al socket, porque `login_attempt.ip` es `INET` y una cadena inválida reventaría el login.
`::ffff:a.b.c.d` se normaliza a `a.b.c.d` y las IPv6 a forma canónica, para que la lista y las
claves signifiquen lo que dicen. IPv6 se valida con un parser propio y no con `net.isIP`: la misma
pieza valida, compara y canoniza, y `net.isIP` no canoniza.

`PROXY_DE_CONFIANZA` es una lista explícita (IPv4, CIDR v4, IPv6 exacta), **validada en el campo**
del esquema (INC-008) y **vacía por defecto**. En desarrollo no hay proxy y el socket es la verdad.

### La subred fija, y por qué la lista lleva UNA dirección

`docker-compose.prod.yml` fija la red por defecto en `172.28.0.0/24` y a Caddy en **`172.28.0.10`**
(`ipv4_address`); `preparar.sh` deja `PROXY_DE_CONFIANZA=172.28.0.10` en la plantilla. Dos
decisiones, cada una con su razón:

- **La subred es fija** porque sin ella un CIDR o una IP en el `.env` puede dejar de casar tras un
  `docker compose down`/`up` que reasigne la red, y el fallo sería **silencioso**: la API volvería
  a contar a todos como la IP de Caddy sin un solo error. Cambiarla exige `down` + `up`; un
  `restart` no toca la IPAM de una red viva (runbook de despliegue).
- **La lista lleva la IP de Caddy y no la subred** (corrección tras la revisión adversarial de la
  etapa). La primera versión confiaba en `172.28.0.0/24` entera, que incluye la pasarela
  `172.28.0.1` —la dirección de origen que la API ve cuando algo del propio VPS entra por el puerto
  publicado `127.0.0.1:3000`— y a todos los demás contenedores (`web`, `correo`, `pgbouncer`,
  `db`). Cualquiera de ellos podía poner la `X-Forwarded-For` que quisiera. CLAUDE.md §4 manda la
  opción más restrictiva, y existía.

**El riesgo residual, dicho:** quien controle el contenedor de Caddy controla la cabecera. Es
inevitable con un proxy delante, y es exactamente un contenedor, no una red.

### Lo que se descartó

| Alternativa | Por qué no |
|---|---|
| `app.set('trust proxy', …)` de Express | Solo arregla `req.ip` (el camino del `ThrottlerGuard`); los otros dos leen `socket.remoteAddress` a mano. Y su semántica («N saltos», `loopback`, `uniquelocal`) es más amplia de lo que hace falta y más fácil de configurar de más |
| El primer salto de la cabecera | Lo escribe el cliente |
| Confiar en «las IP privadas» | Es el envenenamiento con otro nombre: cualquier contenedor de la máquina, o cualquiera detrás de un NAT compartido, elegiría su IP |
| Una regla de `audit:forbidden` contra `socket.remoteAddress` | Tiene un uso legítimo (dentro del helper) y sería la siguiente que alguien exime. Si aparece una segunda copia de `ipDe`, se escribe |

---

## Decisión 2 — La regla del login, generalizada y sin mover una aserción

`evaluarIntentos` vivía en `iam/domain` con sus números dentro, y `shared` no puede importar de un
módulo. Se generalizó con `PoliticaDeIntentos {umbral, ventanaDeDisparoMs, ventanaDeEscaladaMs,
escalaDeBloqueoMinutos}` y se mudó a `shared/domain/acceso/politica-de-intentos.ts`; `iam/domain`
conserva `POLITICA_DE_LOGIN` (cuenta 5 / IP 25, ventanas 15 y 60 min, escala 1 → 5 → 15 → 60) y
delega. **Sus 23 pruebas siguen en verde sin tocar una aserción**, que es lo que demuestra que
generalizar no movió nada: el bloqueo cuenta desde el último fallo, dos ventanas, la última escala
se repite. Escribir una segunda regla de «N en una ventana, bloqueo que escala» habría sido tener
dos que difieren en un borde el día que alguien toque una.

---

## Decisión 3 — Cuatro `kind`, dos ejes, y los umbrales

| `kind` | Endpoint | Por IP | Por destinatario |
|---|---|---|---|
| `password.olvido` | `POST /auth/password/olvido` | 10/h | 3/h |
| `password.restablecimiento` | `POST /auth/password/restablecimiento` | 10/h | — (lleva un token, no un correo) |
| `usuario.invitar` | `POST /usuarios` | 30/h | 3/h |
| `usuario.reenvio` | `POST /usuarios/:id/reenvio-de-invitacion` | 30/h | 3/h |

Ventana de una hora y un solo escalón de bloqueo de 60 minutos que cuenta desde el **último**
golpe: insistir alarga la espera. **El eje de IP corta a quien enumera** (con `/olvido` en 202
siempre, lo único que le queda es el canal de tiempo, y diez muestras por hora no dan para medir
milisegundos). **El de destinatario corta la inundación de un buzón**: sin él, cualquiera mandaría
a un usuario un enlace por segundo desde mil direcciones, y lo entrenaría a ignorar el correo que
un día sí importe. Invitar y reenviar tienen 30/h por IP porque un administrador dando de alta un
local entero es legítimo; 3/h al mismo correo porque es la misma acción repetida, y un
administrador con la cuenta robada es justamente quien inundaría.

Tres reglas que no están en la tabla y son la mitad de la decisión:

- **El golpe se registra siempre** —permitido o no, 202 o 400—: «diez por hora» son diez
  peticiones, no diez rechazos; y contar el golpe bloqueado es lo que hace que insistir alargue.
- **El límite corre antes del trabajo**: antes de buscar al usuario, antes de gastar el token,
  antes de encolar. Y por eso la IP entra en los **casos de uso**, no en el limitador desde el
  controlador: en el reenvío el destinatario solo se sabe tras buscar al invitado, y la IP cuenta
  aunque el usuario no exista (treinta 404 a ids inventados y el siguiente es 429: quien enumera
  no se libra por no acertar).
- **El `kind` lo fija el código, nunca la petición**, y la base lo repite en el CHECK
  `rate_limit_hit_kind_conocido`: añadir uno sin el otro falla en el primer golpe, en alto.

Los umbrales son constantes con nombre en `shared/domain/limite-de-tasa/politicas.ts`, no
variables de entorno: son reglas, y cambiarlas debe ser un commit que alguien revisa (el criterio
de `configuracion.md`, «Parámetros de sesión y de bloqueo»).

---

## Decisión 4 — `rate_limit_hit` está fuera del ámbito de tenant: exención de ámbito, no de RLS ni de auditoría

Un golpe de `/olvido` no pertenece a ninguna company: quien lo da todavía no es nadie. La tabla
tiene `ENABLE + FORCE ROW LEVEL SECURITY` y política **permisiva** (`USING (true)`) para
`costeo_app`, `costeo_despachador` y `costeo_migrator`, exactamente como `login_attempt` desde P1.
**La lista de exenciones de M6 sigue vacía** (D-16.32): no es una tabla sin RLS, es una tabla cuya
política no filtra porque no hay tenant contra el que filtrar. Está registrada como **exención de
ámbito** en `docs/SEGURIDAD.md` §2.1 junto a `login_attempt`, y no exime de nada más: lo que la
tabla guarda es un `kind`, una clave y un instante; la aplicación solo tiene `SELECT` e `INSERT`
(nunca `UPDATE`/`DELETE`), y `runWithoutTenant` exige el motivo por firma para que
`grep runWithoutTenant` siga listando todas las excepciones.

**Las claves no guardan correos.** `ip:<ip>` es la IP que `ipDelCliente` resolvió;
`correo:<sha256 hex del correo recortado y en minúsculas>` es un hash, porque quien pide un
restablecimiento para un correo que no existe no es usuario de nadie y su dirección no tiene por
qué quedarse en ninguna tabla (minimización, SEGURIDAD.md §8). El evento de auditoría tampoco lleva
el correo **ni su hash**: para quien tenga la lista de usuarios delante, el hash identifica tanto
como el correo.

---

## Decisión 5 — Contar y anotar son un solo acto por clave: `pg_advisory_xact_lock`

La primera versión leía el recuento en una transacción y escribía el golpe en otra. Bajo
peticiones **simultáneas** de la misma clave todas leían el mismo recuento y todas pasaban; la
revisión adversarial lo midió antes de tocar nada: treinta `/olvido` con `Promise.all` desde una IP,
**treinta aceptadas**; doce al mismo buzón, **doce correos**. Las 🔴 anteriores estaban escritas en
serie, y por eso pasaban sin medir la carrera (el caso INC-007 de esta etapa).

**Un límite de leer-luego-escribir no es un límite: limita en serie, y un atacante no pide en
serie.** Ahora `RegistroDeLimites.golpear({kind, clave, at, desde, maximo})` es **una** operación:
abre una transacción, toma `pg_advisory_xact_lock(hashtext(kind), hashtext(clave))`, lee los golpes
anteriores y anota el nuevo. El bloqueo consultivo serializa **solo** a las peticiones de la misma
clave y muere al confirmar; con `READ COMMITTED`, la lectura que sigue ve lo que la anterior
confirmó. Una colisión de `hashtext` entre dos claves solo las serializa de más, nunca deja pasar
de más. Después: exactamente diez de treinta, tres de doce, y la 🔴 en paralelo que lo fija.

| Alternativa | Por qué no |
|---|---|
| Una fila-contador por clave con `UPDATE … RETURNING` | Exige `UPDATE` a `costeo_app` sobre una tabla que hoy solo inserta, y una fila mutable que resumir; el registro de golpes con instante es lo que permite «desde el último golpe» |
| `SERIALIZABLE` con reintento | Más caro (el conflicto se detecta al confirmar) y sin garantía de orden: el reintento vuelve a leer, y bajo carga puede reintentar varias veces |
| Un contador en memoria del proceso | Es lo que hace el limitador global, y por eso el suyo es por réplica; un límite por buzón tiene que sobrevivir a un reinicio y valer para todas las réplicas |

Dos consecuencias de la misma revisión:

- **La lectura va acotada.** `golpesQueDeciden(politica) = umbral × escalones + 1` es todo lo que
  `evaluarIntentos` necesita para decidir lo mismo que con la hora entera (ronda y escalón salen
  del recuento; «hasta cuándo», del más reciente), y el `+ 1` es lo que permite distinguir un
  recuento exacto de uno truncado. Quien insiste bloqueado sigue dejando golpes, y sin tope cada
  petición suya cargaría todos los de la hora: `Index Only Scan` de 11 entradas en vez de miles.
- **La auditoría es de transición.** `system.ratelimit.exceeded` queda en `audit_log` —actor
  `SYSTEM`, sin company, con la IP en su columna y en `detail` solo `kind`, ejes y `bloqueadoHasta`—
  **una vez por ronda**, en el golpe que abre o escala el bloqueo (`abreBloqueo`, el espejo de
  `cruzaUmbralDeBloqueo` del login), no en cada 429. `audit_log` es append-only y no se purga;
  auditar cada rechazo dejaría a un anónimo bloqueado escribir miles de filas por hora. Los demás
  rechazos quedan en `rate_limit_hit`, que sí se purga, y en el log de peticiones.

---

## Decisión 6 — La purga la hace el despachador, a las 24 horas

Ninguna ventana del límite pasa de una hora; a las 24 no queda nada que contar. `DELETE FROM
rate_limit_hit WHERE "at" < ahora − 24 h` corre al final de cada pasada del despachador (D-16.28),
que ya pasa cada pocos segundos y ya tiene el `DELETE` — y `SELECT` **solo sobre `at`**, lo justo
para decidir qué es viejo sin poder leer una sola clave. Un `cron` sería un cuarto proceso con
credencial propia para una sentencia. La aplicación no borra: `costeo_app` no tiene `DELETE`.

Es un `Seq Scan` (no hay índice que empiece por `at`; el compuesto empieza por `kind`), y con lo
que la tabla puede acumular —un día de golpes— es aceptable: 4 ms sobre 38.000 filas en el
`EXPLAIN` del paquete. Si alguna vez la purga se ve en `pg_stat_statements`, el arreglo es un índice
sobre `(at)` con su consulta delante, no un cambio de dueño.

---

## Decisión 7 — Un 429 propio, distinto de los otros dos

`LIMITE_DE_SOLICITUDES` es el **tercer** 429 del sistema, y un cliente tiene que poder distinguir
los tres:

| Código | Quién lo emite | Qué significa |
|---|---|---|
| `ACCESO_BLOQUEADO` | el login (P1) | tu cuenta, o tu IP en el login, está bloqueada |
| `TOO_MANY_REQUESTS` | el limitador global (`ThrottlerGuard`, 300/min) | espera un momento |
| **`LIMITE_DE_SOLICITUDES`** | `LimitadorDeTasa` (P16-A1) | ya pediste **esto** demasiadas veces |

Lleva `Retry-After` en segundos (nunca menor que 1) y el minuto en el mensaje: es lo único que un
usuario legítimo necesita, y no le da al atacante nada que no supiera (la ventana es pública: está
en este archivo). El filtro emite `Retry-After` para **cualquier** `ErrorDeDominio` que traiga
`reintentarEnSegundos` entero positivo —mira la forma, no la clase—, así que el día que
`AccesoBloqueadoError` lo lleve, la cabecera saldrá sola. No se le añadió en este paquete porque
cambia un contrato de P1 fuera del alcance; es una línea y una prueba, y queda como deuda dicha.

---

## Consecuencias

**Lo que mejora.** Los cuatro endpoints tienen el límite que SEGURIDAD.md §2.1 pedía desde P0, por
IP y por destinatario, y **de verdad bajo concurrencia**. La IP que cuenta es la del cliente:
INC-022 cerrada, y con ella el bloqueo del login y el limitador global vuelven a significar lo que
decían. El canal de tiempo de `/olvido` queda acotado a diez muestras por hora.

**Lo que cuesta.**

- **Dos transacciones más por petición limitada** (una por eje), cada una con un bloqueo
  consultivo. Sobre rutas que se llaman decenas de veces por hora, no por segundo.
- **Un cliente legítimo detrás de un NAT** (una cocina entera) comparte los 10/h y los 30/h por IP.
  El de destinatario no le afecta, y los umbrales se eligieron con eso delante: treinta
  invitaciones por hora desde un local es más de lo que un alta entera necesita.
- **La subred fija y la IP de Caddy son configuración que se puede desalinear** (`.env` y
  compose), y el fallo es silencioso. El runbook deja la comprobación (`docker inspect
  costeo-caddy`) y el `down` + `up`; el ensayo completo de despliegue con la subred fija **no se
  ha hecho** en este paquete y es lo que lo confirma.
- **El limitador global sigue en memoria del proceso** y `rate_limit_hit` en PostgreSQL: dos
  almacenes para dos mecanismos. Con una réplica de la API, el global cuenta por réplica.

**Lo que habría que hacer si esto cambia.** Un segundo proxy delante (un CDN) es una entrada más
en `PROXY_DE_CONFIANZA` y el mismo «último salto». Un quinto endpoint sensible es un `kind` más en
`politicas.ts` **y** en el CHECK, con su fila aquí. Si el `Seq Scan` de la purga aparece en las
consultas caras, un índice sobre `(at)`.
