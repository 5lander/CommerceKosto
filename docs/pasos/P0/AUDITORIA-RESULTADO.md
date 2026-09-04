# P0 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-08-27 | Claude Code | `P0: Fundación del repositorio` |

```
AUDITORÍA P0

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30  (13 aplican en P0; el resto documentado como "aún no aplica")
D. Base de datos     ✅ D1-D13  · sin consultas de negocio todavía
E. Reglas de negocio ✅ E1-E23  (solo E22 aplica en P0)
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 174 pruebas en verde
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

EXPLAIN ANALYZE: — no aplica. P0 no tiene consultas de negocio.
```

> **Criterio de esta auditoría.** Un punto marcado «— aún no aplica» lleva **por qué** y **desde qué paquete** aplica. Ninguno se omite y ninguno se da por bueno sin evidencia. Donde la evidencia es una prueba, se nombra el archivo; donde es una salida de herramienta, está en `evidencia/`.

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `dependency-cruiser` reglas `domain-no-importa-application`, `domain-no-importa-infrastructure`, `domain-sin-node-modules` y `domain-sin-nucleo-de-node`, todas con `severity: error` y `tsPreCompilationDeps: true` (sin esto, un `import type` sería invisible). Única excepción: `decimal.js` en `shared/domain/decimal/`, ADR-003 |
| A2 | ✅ | Regla `application-no-importa-infrastructure` + `application-sin-framework`. Los tres puertos son interfaces puras |
| A3 | ✅ | Revisión de código. La única lógica en infraestructura es cableado: elección de adaptador por selector, mapeo de excepción a `{ code, message }`, sonda de salud |
| A4 | ✅ | `PrismaAuditLogRepository`, `DatabaseHealthIndicator`, `TimeoutInterceptor` y `PrismaConnection` reciben todo por constructor. Ningún cliente se instancia dentro de una regla |
| A5 | — **aún no aplica** | `catalog` llega en P2. La regla de `dependency-cruiser` que lo hace cumplir se escribe con las tablas |
| A6 | ✅ | **Criterio arquitectónico del proyecto.** 128 pruebas unitarias corren con PostgreSQL apagado, y `guardia-sin-base.ts` lo hace cumplir: si una prueba de `unit` abre un socket al 5432, falla. Verificado en el guardián nº 11 |

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B1 | ✅ | `audit:forbidden`, reglas `no-any`, `no-ts-ignore`, `no-eslint-disable`. Única excepción: `@ts-expect-error` en `*.type-contract.ts`, que es autoverificable |
| B2 | ✅ | `tsc -p apps/api` y `tsc -p tools`, con `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` y siete opciones más |
| B3 | ✅ | ESLint con `--no-inline-config` y `--max-warnings=0` |
| B4 | ✅ | `audit:complexity` con `max-lines-per-function: 40` duro. Pase informativo a 20 en `eslint.preferencias.config.mjs` |
| B5 | ✅ | `max-depth: 3`. Guardián nº 6 |
| B6 | ✅ | `max-params: 3`. `dividir()` recibe objeto de parámetros por esto mismo |
| B7 | ✅ | `no-magic-numbers` con `ignore: [0, 1, -1]`. Los archivos cuyo trabajo **es** nombrar números (`escalas.ts`, `constantes.ts`) están exceptuados con su justificación al lado |
| B8 | ✅ parcial | `Money`, `Ratio`, `Count`, `Quantity`, `UnidadDeUso`, `Escala` existen y son nominales. `CompanyId`, `LocationId`, `ItemId`, `ProductId` llegan con sus entidades en P1–P4 |
| B9 | ✅ | `ImporteCapturadoInvalidoError`, `ConteoInvalidoError`, `UnidadIncompatibleError`, `InvalidEnvironmentError`, `ExternalServiceFailure`. `only-throw-error` en error |
| B10 | ✅ | `no-empty` con `allowEmptyCatch: false` en `src/`. Los tres `catch {}` del tooling llevan comentario explicando qué se ignora y por qué |
| B11 | ✅ | Revisión de código; `no-marcador-pendiente` cubre `TODO`/`FIXME`/`XXX`/`HACK` |
| B12 | ✅ | Único límite externo en P0: las variables de entorno. Validadas por Zod, y la aplicación **no arranca** si fallan |

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1 | ✅ | `audit_log` tiene `company_id`. Nullable a propósito: el catálogo de §10 incluye eventos sin tenant |
| C2 | ✅ | `ENABLE` + `FORCE ROW LEVEL SECURITY` + política, **en la misma migración que crea la tabla**. `audit:migrations` M6 lo hace obligatorio y su lista de exentas está vacía. Guardián nº 10 |
| C3 | — **aún no aplica** | No hay sesiones ni endpoints con tenant. Desde P1 |
| C4 | — **aún no aplica** | No hay acceso por ID. Desde P1 |
| C5 | — **aún no aplica** | No hay recetas. Desde P4 |
| C6 | — **aún no aplica** | No hay rol `BODEGA`. Desde P1; el patrón de prueba sobre respuesta cruda se instala allí |
| C7 | ✅ | `no-sql-interpolado` y `no-sql-concatenado` (`$queryRawUnsafe` prohibido). Todas las consultas de las pruebas usan `$1, $2, …` |
| C8 | — **aún no aplica** | No hay contraseñas de usuario. `argon2` se aplazó a P1 por YAGNI |
| C9 | — **no aplica** | No hay webhooks entrantes en el alcance (SEGURIDAD.md §6). Se reactiva sin excepción el día que se añada uno |
| C10 | 🟡 cableado, sin ruta | `ThrottlerGuard` global registrado en `AppModule`. `/health` y `/ready` llevan `@SkipThrottle` a propósito: las sondea el orquestador cada pocos segundos. **No hay prueba porque no hay ruta protegida**; `security/bruteforce.test` es de P1 según SEGURIDAD.md §11 |
| C11 | ✅ | `audit:secrets` sobre todo el repositorio. `.env` en `.gitignore` + regla `sin-env-versionado`. Guardián nº 9 |
| C12 | — **aún no aplica** | No hay líneas de receta ni precios. Desde P3/P4 |
| C13 | ✅ | `errorResponseFor`: los 4xx conservan su mensaje, los **5xx no lo revelan**. Ocho pruebas, incluida una que verifica que no salen `ECONNREFUSED`, el nombre de tabla ni el puerto |
| C14 | ✅ | `redact` de pino elimina `authorization`, `cookie` y `set-cookie`. `detail` de `audit_log` acepta solo escalares, por tipo |
| C15 | ✅ | Igual que C7. No hay `ORDER BY` dinámico todavía |
| C16 | — **aún no aplica** | No hay login. Desde P1 |
| C17 | — **aún no aplica** | Desde P1 |
| C18 | — **aún no aplica** | No hay DTO de entrada. El esquema de entorno sí rechaza valores fuera de su enumeración |
| C19 | ✅ | **18 pruebas de integración.** HSTS, CSP con nonce distinto por respuesta, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store`. Comprobadas también **sobre un 404**. Guardián nº 8 |
| C20 | — **aún no aplica** | Desde P1 |
| C21 | — **aún no aplica** | Desde P10 |
| C22 | ✅ | No existe ninguna llamada saliente. `FakeMailer` y `FakeFileStorage` no salen del proceso |
| C23 | — **aún no aplica** | No hay firmas ni secretos que comparar |
| C24 | ✅ | No se serializa ninguna entidad. Las dos rutas devuelven la forma de terminus y el filtro de error devuelve `{ code, message }` y nada más — hay una prueba que comprueba que **las claves son exactamente esas dos** |
| C25 | ✅ | Tres capas: `statement_timeout` 15 s, `idle_in_transaction_session_timeout` 10 s y `lock_timeout` 3 s **en el rol**; `TimeoutInterceptor` en la petición; `healthcheck` con `start_period` en el compose |
| C26 | ✅ | `npm audit --audit-level=high` en el workflow de CI |
| C27 | ✅ | `security/db-roles` (9), `security/append-only` (14), `security/sec-headers` (18). Los tres que SEGURIDAD.md §11 marca «desde P0» |
| C28 | ✅ | El catálogo de §10 está sembrado en la migración, y `PrismaAuditLogRepository` implementa el puerto. En P0 solo hay eventos de sistema |
| C29 | — **aún no aplica** | Desde P1 |
| C30 | ✅ | **Append-only en tres capas, con prueba por capa.** La que importa: la **dueña de la tabla** tampoco puede borrar — la para el trigger de sentencia. Consultar el log también estará auditado desde P11, cuando exista quien lo consulte |

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | `20260827081537_p0_audit_log` con su `down.sql`. `migrate:verify` demuestra que revierte: base limpia == tras el down, e ida == `up → down → up`. Guardián nº 10. **Corregido durante esta auditoría**: el script fallaba porque `psql -c` no sustituye variables (INC-009); la escalera pasa los cuatro pasos con la salida de esta corrida, no con el recuerdo de otra |
| D2 | ✅ | `audit_log_at_no_es_futuro`, `audit_log_actor_coherente`, `NOT NULL` en `correlation_id`. Tres pruebas de integración |
| D3 | ✅ | Tres claves foráneas a los catálogos. La de `company_id` llega en P1 con `ON DELETE RESTRICT` — **jamás `CASCADE`** |
| D4 | ✅ | `timestamptz` en `at`. Sin columnas de dinero todavía; el contrato `numeric(24,12)` está fijado por `ALMACENAMIENTO` y verificado por aserción de catálogo en `migrate:verify` |
| D5 | ✅ | Tres tablas de catálogo, ningún `enum` nativo. Un enum nativo exige migración con bloqueo para añadir un valor, y este catálogo crece cada paquete |
| D6 | ✅ | Dos índices, los dos con consumidor concreto en P11. **Ningún índice sin consulta que lo justifique** |
| D7 | — **aún no aplica** | No hay índice compuesto todavía. Desde P1 |
| D8 | — **no aplica** | P0 no tiene consultas de negocio. La única del runtime es `SELECT 1` en la sonda de `/ready` |
| D9 | ✅ | No hay bucles con consultas dentro |
| D10 | ✅ | Regla `no-select-star`, extendida a `prisma/migrations/**/*.sql` y `docker/**/*.sql` |
| D11 | — **aún no aplica** | No hay listados paginados. Desde P2 |
| D12 | ✅ | Las agregaciones de las pruebas (`count(*)`) van en SQL |
| D13 | ✅ | No hay transacciones con llamadas externas dentro |

---

## E. Reglas de negocio

| # | Resultado | Regla | Evidencia |
|---|---|---|---|
| E1–E3 | — **aún no aplica** (P1) | R1 | La Barrera 1 ya está verificada: 9 pruebas contra la base real |
| E4–E6 | — **aún no aplica** (P6) | R2, R3 | El mecanismo append-only ya está probado sobre `audit_log`; `inventory_movement` lo reutiliza |
| E7 | — **aún no aplica** (P5) | R4 | **CC-004 no se pudo extraer del Excel**: las 293 líneas de T3 están todas en base EP. Se construye en P5 |
| E8, E9 | — **aún no aplica** (P3) | R5 | — |
| E10 | — **aún no aplica** (P5) | R6 | — |
| E11 | ✅ **anticipado** | R7 | **Mini-conciliación con tres productos reales del Excel**, con los valores que `V_COSTEO` ya tenía calculados. `ROUND(diff, 2) = 0.00`, más un canario en `1e-6` que se rompe cinco órdenes de magnitud antes que el contrato |
| E12, E13 | — **aún no aplica** (P1, P7) | R8 | — |
| E14 | — **aún no aplica** (P4) | R9 | — |
| E15–E18 | — **aún no aplica** (P4, P6) | R10, R11 | — |
| E19 | — **aún no aplica** (P5) | R12 | — |
| E20 | — **aún no aplica** (P3) | R13 | — |
| E21 | — **aún no aplica** (P5) | R14 | — |
| E22 | ✅ | R6/R7 | **Aplica desde P0 y está cubierto en seis frentes**: marca nominal, ningún constructor acepta `number`, `valueOf()` lanza, `no-decimal-literal-en-dominio`, `no-coercion-numerica-en-dominio` y `no-as-unknown-as`. El contrato de tipos lo afirma en tiempo de compilación |
| E23 | — **aún no aplica** (P9) | R2 | — |

**Hueco conocido y documentado:** TypeScript permite los operadores relacionales entre operandos del mismo tipo, así que `precioA > precioB` **compila**. En ejecución lanza, y hay una prueba que lo fija. La mitigación preventiva es que la API de comparación está completa: la vía legal existe y es más cómoda que la ilegal.

---

## F. Frontend

**— No aplica.** El workspace `apps/web` llega en P12. Los puntos F1–F9 se auditan allí.

Lo que sí se decidió ya y afecta al frontend: **cero lógica de negocio en él** (CLAUDE.md §10), reforzado por el hallazgo de ADR-001 de que Next.js entrega cambios rompedores como releases semver-**minor** durante su Maintenance LTS.

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | **174 pruebas en verde.** 128 unitarias (1,8 s) + 46 de integración (3,3 s) |
| G2 | ✅ | 98 pruebas sobre el dominio decimal y monetario |
| G3 | ✅ | El proyecto `unit` corre con la base apagada, y `guardia-sin-base.ts` lo hace cumplir |
| G4 | — **aún no aplica** (P1, P6) | Lo que sí está: aislamiento a nivel de rol de base de datos, 9 pruebas |
| G5 | — **aún no aplica** (P1) | — |
| G6 | ✅ | CC-001, CC-002 y CC-003 ejecutados en `conciliacion-r7.spec.ts`. Completos desde P5 |
| G7 | ✅ | Los casos conocidos vienen del Excel de referencia, que **no está versionado y no debe estarlo**. No hay ningún otro dato de cliente en el repositorio |

```
 Test Files  9 passed (9)        unit         128 passed
 Test Files  4 passed (4)        integration   46 passed
```

---

## H. Documentación

| # | Resultado | Evidencia |
|---|---|---|
| H1 | ✅ | `CONSTRUCCION.md` con todas sus secciones |
| H2 | ✅ | `/health` y `/ready` documentadas en `docs/sistema/FUNCIONAMIENTO.md`. No llevan ficha de `docs/apis/` porque no son API de negocio: son sondas del orquestador |
| H3 | ✅ | Sección nueva «El proceso de la API por dentro», con dos diagramas Mermaid |
| H4 | ✅ | `modelo-datos.md` con el ER de `audit_log` y sus catálogos |
| H5 | ✅ | `configuracion.md` reescrito: todas las variables, los tres roles y **`costeo_shadow`** |
| H6 | ✅ | ADR-001 a ADR-005, con el índice de `docs/decisiones/README.md` renumerado |
| H7 | ✅ | `runbooks/despliegue.md` con comandos exactos |
| H8 | ✅ | Entrada de P0 en `docs/CHANGELOG.md` |
| H9 | ✅ | CC-001 a CC-003 + CC-R7, con tabla de procedencia. **CC-004 documentado como no extraíble** |
| H10 | ✅ | Nueve fichas, todas en el índice |
| H11 | ✅ | Las nueve tienen verificación o prueba **en este mismo paquete** |
| H12 | ✅ | Máximo alcanzado: 6 recurrencias (INC-007), y su prevención —la prueba del guardián— es criterio de commit |
| H13 | ✅ | Se documentó lo construido. Lo no construido se marca «aún no aplica» con su paquete |
| H14 | ✅ | Este documento |

---

## I. Optimización y eficiencia

| # | Resultado | Evidencia |
|---|---|---|
| I1 | ✅ | `knip` sin exports, archivos ni dependencias sin uso. **Verificado en los dos sentidos** — guardianes 5a y 5b |
| I2 | ✅ | `complexity: 10`, `max-depth: 3`, `max-params: 3`, `max-lines-per-function: 40` |
| I3 | ✅ | **Cero clones.** 5.008 líneas analizadas, 46 archivos. Antes de arreglar la configuración analizaba **cero** (INC-007) |
| I4 | ✅ | Tres puertos, tres implementaciones. `MailerPort` y `FileStoragePort` tienen una sola hoy, y es la exigida por CLAUDE.md §12: el falso primero, el real después |
| I5 | ✅ | No hay CPU pesada. El parser de hoja de cálculo de P10 irá en worker, según SEGURIDAD.md §5 |
| I6 | ✅ | No hay ningún `Promise.all` sobre I/O |
| I7 | ✅ | No se introdujo ninguna caché |
| I8 | — **aún no aplica** | Los presupuestos de CLAUDE.md §5 son sobre consultas de negocio, que empiezan en P2 |
| I9 | — **no aplica** | Solo P12/P13 |
| I10 | ✅ | Dos optimizaciones no triviales, las dos documentadas con su antes/después: el generador de Prisma (`tsc` agotaba el heap → compila al instante) y la clase base `ValorDecimal` (4 copias de la API de comparación → una) |

---

## La prueba del guardián — las once salidas capturadas

> **Criterio de commit, no un extra.** Un check verde sobre un repositorio recién escrito es indistinguible de un check roto. Por cada uno de los once se introdujo a mano una violación deliberada, se capturó la salida de fallo **literal**, y se revirtió.
>
> **Este paso encontró cuatro checks que no medían nada** (INC-007, casos 1, 2, 5 y 6). Sin él habrían llegado a P5 con el motor de costeo escrito encima.

Las salidas completas están en [`evidencia/`](evidencia/).

### 1. `audit:types` — `const x: string = 1`

```
apps/api/src/shared/domain/scratch/violacion.ts:1:14 - error TS2322: Type 'number' is not assignable to type 'string'.

1 export const x: string = 1;
               ~
```

### 2. `audit:lint` — `const x: any = 1` con `eslint-disable-next-line` encima

Las **dos mitades** de la defensa, porque una sola no basta:

```
--- audit:lint (con --no-inline-config: el eslint-disable NO surte efecto) ---
  2:17  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any
✖ 1 problem (1 error, 0 warnings)

--- audit:forbidden (la otra mitad: el comentario en sí) ---
audit:forbidden  FALLO — 2 infraccion(es)
  [no-any]  ... violacion.ts:2  export const x: any = 1;
  [no-eslint-disable]  ... violacion.ts:1  // eslint-disable-next-line @typescript-eslint/no-explicit-any
```

### 3. `audit:forbidden` — `as any` **en una prueba**

Se eligió una prueba a propósito: `apps/*/test/**` estaba fuera del glob del escáner hasta este paquete (INC-007, caso 3).

```
audit:forbidden  FALLO — 1 infraccion(es)

  [no-any]  El tipo `any`, en cualquiera de sus formas
     por que: `any` apaga el verificador de tipos justo donde mas hace falta. Usar `unknown` y estrechar.
     norma:   CLAUDE.md §3 · AUDITORIA.md B1
     apps/api/test/integracion/violacion.spec.ts:4  const x = { a: 1 } as any;
```

### 4. `audit:arch` — import de `infrastructure` desde `domain`

```
  error domain-no-importa-infrastructure: apps/api/src/shared/domain/scratch/violacion.ts → apps/api/src/shared/infrastructure/persistence/prisma-connection.ts

x 1 dependency violations (1 errors, 0 warnings). 53 modules, 112 dependencies cruised.

audit:arch  FALLO — hay imports que violan la regla de dependencia (CLAUDE.md §2).
```

### 5a. `audit:deadcode` — un export sin uso **sí** se marca

```
Unused exports (1)
noUsada  apps/api/src/shared/infrastructure/observability/request-context.ts:43:14
```

### 5b. `audit:deadcode` — un provider inyectado por decorador **no** se marca

El falso positivo clásico de knip con inyección de dependencias. Se comprobó con **la misma clase** en las dos situaciones. Registrada solo como `useClass` en un módulo de NestJS, nunca importada ni instanciada: **knip no la marca**. Quitando ese registro y sin tocar nada más:

```
Unused files (1)
apps/api/src/shared/infrastructure/persistence/prisma-audit-log.repository.ts
Unused exports (1)
currentRequestContext  function  ...observability/request-context.ts:38:17
Unused exported types (1)
AuditLogPort  interface  ...application/ports/audit-log.port.ts:49:18
```

Marcada cuando está muerta, no marcada cuando su única referencia es la inyección. **knip resuelve la DI de NestJS correctamente en este proyecto.**

### 6. `audit:complexity` — cinco `if` anidados

```
  5:9   error  Blocks are nested too deeply (4). Maximum allowed is 3  max-depth
  6:11  error  Blocks are nested too deeply (5). Maximum allowed is 3  max-depth

✖ 2 problems (2 errors, 0 warnings)
```

### 7. `audit:duplication` — un bloque copiado

Este es el que destapó que jscpd **no analizaba ni un archivo** (INC-007, caso 5):

```
Clone found (typescript):
 - apps\api\src\shared\infrastructure\scratch\copia-dos.ts [1:28 - 15:2] (14 lines, 192 tokens)
   apps\api\src\shared\infrastructure\scratch\copia-uno.ts [1:28 - 15:2]
```

### 8. `audit:sec-headers` — quitar `X-Frame-Options`

Falla **dos** veces, y la segunda es la que justifica que las cabeceras sean middleware de plataforma y no interceptor:

```
 FAIL  ... > en una respuesta que SI llega a un manejador > x-frame-options = DENY
AssertionError: expected undefined to be 'DENY'
 FAIL  ... > en una respuesta que NO llega a ningun manejador > un 404 tambien lleva x-frame-options
AssertionError: expected undefined to be 'DENY'
      Tests  2 failed | 16 passed | 28 skipped (46)
```

### 9. `audit:secrets` — una cadena de conexión en un `.ts`

```
apps/api/src/violacion-secreto.ts
  1:23  error  [PostgreSQLConnection] found PostgreSQL connection string: *****  @secretlint/secretlint-rule-database-connection-string
✖ 1 problem (1 error, 0 warnings, 0 infos)
```

### 10. `audit:migrations` — migración sin `down.sql`, y tabla sin RLS

```
  20990101000000_violacion_guardian
     [M1] falta down.sql (AUDITORIA.md D1 exige migracion reversible)
audit:migrations  FALLO — 1 problema(s) en 2 migracion(es)
```

Añadiendo el `down.sql` para aislar el segundo fallo:

```
  20990101000000_violacion_guardian
     [M6] "producto_falso" se crea sin RLS deny-by-default completo (ENABLE + FORCE + al menos una POLICY) en la misma migracion.
     [M9] down.sql no borra su fila de _prisma_migrations
audit:migrations  FALLO — 2 problema(s) en 2 migracion(es)
```

### 11. `audit:tests` — prueba en rojo, y guardián de la base apagada

```
--- 1. una prueba unitaria en rojo ---
 FAIL   unit  ... > una asercion falsa
AssertionError: expected 1 to be 2

--- 2. una unitaria que abre conexion a PostgreSQL ---
Una prueba del proyecto "unit" intento conectar al puerto 5432 (PostgreSQL).
CLAUDE.md §2: el dominio y los casos de uso se prueban con la base APAGADA.
```

**El segundo caso NO fallaba antes de este paquete.** El guardián interceptaba `Socket.prototype.connect` pero solo entendía las formas `(puerto, host)` y `({ port })`; `net.connect()` normaliza sus argumentos a un **array**, así que la forma más común de abrir una conexión pasaba sin ser vista. INC-007, caso 6.

### Y las tres filas que **son** los criterios de aceptación del plan

| Criterio | Resultado |
|---|---|
| Sumar `Money` con punto flotante falla en `typecheck` | ✅ `money.type-contract.ts`; cada `@ts-expect-error` afirma que la línea no compila, y `tsc` falla si alguna empezara a compilar |
| El pre-commit bloquea un commit con cualquiera de las violaciones anteriores | ✅ `.githooks/pre-commit` con `set -e` corre la cadena completa |
| El workflow de CI falla ante la misma rama | ✅ `.github/workflows/ci.yml` ejecuta el mismo `npm run audit`, sin lista duplicada de checks |

---

## Salida de `npm run audit`

```
> audit:types        tsc -p apps/api && tsc -p tools              (sin salida)
> audit:lint         eslint . --max-warnings=0 --no-inline-config (sin salida)
> audit:forbidden    audit:forbidden  OK — 22 reglas sobre 50 archivos
> audit:arch         ✔ no dependency violations found (52 modules, 111 dependencies cruised)
                     audit:arch  OK — reglas de capa respetadas y guardian verificado
> audit:deadcode     knip                                          (sin hallazgos)
> audit:complexity   eslint --config eslint.complexity.config.mjs  (sin salida)
> audit:duplication  Found 0 clones.   time: 435ms
> audit:migrations   audit:migrations  OK — 1 migracion(es) reversibles y con RLS
> audit:secrets      secretlint                                    (sin hallazgos)
> audit:sec-headers  ✓ cabeceras-de-seguridad.spec.ts (18 tests)
> audit:tests        ✓ unit (128) · ✓ integration (46)
                     audit:tests  OK — unitarias (sin base) e integracion en verde

exit 0
```

---

## Correcciones hechas durante la auditoría

| Check que falló | Qué se corrigió |
|---|---|
| `audit:duplication` | **No analizaba ningún archivo**: la clave `path` de `.jscpd.json` la ignora jscpd. Las rutas pasaron a argumentos del CLI. Al arreglarlo apareció duplicación real: la API de comparación repetida cuatro veces → clase base `ValorDecimal` |
| `audit:forbidden` | No escaneaba `apps/*/test/**`; el glob se amplió. Además `no-any` y `no-as-unknown-as` pasaron a `codigo-sin-cadenas` para no marcar el texto de un nombre de prueba |
| `audit:forbidden` (informe) | Decía «22 reglas sobre 135 archivos» contando los del repositorio, no los examinados. Ahora dice 50, que es la cifra cierta |
| `audit:secrets` | Los patrones de ignorar estaban anclados a la raíz y escaneaba `apps/api/dist/`, duplicando cada hallazgo. Y un mensaje del esquema de entorno contenía un ejemplo de cadena de conexión: se reescribió en palabras, para no tener que silenciar el check |
| `audit:tests` | El guardián de «sin base» no interceptaba `net.connect()` |
| `audit:lint` | Dos aserciones de tipo innecesarias y `no-extraneous-class` en los módulos de NestJS, que se resolvió con `allowStaticOnly` acotado a `*.module.ts` y justificado |
| — | La comprobación del rol de `DATABASE_URL` no se ejecutaba si otro campo era inválido (INC-008) |

Las cinco primeras son instancias del mismo modo de fallo y están registradas juntas en [INC-007](../../incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md). La última, en [INC-008](../../incidencias/INC-008-superrefine-no-corre-si-otro-campo-fallo.md).
