# Seguridad del sistema — cómo está implementada

> El **estándar** está en `docs/SEGURIDAD.md`. Este archivo documenta cómo se implementó realmente, y se actualiza en cada paquete que toque auth, datos o permisos.

## Las tres barreras de aislamiento

1. **La base de datos.** RLS deny-by-default + `FORCE ROW LEVEL SECURITY` + **rol de aplicación no-superusuario y no dueño de las tablas**. Es la única barrera que no depende de disciplina de desarrollo: un superusuario ignora RLS por diseño, así que si la app se conectara como tal toda la defensa sería decorativa
2. **La capa de transacción-con-tenant.** Envoltorio único que abre transacción interactiva y fija el tenant dentro de ella. Prohibido el cliente crudo fuera. Un `SET` fuera de transacción no persiste de forma fiable entre conexiones del pool
3. **El origen del tenant.** Sale de la sesión autenticada, nunca de la petición

Las tres son independientes: si una falla, las otras dos siguen de pie.

### Roles de base de datos

| Rol | Uso | Privilegios |
|---|---|---|
| `costeo_migrator` | Migraciones (solo el CLI de Prisma) | Dueño del esquema y de las tablas. `NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT` |
| `costeo_app` | Aplicación cliente | **No superusuario, no dueño.** Sujeto a RLS. Sin `CREATE`, sin `TEMPORARY`, sin membresías. Timeouts fijados en el rol |
| `costeo_backoffice` | Back office | **No existe todavía.** El nombre está reservado; se crea en P11. Un rol con login que nadie usa es superficie de ataque sin contrapartida |

Los `DEFAULT PRIVILEGES` conceden `SELECT` e `INSERT`, **nunca `UPDATE` ni `DELETE`**: esos se conceden tabla por tabla, en la migración que la crea. El orden inverso tiene el fallo invertido — si alguien olvidara un `REVOKE`, el libro de inventario dejaría de ser append-only **en silencio**.

El detalle completo de los roles, y de la base sombra `costeo_shadow`, está en `docs/sistema/configuracion.md`. Nueve pruebas de integración lo verifican contra la base real en cada corrida.

### Nota sobre connection pooling

**Corregido en ADR-001:** Prisma ya **no** recomienda `?pgbouncer=true` a partir de PgBouncer 1.21.0. Lo que sigue siendo obligatorio es: PgBouncer en **modo transacción**, `max_prepared_statements > 0` —Prisma usa prepared statements— y una **conexión directa separada** para los comandos del CLI.

El escenario se prueba explícitamente en P1, no se asume: si el `SET LOCAL` no queda atado a la conexión que ejecuta la consulta, hay fuga entre tenants. La documentación de Prisma sobre pooling externo está etiquetada como v7 y no hay equivalente para la línea 8.

## Matriz de roles y datos

| Dato | OWNER | ADMIN | GERENTE_LOCAL | BODEGA | LECTURA |
|---|---|---|---|---|---|
| Recetas y cantidades | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Consumo teórico | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Stock teórico y diferencias | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Punto de reorden (cantidad) | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Semáforo de reposición | ✅ | ✅ | ✅ | ✅ | ✅ |
| Costos y márgenes | ✅ | ✅ | ✅ su ubicación | ❌ | configurable |
| Compras y recepción | ✅ | ✅ | ✅ su ubicación | ✅ su ubicación | ❌ |
| Conteo físico | ✅ | ✅ | ✅ su ubicación | ✅ **a ciegas** | ❌ |
| Propagar recetas | ✅ | ✅ | ❌ | ❌ | ❌ |
| Suscripción y eliminar company | ✅ | ❌ | ❌ | ❌ | ❌ |

**El filtrado se implementa como proyecciones distintas por rol en la API**, no como filtro sobre una respuesta completa.

## Back office

Conexión privilegiada que puentea RLS, con pool separado, aislada en su proceso, inalcanzable desde la app cliente. Todo acceso cross-tenant registrado con motivo obligatorio en log append-only.

**Riesgo asumido y documentado:** un fallo de autorización en el back office expone a todos los tenants a la vez.


---

## Qué está implementado a día de hoy (P0)

P0 no tiene autenticación ni datos de negocio: lo que existe es el andamiaje que las barreras necesitarán.

| Control | Estado | Dónde |
|---|---|---|
| **Barrera 1** — roles de BD separados, app no superusuario | ✅ verificado contra la base real | `docker/postgres/initdb/sql/` · 9 pruebas de integración |
| **Barrera 2** — capa de transacción-con-tenant | ⬜ P1 | Hoy `PrismaConnection` es el único sitio autorizado a construir el cliente |
| **Barrera 3** — tenant desde la sesión | ⬜ P1 | No hay sesiones todavía |
| `audit_log` append-only + RLS deny-by-default | ✅ | 14 pruebas de integración |
| Cabeceras de §4.4 en **toda** respuesta, incluidos 404 y 429 | ✅ | 18 pruebas (`audit:sec-headers`) |
| CSP estricta con nonce **distinto por respuesta** | ✅ | `http/security-headers.ts` |
| Formato único de error `{ code, message }`; los 5xx no revelan su causa | ✅ | `http/error.filter.ts` + 8 pruebas |
| `correlation_id` en toda línea de log y en la respuesta | ✅ | `observability/` |
| Timeout de petición + `statement_timeout` en el rol | ✅ | Dos capas distintas |
| Limitador de peticiones | 🟡 cableado, **sin ruta que proteger** | `/health` y `/ready` llevan `@SkipThrottle`. Su prueba es de P1 |
| Argon2id, sesiones, bloqueo por fuerza bruta | ⬜ P1 | — |
| Cifrado de campo en líneas de receta y precios | ⬜ P3/P4 | — |

### Lo que NO se hizo, y por qué

- **CORS está desactivado.** `SEGURIDAD.md` §4.4 exige lista blanca exacta y jamás `*`. En P0 no hay frontend: no habilitarlo es la opción más restrictiva.
- **No hay prueba del limitador.** No existe ninguna ruta a la que aplique. `security/bruteforce.test` es de P1, como ya dice `SEGURIDAD.md` §11. No se escribió una prueba de mentira para marcar la casilla.
