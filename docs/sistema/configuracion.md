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

### Selectores de adaptador (CLAUDE.md §12)

| Selector | Valores | Efecto |
|---|---|---|
| `MAIL_ADAPTER` | `fake` \| `real` | Correo transaccional. El real llega en P1 |
| `STORAGE_ADAPTER` | `fake` \| `real` | Almacenamiento de archivos. El real llega en P10 |

**Con todos los selectores en `fake` el sistema funciona de punta a punta sin una sola credencial real.** Es criterio de aceptación de P0, y CI lo ejecuta: levanta el stack completo con `docker compose` y responde `/health` y `/ready`.

**Un selector en `real` sin adaptador real NO arranca.** La alternativa —caer al falso con un aviso— significa que una configuración equivocada en producción se traga los correos en silencio. Fallo ruidoso antes que fallo silencioso, el mismo criterio que gobierna los `DEFAULT PRIVILEGES`.

---

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

### `costeo_backoffice` — **no existe todavía**

El nombre está reservado. Un rol con login y contraseña que nadie usa es superficie de ataque sin contrapartida: se crea en P11, con su propio ADR.

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
| `config/branding.ts` | Nombre visible del producto (D1) | P1 |
| `config/periods.ts` | Política de cierre y reapertura (D6) | P7 |
| `config/plans.ts` | Límites por plan (D5) | P11 |
| `config/locale.ts` | Idioma, moneda, zona horaria, formatos (D11) | P1 |
