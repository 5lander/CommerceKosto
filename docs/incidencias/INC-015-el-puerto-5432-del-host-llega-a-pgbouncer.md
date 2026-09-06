# INC-015 — `FATAL: bouncer config error` conectando al puerto 5432, que es el de PostgreSQL directo

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-06 |
| **Paquete** | P8 (verificación posterior) |
| **Área** | despliegue · base de datos |
| **Tiempo perdido** | ~35 min |
| **Recurrencias** | 0 |

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

## Prevención

**Lo que se automatizó:** nada todavía, y conviene decir por qué en vez de fingir lo contrario. Una comprobación de arranque que verifique «quién responde en 5432» es una consulta y tres líneas —`SELECT version()` y comprobar que no viene de un pooler—, pero con **un solo caso** escribirla es la abstracción especulativa que `OPTIMIZACION.md` §1 prohíbe.

**La regla operativa, que es lo que queda:** ante cualquier error de conexión que **nombre a pgbouncer desde una cadena que no apunta a 6432**, o ante `ETIMEDOUT` contra la base con el contenedor sano, **recrea la pila antes de revisar la configuración**. La configuración no había cambiado.

Si vuelve una segunda vez, la comprobación se escribe: pasa a ser un caso de `npm run doctor`, que ya existe para exactamente esta clase de diagnóstico de entorno.
