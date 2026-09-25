# INC-015 — `FATAL: bouncer config error` conectando al puerto 5432, que es el de PostgreSQL directo

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-06 |
| **Paquete** | P8 (verificación posterior) |
| **Área** | despliegue · base de datos |
| **Tiempo perdido** | ~35 min |
| **Recurrencias** | **1** |

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

## Prevención

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
