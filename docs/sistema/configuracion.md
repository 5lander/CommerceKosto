# Configuración

> Toda decisión de `DECISIONES.md` vive aquí como configuración versionada, **nunca como constante en el código**.

## Principio: la aplicación no arranca mal configurada

`apps/api/src/shared/infrastructure/config/environment.ts` valida el entorno **con un esquema Zod, antes de levantar nada**. Si falta una variable o tiene formato inválido, el proceso muere sin llegar a escuchar.

No es celo: una variable ausente que se resuelve con un valor por defecto silencioso es como se llega a producción apuntando a la base equivocada. **Es preferible no arrancar a arrancar mal.**

Tres comprobaciones no son de formato, sino de seguridad:

| # | Qué comprueba | Qué impide |
|---|---|---|
| 1 | El usuario de `DATABASE_URL` es **exactamente** `costeo_app` | Copiar aquí la cadena del migrator «para que funcione la migración». `costeo_migrator` es dueño de las tablas y eso deja la Barrera 1 en decorativa |
| 2 | En producción, `MIGRATION_DATABASE_URL` y `SHADOW_DATABASE_URL` **no pueden existir** en el entorno del proceso | Un proceso que no tiene la credencial no puede usarla por accidente ni cederla bajo RCE |
| 3 | Ningún mensaje de error repite el **valor** de la variable | Las cadenas de conexión llevan contraseña dentro, y un fallo de arranque acaba en un log, en una captura o en un ticket |

> **La comprobación 1 va en el CAMPO, no en el `superRefine` del objeto.** Un refinamiento de objeto no se ejecuta si algún campo falló antes, así que un `PORT` inválido a la vez desactivaba la comprobación del rol. Ver `docs/incidencias/INC-008`; la regla general está en `CLAUDE.md` §3.

## Variables de entorno

Declaradas en `.env.example`. **`.env` nunca se versiona** — lo garantiza `.gitignore` y lo verifica la regla `sin-env-versionado` de `audit:forbidden`.

### Base de datos

| Variable | Obligatoria | Notas |
|---|---|---|
| `POSTGRES_DB` | compose | Nombre de la base. Por defecto `costeo` |
| `POSTGRES_PORT` | compose | Puerto publicado en el host |
| `POSTGRES_SUPERUSER` / `POSTGRES_SUPERUSER_PASSWORD` | compose | Solo para `initdb` y para las aserciones de las pruebas. **La aplicación jamás se conecta con esto** |
| `COSTEO_MIGRATOR_PASSWORD` | compose | Contraseña de `costeo_migrator`, la usa `initdb` |
| `COSTEO_APP_PASSWORD` | compose | Contraseña de `costeo_app` |
| `DATABASE_URL` | **app** | Rol `costeo_app`. Validada al arrancar |
| `MIGRATION_DATABASE_URL` | CLI de Prisma | Rol `costeo_migrator`. **Prohibida en el proceso de la app en producción** |
| `SHADOW_DATABASE_URL` | CLI de Prisma | Base sombra. Mismas restricciones |

### Aplicación

| Variable | Por defecto | Efecto |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | Puerto HTTP |
| `LOG_LEVEL` | `info` | Nivel de pino |
| `REQUEST_TIMEOUT_MS` | `15000` | Timeout de petición. Es la **segunda** defensa: la primera es `statement_timeout`, fijado en el rol `costeo_app` |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Ventana del limitador |
| `RATE_LIMIT_MAX` | `300` | Peticiones por ventana. En P0 el contador vive en memoria del proceso; pasa a Redis en P1 |
| `APP_URL` | `http://localhost:3001` en desarrollo; **obligatoria en producción** | URL pública del frontend, **sin barra final**. De aquí salen los enlaces de los correos: `APP_URL/activacion?token=…` y `APP_URL/restablecer?token=…` *(P16-A1)* |
| `HORAS_DE_RESTABLECIMIENTO` | `1` | Cuánto vive un enlace de restablecimiento de contraseña. Entero entre 1 y 24 (D-16.34). La invitación caduca a los siete días y no se configura *(P16-A1)* |
| `PROXY_DE_CONFIANZA` | vacía | Desde qué direcciones se cree `X-Forwarded-For` (D-16.49): IPv4, redes IPv4 en CIDR o IPv6 exactas, separadas por comas. `ipDelCliente` toma el **último salto** de la cabecera solo si el socket viene de una de ellas; si no, la IP es la del socket. **Vacía = ninguna** (desarrollo). En producción, la IP **fija** de Caddy en la red de compose, `172.28.0.10` (no la subred entera: incluiría la pasarela y los demás contenedores). Se valida **en el campo** (INC-008): una entrada que no es una dirección no arranca. La leen la API (esquema) y el back office (a mano, `proxies-de-confianza.ts`). Es la IP del bloqueo del login, del límite de tasa y del limitador global *(P16-A1)* |

### Selectores de adaptador (CLAUDE.md §12)

| Selector | Valores | Efecto |
|---|---|---|
| `MAIL_ADAPTER` | `fake` \| `consola` \| `resend` | Correo transaccional. Lo honra la API (que solo encola en `email_outbox`, ADR-025) y lo **usa** el despachador. `fake` guarda en memoria; `consola` escribe destinatario y asunto por la salida estándar (y el cuerpo entero solo fuera de producción); `resend` envía por `POST https://api.resend.com/emails` y **exige `RESEND_API_KEY` y `RESEND_REMITENTE`**, o el proceso no arranca. En desarrollo, `consola`. La elección vive en un solo sitio, `shared/infrastructure/correo/mailer.provider.ts`, para los dos procesos *(P16-A1)* |
| `RESEND_API_KEY` · `RESEND_REMITENTE` | — | Solo con `resend`. El remitente (`Nombre <correo@dominio>` o el correo) va con el dominio verificado en Resend (DKIM, SPF, DMARC). Una cadena vacía cuenta como ausente *(P16-A1)* |
| `STORAGE_ADAPTER` | `fake` \| `real` | Almacenamiento de archivos. El real llega en P10 |

### Despachador de correo (P16-A1, ADR-025)

| Variable | Obligatoria | Notas |
|---|---|---|
| `COSTEO_DESPACHADOR_PASSWORD` | compose | Contraseña de `costeo_despachador`. La usa `initdb` en un cluster nuevo y `npm run rol:despachador` en uno que ya existía |
| `DESPACHADOR_DATABASE_URL` | despachador | Rol `costeo_despachador`, puerto directo (nunca PgBouncer), `connection_limit=2`. **La API no la lee** —su esquema no la conoce— y el despachador **no acepta `DATABASE_URL`**: su esquema propio (`modules/correo/infrastructure/entorno-del-despachador.ts`) rechaza en el campo cualquier usuario que no sea `costeo_despachador` (INC-008). Tres reglas de `audit:forbidden` (`correo.rules.mjs`) impiden nombrarla, nombrar `DespachadorConnection` o importar `CorreoModule` fuera de `modules/correo/`, `despachador.ts` y `test/integracion/correo*.spec.ts` |
| `MAIL_ADAPTER` (en el despachador) | despachador | Mismos valores que arriba. **En producción `fake` no arranca**: marcaría `ENVIADO` lo que nadie recibió. El servicio `correo` de compose lo toma del `.env` (`consola` si falta); la superposición de producción lo exige |
| `CORREO_INTERVALO_MS` | despachador (`5000`) | Cada cuánto pasa por la cola. Entero entre 500 y 600000 |
| `CORREO_LOTE` | despachador (`20`) | Correos por pasada. Entero entre 1 y 500 |
| `CORREO_LATIDO` | despachador (`<tmpdir>/costeo-correo.latido`) | El archivo que el proceso toca tras cada pasada completa; el `healthcheck` del contenedor lo mira (sano si tiene menos de 60 s). Compose lo fija en `/tmp/costeo-correo.latido` |
| `CORREO_MINUTOS_DE_ALERTA` | back office (`15`) | A partir de cuántos minutos un `PENDIENTE` cuenta como retrasado en `GET /correo/salud` (D-16.27c). Entero entre 1 y 1440; se lee a mano, como `BACKOFFICE_PORT` |

El despachador es el **tercer binario** (`npm run correo:despachar`, `apps/api/src/despachador.ts`; en compose, el servicio `correo` con la misma imagen que `api` y `command: node apps/api/dist/despachador.js`, `restart: unless-stopped`). Un bucle: una pasada por la cola (`SELECT … FOR UPDATE SKIP LOCKED` + reserva de cinco minutos del lote, **renovada fila a fila justo antes de cada envío** con la firma de la pasada: si otra instancia volvió a tomar la fila, se cede sin enviar; render, envío, marca), purga de `rate_limit_hit` con más de 24 h, latido, espera. `SIGTERM`/`SIGINT` **solo** paran el bucle: la pasada en curso termina, después se cierra el contexto (y con él el pool) y el proceso sale con 0. **No usa `enableShutdownHooks()` de Nest** —cerraría el pool con la pasada a medias y re-emitiría la señal sin receptor, matando el proceso con un correo aceptado por el proveedor y todavía `PENDIENTE`—, y la regla `despachador-sin-ganchos-de-nest` de `audit:forbidden` impide que vuelva. Un fallo de envío se marca y no para la pasada; un fallo al **marcar** un correo ya aceptado sube y corta la pasada sin pasar por `marcarFallo` (la fila queda con su reserva; si la base vuelve antes de que caduque se reenvía una vez: la única ventana de doble envío, de milisegundos). Reintentos con espera 1 → 2 → 4 → 8 min y `FALLIDO` al quinto, con `datos` reemplazado por `{plantilla, destinatario}` al cerrar el correo (D-16.34, D-16.46).

**Con todos los selectores en `fake` el sistema funciona de punta a punta sin una sola credencial real.** Es criterio de aceptación de P0, y CI lo ejecuta: levanta el stack completo con `docker compose` y responde `/health` y `/ready`.

**Un selector en `real` sin adaptador real NO arranca.** La alternativa —caer al falso con un aviso— significa que una configuración equivocada en producción se traga los correos en silencio. Fallo ruidoso antes que fallo silencioso, el mismo criterio que gobierna los `DEFAULT PRIVILEGES`.

---

## Mantenimiento de la base de desarrollo

```bash
npm run db:reset -- --si
```

Recrea el esquema `public`, restaura los `DEFAULT PRIVILEGES` de P0 y reaplica las migraciones. **Exige `--si`**, se niega con `NODE_ENV=production` y se niega si la conexión no apunta a localhost.

**Hace falta porque las pruebas de integración no limpian y no pueden.** Las tres suites de rendimiento siembran cientos de miles de filas por corrida —volumen realista, que es lo que INC-007 exige— y borrarlas después es **imposible**: `inventory_movement` y `audit_log` son append-only en tres capas, y la del trigger alcanza también al dueño de la tabla. Es R3 funcionando, no un obstáculo.

Cuándo usarlo, y cómo se reconoce que hace falta: **INC-014**.

## Los roles de base de datos

Tres identidades, y la separación entre ellas **es** la Barrera 1 de `CLAUDE.md` §4.1. Es la única defensa que no depende de la disciplina de desarrollo.

### `costeo_migrator` — dueño del esquema

`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`. Es dueño del esquema `public` y de las tablas. Lo usa **solo el CLI de Prisma**, clavado en `prisma.config.ts` a `MIGRATION_DATABASE_URL`. `statement_timeout` de 10 min, porque un índice sobre una tabla grande tarda.

### `costeo_app` — la aplicación

Mismos `NO*` que el anterior, y además: sin `CREATE` en el esquema, sin `TEMPORARY` en la base, sin membresía en ningún rol. Recibe su cadena por parámetro en `PrismaConnection`; no la lee de ningún global.

Sus límites viven **en el rol**, no en la cadena de conexión, de modo que valen aunque alguien se conecte con otro cliente:

```
statement_timeout                   15s
idle_in_transaction_session_timeout 10s
lock_timeout                         3s
search_path                          public
CONNECTION LIMIT                    40
```

`TEMPORARY` no se concede a propósito: **una tabla temporal es una vía para materializar datos fuera del alcance de RLS.**

Nueve pruebas de integración verifican contra la base real que no es superusuario, que `rolbypassrls` es falso, que no es dueño de ninguna tabla, que no puede crear ni destruir objetos, que no lee `pg_authid` ni el historial de migraciones, y que sus `DEFAULT PRIVILEGES` son exactamente `SELECT` + `INSERT`.

### `costeo_backoffice` — el rol que puentea RLS *(desde P11, ADR-017)*

Reservado desde P0 y creado en P11: el único con `BYPASSRLS`, `CONNECTION LIMIT 4`, privilegios concedidos tabla por tabla y vivo solo en el proceso del back office (`BACKOFFICE_DATABASE_URL`, `COSTEO_BACKOFFICE_PASSWORD`). Desde P16-A1 tiene además `SELECT` por columnas sobre `email_outbox` —todas menos `datos`— para `GET /correo/salud`. El detalle y las cuatro condiciones, en ADR-017.

### `costeo_despachador` — el proceso que entrega el correo *(P16-A1, ADR-025)*

`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`, `CONNECTION LIMIT 2`, mismos timeouts que el back office (`30s / 10s / 3s`). **No puentea RLS**: lo que ve lo ve por una política permisiva sobre exactamente dos tablas —`email_outbox` (`SELECT, UPDATE`) y `rate_limit_hit` (`DELETE`, y `SELECT` solo sobre la columna `at`, lo justo para decidir qué es viejo)— y sobre el resto no tiene ni `SELECT`; una prueba de integración lo comprueba tabla por tabla. Lo crea `roles.sql` en un cluster nuevo y `npm run rol:despachador` (idempotente, no rota la contraseña) en uno que ya estaba en pie; la migración de P16-A1 **falla en alto** si no existe, como hizo P11 con el del back office.

---

## `costeo_shadow` — qué es y por qué no abre una grieta

**Qué es.** Una **base de datos** vacía, no un rol. Prisma la necesita para dos cosas: `migrate dev`, que compara el esquema deseado contra el historial, y `migrate diff`, con el que se genera cada `down.sql` (ADR-004). Prisma la usa como borrador: aplica ahí las migraciones, lee el resultado y la deja limpia.

**Por qué la crea `initdb` y no Prisma.** Prisma la crearía sola, pero para eso el rol necesitaría `CREATEDB`, y `costeo_migrator` es `NOCREATEDB` a propósito. Se crea una vez, en el arranque del contenedor, con el superusuario. Ver INC-004.

**Qué permisos tiene.** `CREATE DATABASE costeo_shadow OWNER costeo_migrator`, y después **exactamente el mismo `grants.sql` que la base real**: `REVOKE ALL ... FROM PUBLIC`, `GRANT CONNECT` solo a los dos roles, `public` propiedad del migrator, `USAGE` sin `CREATE` para `costeo_app`, y los mismos `DEFAULT PRIVILEGES` de `SELECT, INSERT`.

**Por qué no es una grieta en la Barrera 1.** Cuatro razones, y ninguna depende de disciplina:

1. **No concede ningún privilegio que el rol no tuviera ya.** Es la misma pareja de roles con los mismos permisos sobre otra base. Nadie gana nada por su existencia: quien pueda conectarse a `costeo_shadow` ya podía conectarse a `costeo`.
2. **No contiene datos de ningún tenant.** Solo estructura, y solo durante los segundos que dura un comando del CLI. Ningún proceso escribe filas de negocio ahí — no hay código que apunte a ella salvo el CLI de Prisma.
3. **La aplicación no la conoce.** `SHADOW_DATABASE_URL` solo la lee `prisma.config.ts`, y el esquema de entorno **rechaza el arranque en producción si esa variable existe** en el proceso de la API. Las dos rutas —CLI y runtime— no se cruzan.
4. **Recibe las mismas políticas RLS**, porque `migrate:verify` aplica las migraciones completas sobre ella. Si algún día llegara a tener datos, seguirían protegidos por las mismas reglas.

Lo que **sí** hay que cuidar, y está cuidado: `costeo_shadow` no debe existir en producción. Allí las migraciones se aplican con `migrate deploy`, que **no la usa**; el runbook de despliegue no la crea, y el esquema de entorno impide que su cadena viva en el proceso de la aplicación.

---

## Configuración por company (`company_settings`)

Los parámetros de costeo de `DECISIONES.md` D3. Se siembran al crear el tenant y el cliente puede editarlos. **El motor de costeo los recibe como parámetro**; no los lee de ningún sitio global. Llega en P3.

## Configuración de aplicación

| Archivo | Contiene | Desde |
|---|---|---|
| `apps/web/src/textos/es.ts` | Nombre visible del producto y firma verbal (D1, cerrada en P14: **Platise**). El `config/branding.ts` que D1 daba por hecho nunca existió: los textos visibles viven donde los pone D11 | P12 · P14 |
| **`shared/infrastructure/config/periods.ts`** | **La zona horaria del calendario contable (D6, D11)** | **P7 ✅** |
| `config/plans.ts` | Límites por plan (D5) | P11 |
| `config/locale.ts` | Idioma, moneda, zona horaria, formatos (D11) | P1 |

### `periods.ts`: por qué es configuración versionada y no variable de entorno

```ts
export const ZONA_HORARIA_DE_PERIODOS = 'America/Guayaquil';
```

**Cambiar esta zona cambia a qué mes pertenece cada movimiento futuro.** Un cambio así tiene que pasar por una revisión de código y quedar en el historial, no aparecer en el `.env` de una máquina y desaparecer con ella.

**Y cambiarla no reescribe la historia.** Las fronteras de un período se resuelven una sola vez, al abrirlo, y se guardan en `period.starts_at` / `ends_at` como instantes. Los meses ya abiertos conservan la frontera con la que se abrieron; solo los nuevos usarían la zona nueva. Es la razón de que el modelo guarde instantes y no un mes — ver ADR-010 §2.

**Vive bajo `shared/infrastructure/config/` y no en un `src/config/` suelto**, que es donde D6 la sitúa por nombre: una carpeta a ese nivel quedaría fuera de las tres capas que `audit:arch` vigila. El dominio no la lee nunca: `CalendarioDePeriodos` recibe la zona por constructor.


---

## Variables que añade P1

| Variable | Para qué | Obligatoria |
|---|---|---|
| `PGBOUNCER_DATABASE_URL` | La conexión **a través del pooler**. La usa únicamente la prueba que verifica la cuarta condición de D12 | Solo para pruebas de integración |

`npm run db:up` levanta ahora **PostgreSQL y PgBouncer**. La aplicación sigue conectándose por `DATABASE_URL` (directa); el día que se decida poner el pooler en el camino se cambia esa variable y no esta.

**La prueba de PgBouncer falla si la variable no está**, en vez de saltarse. Es deliberado: una prueba de seguridad que se omite cuando falta la infraestructura es un verde que no mide nada (INC-007).

## Configuración de PgBouncer, y por qué cada valor

| Ajuste | Valor | Por qué |
|---|---|---|
| `pool_mode` | `transaction` | Lo exige ADR-001. Es también el modo donde la fuga de tenant sería posible, y por eso se prueba |
| `max_prepared_statements` | `100` | Prisma usa sentencias preparadas; con `0`, en modo transacción, mueren con «prepared statement already exists» |
| `default_pool_size` | `1` | **No es una limitación: es el instrumento.** Con una sola conexión al servidor, la reutilización entre clientes no es probable sino segura, y la prueba es concluyente |
| `auth_type` | `scram-sha-256` | Es el cifrado de contraseñas por defecto de PostgreSQL 18 |
| Usuario | Solo `costeo_app` | El rol de migraciones usa conexión **directa** siempre: el CLI de Prisma emite sentencias que el modo transacción no soporta |

**Sin `?pgbouncer=true` en la cadena.** Prisma dejó de recomendarlo a partir de PgBouncer 1.21.0 (ADR-001).

## Parámetros de sesión y de bloqueo

Viven en el dominio, como constantes con nombre, no en variables de entorno: son **reglas**, no configuración de despliegue, y cambiarlas debe ser un commit que alguien revisa.

| Constante | Valor | Dónde |
|---|---|---|
| Vida absoluta de sesión | 12 h | `politica-de-sesion.ts` |
| Inactividad máxima | 4 h | ídem |
| Refresco de `last_seen_at` | 5 min | `validar-sesion.ts` |
| Umbral de bloqueo por cuenta | 5 fallos | `politica-de-intentos.ts` |
| Umbral de bloqueo por IP | 25 fallos | ídem |
| Ventana de disparo / de escalada | 15 min / 60 min | ídem |
| Escala de bloqueo | 1 → 5 → 15 → 60 min | ídem |
| Largo de contraseña | 12–128 | `politica-de-contrasenas.ts` |
| Caducidad de invitación | 7 días | `usuarios.ts` |
| Límite de tasa `password.olvido` | IP 10/h · destinatario 3/h | `shared/domain/limite-de-tasa/politicas.ts` (D-16.50) |
| Límite de tasa `password.restablecimiento` | IP 10/h | ídem |
| Límite de tasa `usuario.invitar` · `usuario.reenvio` | IP 30/h · destinatario 3/h | ídem |
| Bloqueo del límite de tasa | 60 min desde el último golpe | ídem; purga de `rate_limit_hit` a las 24 h por el despachador |
| Golpes que se leen por decisión | `umbral × escalones + 1` | `shared/domain/acceso/politica-de-intentos.ts` (`golpesQueDeciden`) |
| Reintentos del despachador | espera 1 → 2 → 4 → 8 min; `FALLIDO` al 5.º | `modules/correo/domain/reintentos.ts` (D-16.46) |
| Reserva de un correo tomado | 5 min, renovada fila a fila antes de cada envío | `modules/correo/infrastructure/prisma-cola-de-correo.ts` |
| Timeout de envío a Resend | 10 s | `shared/infrastructure/correo/resend-mailer.ts` |
| Purga de `rate_limit_hit` | golpes de más de 24 h, en cada pasada | `modules/correo/application/despachar-correo.ts` (D-16.28) |
| Parámetros de Argon2id | m=65536, t=3, p=1 | `argon2-hasher.ts` |

El límite de ubicaciones **sí** es configuración, y por company: `company.max_locations`, con valor por defecto 10 (D5). El plan como entidad llega en P11.
