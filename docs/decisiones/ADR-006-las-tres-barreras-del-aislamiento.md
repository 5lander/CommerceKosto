# ADR-006 — Las tres barreras del aislamiento multi-tenant

| Campo | Valor |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-04 |
| **Paquete** | P1 |
| **Sustituye a** | — |
| **Relacionada con** | ADR-001 (versiones), ADR-002 (ORM), DECISIONES.md D12 |

---

## Contexto

CLAUDE.md §4.1 exige **tres barreras independientes** de aislamiento entre companies: si una falla, las otras dos siguen de pie. P1 es el paquete donde dejan de ser un párrafo y pasan a ser código, esquema y pruebas.

D12 —la elección de Prisma frente a Drizzle— quedó aceptada en P0 **con cuatro condiciones**. Este ADR registra cómo se implementó cada barrera y da por verificadas las cuatro.

---

## Decisión

### Barrera 1 — La base de datos

Es la única garantía real: se sostiene aunque el código de aplicación falle.

| Elemento | Cómo queda |
|---|---|
| `company_id` en toda tabla de negocio | 14 tablas nuevas; las que no lo llevan son catálogos y `login_attempt`, con su razón escrita al lado |
| RLS `ENABLE` + `FORCE` | En **todas**, sin excepción. `audit:migrations` M6 lo exige y su lista de exentas está vacía |
| Deny-by-default | La política se crea en la misma migración que la tabla, antes de la primera fila |
| Rol de aplicación | `costeo_app`: no superusuario, no dueño de las tablas, sin `CREATE`, sin `BYPASSRLS` |
| Roles distintos para migrar y para servir | `costeo_migrator` y `costeo_app`, verificado por prueba |

`USING` y `WITH CHECK` van **los dos** en cada política de tenant. No es redundancia: `USING` filtra lo que se lee, `WITH CHECK` valida lo que se escribe. Sin el segundo, la aplicación podría insertar filas con el `company_id` de otro tenant —no las vería después, pero las habría escrito.

**`REVOKE INSERT ON company FROM costeo_app`.** Dar de alta un tenant es del back office (P11). Sin `INSERT`, ninguna ruta puede fabricarse una company aunque el código se equivoque.

### Barrera 2 — La capa de transacción-con-tenant

Un único archivo, `shared/infrastructure/persistence/tenant-transaction.ts`, abre una transacción interactiva y fija el tenant **dentro** de ella con `set_config('app.company_id', $1, TRUE)`. El `TRUE` significa «local a la transacción»: al terminar, el valor desaparece con ella.

Las políticas se apoyan en `current_company()`, una función `STABLE` que devuelve `NULL` cuando nadie fijó el tenant. De ahí que `company_id = current_company()` sea `NULL`, que no es `TRUE`, y **ninguna fila pase el filtro**:

> Un caso de uso que olvida la capa de tenant devuelve **cero filas**, nunca las filas de otro tenant.

Eso lo garantiza PostgreSQL, no el ORM. Y hay una prueba de integración que lo fija.

### Barrera 3 — El origen del tenant

El tenant sale de la sesión y **solo** de ahí:

- `SesionGuard` está registrado como `APP_GUARD`, así que corre en **toda** ruta. Se salta únicamente donde hay un `@Publico()` explícito, y esa lista se lee con `grep -rn "@Publico" apps/api/src`. Hoy son tres marcas: el controlador de salud (`/health` y `/ready`), el login y la activación de una invitación.
- Ningún esquema de entrada acepta `companyId`. Todos son `.strict()`, así que mandarlo no se ignora: devuelve 400.
- El contexto resuelto viaja en un `WeakMap` indexado por la petición, no en una propiedad pegada al `request`: evita traer los tipos de express, que declaran `any` dentro.

---

## Las cuatro condiciones de D12 — verificadas

| # | Condición | Estado | Dónde se comprueba |
|---|---|---|---|
| 1 | Envoltorio único de transacción-con-tenant | ✅ | `tenant-transaction.ts`; es el único archivo que toca el cliente crudo |
| 2 | Regla de `audit:forbidden` que impida usar el cliente fuera | ✅ | `tools/audit/rules/tenant.rules.mjs`, tres reglas |
| 3 | Prueba de dos tenants que falla si el envoltorio se omite | ✅ | `test/integracion/aislamiento-entre-companies.spec.ts` |
| 4 | **PgBouncer en modo transacción, probado empíricamente** | ✅ | `test/integracion/pgbouncer.spec.ts` |

### Sobre la cuarta, que era la que podía reabrir la elección de ORM

En modo transacción, PgBouncer devuelve la conexión al servidor **en cuanto termina cada transacción** y se la entrega al siguiente cliente. Si el tenant se fijara con un `SET` de sesión, quedaría pegado a esa conexión y el siguiente cliente —de otra company— lo heredaría: una fuga entre tenants sin una sola línea de código equivocada.

Se levantó **PgBouncer 1.25.2 con `default_pool_size = 1`** —una sola conexión al servidor, de modo que la reutilización no es probable sino segura— y se comprobó con dos clientes distintos:

- La aplicación funciona a través del pooler.
- Las sentencias preparadas de Prisma no rompen, con `max_prepared_statements = 100`.
- Un cliente que consulta **sin tenant** sobre la conexión reutilizada ve cero filas.
- Alternar dos companies diez veces, en serie y en paralelo, nunca cruza datos.

**Y se comprobó que la prueba mide algo.** Cambiando el `TRUE` de `set_config` por `FALSE`, la prueba falla: el segundo cliente ve la fila del primero. Un detalle que conviene conocer: al deshacer el cambio, **la prueba seguía fallando hasta reiniciar PgBouncer**. El tenant filtrado no vivía en la aplicación sino en la conexión que el pooler guarda, y sobrevivió al reinicio del proceso entero. Una fuga así no se limpia reiniciando la API.

Configuración fijada, según ADR-001: `pool_mode = transaction`, `max_prepared_statements > 0`, **sin** `?pgbouncer=true` (Prisma ya no lo recomienda desde PgBouncer 1.21.0), y conexión **directa** para el CLI de migraciones.

---

## Las tres lecturas sin tenant, y por qué son exactamente tres

Hay tres momentos en que el sistema debe leer **antes** de saber el tenant. Los tres se resuelven con una función `SECURITY DEFINER` con la forma exacta del hueco: se entra por una clave que solo tiene el interesado, sale una fila, y no admiten ningún otro filtro.

| Función | Cuándo | Se entra por |
|---|---|---|
| `auth_lookup(email)` | Login: el tenant se **deduce** de quién entra | el correo |
| `session_lookup(token_hash)` | Cada petición: la Barrera 3 resuelve la sesión | el hash del token |
| `invitation_lookup(token_hash)` | Activación: quien llega por el enlace aún no es nadie | el hash del token |

Las tres llevan `SET search_path = pg_catalog, public`, obligatorio en toda función `SECURITY DEFINER`: sin él, quien pueda crear objetos en un esquema del `search_path` secuestra los nombres que la función resuelve. Y las tres tienen `REVOKE EXECUTE ... FROM PUBLIC` con `GRANT` solo a `costeo_app`.

**Que sean tres, y que se cuenten, es parte de la decisión.** Cualquier cuarta función de esta forma merece la misma discusión que estas tres.

---

## Decisiones de sesión

| Decisión | Valor | Por qué |
|---|---|---|
| Formato del token | Opaco, 32 bytes del CSPRNG, `base64url` | 256 bits; no hay diccionario de tokens que probar |
| En la base | **Solo el hash** (SHA-256) | Un volcado de `session` no permite suplantar a nadie |
| Por qué SHA-256 y no Argon2 | El token no se adivina probando | Argon2 costaría 64 MiB **por petición**: denegación de servicio autoinfligida |
| Vida absoluta | 12 h | Un turno. Acota el daño de un token robado que se mantiene vivo usándolo |
| Inactividad | 4 h | El producto se usa de pie, en cocinas, en turnos largos con interrupciones. Media hora produce contraseñas en un papel, no seguridad |
| Refresco de `last_seen_at` | Como mucho cada 5 min | Escribirlo en cada petición multiplicaría las escrituras para ganar una precisión que nadie usa |
| Transporte | Cookie `HttpOnly; SameSite=Strict; Path=/`, `Secure` en producción | `SameSite=Strict` es la defensa CSRF: no hay petición cruzada que lleve credencial |
| `Secure` desde configuración, no desde el socket | `config.isProduction` | Con TLS terminado en un proxy, `socket.encrypted` es `false` en producción: decidirlo por el socket quitaría el `Secure` justo donde hace falta |
| Rotación | Cada login abre una sesión nueva | Corta la fijación de sesión (SEGURIDAD.md §2.2) |
| Cambio de contraseña | Revoca **todas**, la propia incluida | Salvar «la buena» sería decidirlo con datos que el atacante controla |

### Lo que se aplaza, dicho en voz alta

SEGURIDAD.md §2.2 pide además **«vida corta + refresh rotativo con detección de reuso»**. P1 no lo implementa, y la razón es que con sesiones opacas validadas contra la base **en cada petición** la propiedad que compra la rotación de refresh —detectar que una credencial de larga vida fue robada— se obtiene por otra vía: el servidor puede revocar al instante, ve `last_seen_at`, y suspender un usuario o una company surte efecto en la siguiente petición sin esperar a que caduque nada.

**Riesgo residual, sin adornos:** un token de sesión robado sirve hasta que caduque por inactividad (4 h) o de forma absoluta (12 h), salvo que alguien lo revoque. La rotación con detección de reuso reduciría esa ventana.

**Se reevalúa en P12**, cuando exista el frontend: antes de eso no hay cliente que pueda almacenar y rotar un refresh token, y construir el mecanismo sin su consumidor sería especulación (OPTIMIZACION.md §1).

---

## La excepción de `audit:deps`

`npm audit` reporta cuatro vulnerabilidades altas, **las cuatro por el CLI de Prisma**: `mysql2` —que empaqueta drivers de todas las bases, y este proyecto usa PostgreSQL— y `deepmerge-ts` vía `@prisma/config`. Se verificó la cadena: `@prisma/client`, el que sí viaja a producción, depende únicamente de `@prisma/client-runtime-utils` y no arrastra ninguna.

`npm audit fix --force` degradaría Prisma a 6.19.3, contra ADR-001.

`audit:deps` acepta los cuatro avisos **uno a uno, con su motivo y su fecha de revisión**, y rompe el build ante cualquiera que no esté en la lista. El criterio para entrar, y no hay otro: **la dependencia no llega a la imagen de producción**. AUDITORIA.md C26 lo contempla explícitamente («`npm audit` en verde o excepción con ADR»); esta es la excepción y este es el ADR.

Un `npm audit --audit-level=high` a secas habría quedado en rojo permanente, y una comprobación que siempre falla acaba fuera del pipeline — o peor, ignorada, y entonces deja de avisar de lo nuevo.

**Se revisa con la evaluación de Prisma 8 (ADR-002).** `audit:deps` además avisa cuando una excepción ya no hace falta.

---

## Alternativas consideradas

| Alternativa | Por qué no |
|---|---|
| RLS declarativo nativo de Prisma (`@@rls`) | Solo existe en Prisma 8, que es Release Candidate, sin documentación de RLS. Y cubre la Barrera 1, no la Barrera 2 (ADR-002) |
| Client Extension de Prisma para fijar el tenant | Es el único patrón que Prisma documenta y lleva descargo explícito de no ser apto para producción |
| Vista con `security_invoker = off` en lugar de `auth_lookup` | Expondría **todos** los hashes de contraseña a la aplicación con un `WHERE` arbitrario. La función devuelve una fila de un correo y no se puede enumerar con ella |
| `Authorization: Bearer` además de la cookie | Duplica la superficie y reabre el CSRF que `SameSite=Strict` cierra: una cabecera la pone quien hace la petición |
| Contadores anti fuerza bruta en Redis | Decisión del usuario: en PostgreSQL, para que **el bloqueo sobreviva a un reinicio**. Con un almacén volátil, un flush levanta todos los bloqueos activos sin que nadie se entere. Redis entra en P15 |
| `cookie-parser` | Quince líneas contra una dependencia más. OPTIMIZACION.md §1 |

---

## Consecuencias

**Buenas**

- El aislamiento no depende de que nadie se equivoque: se sostiene en PostgreSQL.
- La autorización es deny-by-default: una ruta nueva está protegida sin que nadie se acuerde de protegerla.
- Los permisos son capacidades, no roles escritos en los endpoints: cambiar qué puede un rol es una fila en `role_permission`, no un despliegue.
- El sistema se levanta y se prueba de punta a punta —invitación incluida— sin una sola credencial real.

**Malas, o al menos incómodas**

- Tres funciones `SECURITY DEFINER` son tres puntos que hay que revisar en cada auditoría de seguridad. Están inventariadas arriba.
- El pooler pasa a ser parte del entorno de pruebas: `npm run db:up` levanta db **y** pgbouncer, y la prueba de PgBouncer **falla** —no se salta— si no está. Es deliberado: una prueba de seguridad que se salta a sí misma es la sexta variante de INC-007.
- Los casos de uso se construyen con `useFactory` y un objeto de dependencias inyectado por propiedad, porque `application` no puede importar NestJS y el límite son tres parámetros. Es más ceremonia en el módulo a cambio de que cada caso de uso se pueda construir a mano en una prueba, con dobles y sin contenedor.

---

## Referencias

- CLAUDE.md §4.1, §4.4, §4.5 · SEGURIDAD.md §2, §3, §10 · DECISIONES.md D12
- `apps/api/prisma/migrations/20260904023411_p1_iam/migration.sql` — bloque `MANUAL`
- `apps/api/test/integracion/pgbouncer.spec.ts`
- `docs/incidencias/INC-010`, `INC-011`
