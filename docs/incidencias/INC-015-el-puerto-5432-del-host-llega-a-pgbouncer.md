# INC-015 — `FATAL: bouncer config error` conectando al puerto 5432, que es el de PostgreSQL directo

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-06 |
| **Paquete** | P8 (verificación posterior) |
| **Área** | despliegue · base de datos |
| **Tiempo perdido** | ~35 min |
| **Recurrencias** | **3** — la tercera dispara la prevención (CLAUDE.md §8): **hecha en P16-W** (`audit:base`) |

> **El síntoma acusa al componente equivocado.** El error nombra a pgbouncer, pero la cadena de conexión dice `localhost:5432`, que es PostgreSQL directo, y `docker port` confirma que pgbouncer está en 6432. Es fácil pasar media hora revisando `prisma.config.ts`, el `.env` y los roles antes de sospechar del reenvío de puertos.

## Síntoma

Cualquier cosa que use `MIGRATION_DATABASE_URL` falla:

```
Error: Schema engine error:
FATAL: bouncer config error
```

Y la variante que sale con `SHADOW_DATABASE_URL`, que despista todavía más porque parece un problema de credenciales:

```
SASL authentication failed
```

Antes de eso, y por la misma causa, las pruebas de integración fallan en suites distintas cada vez con:

```
Error: connect ETIMEDOUT ::1:5432
Error: connect ETIMEDOUT 127.0.0.1:5432
```

## Contexto

Al ejecutar `npm run db:reset` por primera vez. El contenedor de la base estaba **sano** (`Up, healthy`), con 10 conexiones de 100 y respondiendo sin problema a `docker exec psql`. Desde el host, no.

## Causa raíz

**El puerto 5432 del host estaba llegando a pgbouncer, no a PostgreSQL**, aunque `docker port` dijera lo contrario:

```
costeo-db          5432/tcp -> 0.0.0.0:5432
costeo-pgbouncer   5432/tcp -> 0.0.0.0:6432
```

Los contenedores llevaban dos días creados y el reenvío de Docker Desktop había quedado desincronizado de esa tabla.

**Y pgbouncer solo conoce a `costeo_app`**, por decisión de ADR-001: el rol de migraciones va siempre por conexión directa, porque el CLI de Prisma emite sentencias que el modo transacción no soporta. Así que una conexión de `costeo_migrator` que aterriza en el pooler cae en el `auth_query`, y el `auth_query` no tiene permiso sobre `pg_authid`:

```
pgbouncer:  no such user: costeo_migrator
            error response from auth_query
postgres:   ERROR: permission denied for table pg_authid
```

**Nada de eso está mal.** Es la separación de roles funcionando: pgbouncer no debe poder autenticar al migrator. El fallo es que la conexión llegó a un sitio al que no iba dirigida.

Y explica el `ETIMEDOUT` de las pruebas: con `DEFAULT_POOL_SIZE: 1` y `MAX_CLIENT_CONN: 50`, dieciocho suites entrando por el pooler se atascan unas a otras. **El diagnóstico natural —«la base está llena»— era el equivocado.**

## Cómo confirmarlo en un minuto

`docker port` no sirve: dice lo que el compose declaró, no por dónde entran las conexiones. Lo que sí sirve es preguntarle al servidor quién es:

```bash
docker logs --since 5m costeo-pgbouncer | grep "login attempt"
```

Si ahí aparece un intento con `user=costeo_migrator`, las conexiones que creías directas están pasando por el pooler.

## Solución

```bash
docker compose down
docker compose up -d db pgbouncer
```

Recrear los contenedores rehace el reenvío. **`docker compose restart` no basta**: reinicia el proceso sin rehacer la publicación de puertos, que es justo lo que está mal.

## Recurrencia 1 (P16 · Armazón, 2026-09-13) — el puerto que acepta y corta

**Otro síntoma, la misma causa.** Esta vez el 5432 no llegaba a PgBouncer: **aceptaba la conexión y la
cerraba sin contestar**.

```
MIGRATION_DATABASE_URL ERR Connection terminated unexpectedly
DATABASE_URL ERR Connection terminated unexpectedly
127.0.0.1  → Connection terminated unexpectedly
[::1]      → connect ECONNREFUSED ::1:5432
```

Con `costeo-db` **`healthy`**, `netstat` enseñando `127.0.0.1:5432 LISTENING`, `docker exec … psql`
respondiendo, y **el 6432 de PgBouncer funcionando** —PgBouncer habla con la base por la red interna,
no por el puerto del host—. Ningún intento de login en el log de PgBouncer ni en el de PostgreSQL: la
conexión moría en el reenvío.

**Qué lo provocó:** todos los contenedores de la máquina llevaban «Up 9 hours» y la base arrancó con
`database system was not properly shut down; automatic recovery in progress` a las 00:35 UTC, junto
con contenedores de otros proyectos: un reinicio de Docker Desktop (o del equipo), no un cambio del
proyecto. `seed:tenant` siguió funcionando porque va por `docker compose exec … psql`, y eso escondió
el problema hasta que algo quiso entrar por el puerto.

**Lo que se hizo mientras tanto:** la API y el importador de las capturas se apuntaron a
`PGBOUNCER_DATABASE_URL`, que solo usa `costeo_app`. **Las pruebas de integración no tienen esa
salida**: el migrator no puede pasar por el pooler (ADR-001).

**Cómo se cerró:** el usuario prefirió **publicar la base en otro puerto del host** para que no
conviva en el de siempre con los Postgres de otros proyectos de la máquina: `POSTGRES_PORT=5442` y las
cinco cadenas `localhost:5442` en el `.env` local, y `docker compose up -d --no-deps db`, que recrea el
contenedor con la publicación nueva. Datos intactos; PgBouncer sigue en 6432 porque habla con la base
por la red interna. Si otra máquina necesita lo mismo, son esas seis líneas del `.env` y ese comando
(D-16.145).

## Recurrencia 2 (commit de dependencias, 2026-10-01) — la primera variante, en el puerto nuevo

**La variante original, ahora en el 5442.** `npm run audit` falló en `audit:sec-headers`, aunque sus
18 pruebas de cabeceras pasaban: la que caía era `backoffice-interfaz`, con **`bouncer config error`**
conectando a la cadena directa. Lo que contestaba en el 5442 era **PgBouncer**, que rechaza al rol de
migraciones, y su log enseñaba el rechazo a la hora de la prueba. Tres conexiones de solo lectura desde
el host fallaron igual. Los contenedores llevaban 14 horas arriba y estaban `healthy`.

**Que el puerto sea otro no la evitó**: D-16.145 movió la base al 5442 por convivencia con otros
proyectos, no por esto, y el reenvío se desincroniza igual en cualquier puerto. **Esta variante no la
caza `npm run doctor`**, como la propia ficha ya decía: PgBouncer también contesta el `SSLRequest`.
Se arregló con `npm run db:down && npm run db:up`. No se contó en su momento, y se registra aquí.

## Recurrencia 3 (commit de dependencias, 2026-10-03) — el pooler muerto, en silencio

**Otra variante: el 6432 rechazaba la conexión.** El pre-commit falló con 5 pruebas en rojo en
`pgbouncer.spec.ts`, todas `connect ECONNREFUSED 127.0.0.1:6432` y `::1:6432`. El contenedor
`costeo-pgbouncer` estaba `healthy` y tenía `127.0.0.1:6432` en su configuración, pero `docker port`
no devolvía nada y una conexión TCP al 6432 era rechazada. El 5442 sí abría. La pila llevaba 42 horas
arriba.

**Por qué la suite corrió igual:** la sonda de `tools/audit/tests.mjs` solo mira el puerto de
`DATABASE_URL`. Con el 6432 muerto, la integración arrancó entera y falló con un error de conexión que
no nombra la causa. `npm run db:down && npm run db:up` lo arregló, y el commit pasó a la siguiente.

## Prevención

### Desde P16-W (2026-10-03): ninguna prueba entra en la base sin preguntar antes

**Tercera recurrencia, prevención hecha.** La sonda vive en `scripts/lib/sonda-de-la-base.mjs` y la
usan tres sitios: `npm run doctor`, `audit:tests` y **`audit:base`**, un check nuevo que en
`npm run audit` va **antes de `audit:sec-headers`**, porque esa etapa ya entra en la base y es donde
salió la recurrencia 2.

| Pregunta | Cómo | Qué caza |
|---|---|---|
| ¿Habla el protocolo cada `host:puerto` de las tres cadenas? | `SSLRequest`, 3 intentos (INC-016) | recurrencias 1 y 3 |
| ¿En el puerto directo contesta PostgreSQL? | `StartupMessage` con el usuario de `MIGRATION_DATABASE_URL`, **sin contraseña** y **en una conexión nueva** (si el servidor contestó `S` al `SSLRequest`, lo siguiente que espera es TLS) | **la variante original y la recurrencia 2**, que el `SSLRequest` no veía |

**La regla del `StartupMessage` se escribió después de medirla**, contra la pila real, el 2026-10-03:

```
5442 (PostgreSQL)  → R, código 10            (empieza la negociación SCRAM)
6432 (PgBouncer)   → E, FATAL 08P01 «bouncer config error»
```

Un `E` no prueba por sí solo que sea PgBouncer: PostgreSQL también lo manda ante una regla de
`pg_hba` o un rol que no existe. Por eso el mensaje **cita el error tal cual** en vez de afirmar quién
contestó.

**El estado `rota` falla siempre**, también con `--solo-unitarias`. Esa bandera degrada a PARCIAL a
quien no tiene Docker corriendo; con Docker arriba y un puerto mal, un PARCIAL en verde sería INC-007.
La pila apagada (todo `rechazada`) conserva su trato de siempre.

**Guardián, visto fallar** con cada escenario provocado de verdad:

```
# 1 · docker stop costeo-pgbouncer
audit:base  FALLO — localhost:6432 (PGBOUNCER_DATABASE_URL) rechazada
  Reenvio de Docker desincronizado (INC-015): npm run db:down && npm run db:up
audit:tests FALLO (con --solo-unitarias) — el mismo detalle; antes habria corrido la integracion entera

# 3 · MIGRATION_DATABASE_URL al 6432, solo en el entorno del proceso
audit:base  FALLO — localhost:6432 (MIGRATION_DATABASE_URL) rechaza a costeo_migrator antes de
            autenticar: «bouncer config error» (PostgreSQL contestaria «R»; ...)

# 2 · npm run db:down
audit:tests PARCIAL con --solo-unitarias · FALLO sin ella · audit:base FALLO «La pila no esta levantada»

# 4 · todo arriba
audit:base  OK — localhost:5442, localhost:6432 contestan; el directo es PostgreSQL
```

Lo de abajo es lo que había hasta P16-W, y se conserva como historia.

**Desde la recurrencia 1, `npm run doctor` lo comprueba** —«Puertos de la base (INC-015)»—, que es lo
que esta ficha dejó dicho que pasaría a la segunda vez. Para cada `host:puerto` distinto de
`DATABASE_URL`, `MIGRATION_DATABASE_URL` y `PGBOUNCER_DATABASE_URL` manda el `SSLRequest` del protocolo
—ocho bytes a los que PostgreSQL y PgBouncer contestan con una letra antes de pedir credenciales— y
distingue `responde`, `rechazada` (la pila no está levantada), `cortada` y `muda` (el reenvío). Sin
autenticar y sin dependencias: `node:net`.

Guardián, con el reenvío roto de verdad y con puertos cerrados a propósito:

```
[ FALLO]  Puertos de la base (INC-015)   localhost:5432 cortada
                                          -> Reenvio de Docker desincronizado: docker compose down && docker compose up -d db pgbouncer
[ FALLO]  Puertos de la base (INC-015)   localhost:5999 rechazada · localhost:5998 rechazada
                                          -> La pila no esta levantada: docker compose up -d db pgbouncer
[  OK  ]  Puertos de la base (INC-015)   localhost:6432 contestan
```

**Lo que no cubre, dicho:** la primera variante de esta ficha, el 5432 que llega a PgBouncer.
PgBouncer también contesta el `SSLRequest`; distinguirlos exige autenticarse, y eso ya es una prueba de
integración, no un informe de entorno. Para esa variante sigue valiendo el `grep "login attempt"` de
arriba.

**Antes de la recurrencia 1 no se automatizó**, y conviene decir por qué en vez de fingir lo contrario. Una comprobación de arranque que verifique «quién responde en 5432» es una consulta y tres líneas —`SELECT version()` y comprobar que no viene de un pooler—, pero con **un solo caso** escribirla es la abstracción especulativa que `OPTIMIZACION.md` §1 prohíbe.

**La regla operativa, que es lo que queda:** ante cualquier error de conexión que **nombre a pgbouncer desde una cadena que no apunta a 6432**, o ante `ETIMEDOUT` contra la base con el contenedor sano, **recrea la pila antes de revisar la configuración**. La configuración no había cambiado.

Si vuelve una segunda vez, la comprobación se escribe: pasa a ser un caso de `npm run doctor`, que ya existe para exactamente esta clase de diagnóstico de entorno.
