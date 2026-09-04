# ADR-0001: Versiones del stack y fechas de fin de soporte

> Architecture Decision Record. **Inmutable una vez aceptado**: si la decisión cambia, se escribe un ADR nuevo que lo reemplaza.

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-08-27 |
| Fecha de consulta de las fuentes | **2026-08-26** |
| Paquete | P0 |
| Decisores | Usuario / Claude Code |
| Resuelve | `DECISIONES.md` D2 (🔴 bloqueante del cierre de P0) |

## Contexto

`CLAUDE.md` §1 fijaba una tabla de versiones **derivada de las cadencias públicas de cada proyecto, no leída de fuente oficial**, y ordenaba confirmar seis puntos concretos antes de escribir una línea de `package.json`. El criterio de elección es explícito: **en cada caso, la versión con el soporte más largo, priorizando mantenibilidad a varios años sobre novedad**.

Este proyecto calcula el food cost con el que un dueño de restaurante fija precios. Su vida útil se mide en años, no en trimestres: una dependencia que caduca en dieciocho meses es deuda contraída el primer día.

## Método de verificación

Cada punto se investigó contra la fuente oficial del proyecto (sitio propio, repositorio GitHub oficial, registro npm) y después se sometió a una **verificación adversarial independiente**: un segundo agente reabrió cada fuente por su cuenta, sin fiarse de la cita del primero, con el mandato explícito de **refutar** la afirmación y de marcar PARCIAL ante cualquier duda razonable. Doce agentes en total, 221 llamadas a herramientas.

Ninguna afirmación de fondo resultó refutada. Las correcciones que aparecieron fueron de precisión (un recuento de páginas, una atribución de campo `engines`, una ventana de búsqueda incompleta) y están incorporadas abajo.

## Los seis puntos

### 1. Node.js — **24.20.0**

| Línea | Estado hoy (2026-08-26) | LTS desde | Mantenimiento | **Fin de soporte** |
|---|---|---|---|---|
| **24 «Krypton»** | **Active LTS** | 2025-10-28 | 2026-10-20 | **2028-04-30** |
| 26 | *Current* (26.8.1) | **2026-10-28** (futuro) | 2027-10-20 | 2029-04-30 |
| 22 «Jod» | Maintenance LTS | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 20 «Iron» | **EOL** | — | — | 2026-04-30 (ya pasó) |
| 25, 23 | EOL, nunca fueron LTS | — | — | — |

**Node 26 todavía NO ha promovido a LTS.** Su campo `lts` en `schedule.json` es `2026-10-28`, posterior a hoy. La documentación oficial es explícita: *"Production applications should only use Active LTS or Maintenance LTS releases."*

Por tanto, la línea con el soporte más largo **que ya está en LTS** es Node 24 (2028-04-30 frente a 2027-04-30 de Node 22). Se arranca en 24 y **se planifica el salto a 26 cuando promueva**, en unos dos meses — es el ítem C7 de `docs/FASE0-CHECKLIST.md`.

Dato de planificación adicional: **a partir de Node 27 el ciclo de releases pasa a ser anual y toda versión mayor promoverá a LTS** tras su fase Current de seis meses. El esquema par/impar aplica solo hasta Node 26.

Fuentes: `https://raw.githubusercontent.com/nodejs/Release/main/schedule.json` · `https://nodejs.org/en/about/previous-releases` · `https://nodejs.org/en/about/releases` · `https://nodejs.org/dist/latest-v24.x/`

### 2. PostgreSQL — **18.6**

| Línea | GA | **Fin de soporte** |
|---|---|---|
| **18** (minor vigente **18.6**, 2026-08-13) | 2025-09-25 | **2030-11-14** |
| 17 (17.11) | 2024-09-26 | 2029-11-08 |
| 16 (16.15) | 2023-09-14 | 2028-11-09 |
| 19 | **Beta 3** — GA *planificado* para septiembre de 2026 | sin fecha |

Política confirmada textualmente: *"The PostgreSQL Global Development Group supports a major version for 5 years after its initial release."*

PostgreSQL 18 es la elección con soporte más largo **entre las versiones GA**. La 19 no se fija: solo existe en beta. Cuando salga (extendería el soporte a ~nov-2031) se evalúa el salto, que en PostgreSQL es barato porque la política de 5 años da margen de sobra.

Hallazgo aprovechable: **PostgreSQL 18 trae `uuidv7()` nativo** (RFC 9562). Se usa como `DEFAULT` de respaldo, aunque el ID lo genere la aplicación.

Fuentes: `https://www.postgresql.org/support/versioning/` · `https://www.postgresql.org/docs/release/18.0/` · `https://www.postgresql.org/docs/release/18.6/` · `https://www.postgresql.org/developer/beta/` · `https://www.postgresql.org/developer/roadmap/`

### 3. NestJS — **11.2.3**

- Major vigente: **11**, versión exacta `11.2.3` (publicada 2026-08-25). No existe release estable 12.x.
- `engines`: `@nestjs/core` declara `{"node": ">= 20"}`. Rango abierto: Node 24 y 26 lo satisfacen formalmente. `@nestjs/common` y `@nestjs/platform-express` no declaran `engines`; el `package.json` raíz del monorepo (privado, no publicado) también declara `>= 20`.
- **Matiz que importa:** `engines` no equivale a *probado*. La CI oficial del repositorio ejecuta la matriz sobre Node **20.19, 22.14 y 24.1**. **Node 26 no está en la matriz de pruebas de NestJS.** Es un argumento adicional para no adelantar el salto a 26.
- **NestJS no publica ninguna política LTS ni ventana de soporte formal.** `SECURITY.md` son dos líneas sin tabla de versiones; la página `/support` trata de patrocinio económico. Confirmado por declaración del creador del proyecto.
- **NestJS 12 existe solo en fase alpha** (`12.0.0-alpha.7`, dist-tag `next`). Sus cambios centrales: migración completa de CommonJS a **ESM** (`"type": "module"` ya en `packages/core` de master), **Vitest** por defecto en proyectos ESM (el schematic CJS sigue con Jest), oxlint en lugar de ESLint, Rspack en lugar de Webpack, y Standard Schema (Zod/Valibot/ArkType) en los decoradores de ruta. La ventana declarada en el PR de la hoja de ruta («early Q3 2026») ya venció sin GA.

**Consecuencia para este proyecto:** la migración a ESM de NestJS 12 será un trabajo real. Se anticipa eligiendo **Vitest** como runner desde P0 (ver ADR-002), que es hacia donde va el framework.

Fuentes: `https://registry.npmjs.org/@nestjs/core` · `https://raw.githubusercontent.com/nestjs/nest/v11.2.3/packages/core/package.json` · `https://raw.githubusercontent.com/nestjs/nest/master/.circleci/config.yml` · `https://github.com/nestjs/nest/pull/16391`

### 4. Prisma — **7.10.0** · ⚠️ el punto que activó la parada

**La tabla de `CLAUDE.md` §1 decía «Prisma 6»: estaba desactualizada por dos majors.**

| Línea | Estado hoy | Notas |
|---|---|---|
| **7.10.0** | **Estable / GA** (2026-08-25) | Prisma 7.0.0 salió el 2025-11-19 |
| 8.0.0-rc.12 | **Release Candidate** | El changelog oficial dice: *"Scope and behavior may still change"* |

**Trampa operativa confirmada:** el dist-tag `latest` de npm apunta hoy a `8.0.0-rc.12` — un RC que ni siquiera tiene release publicada en GitHub (allí la más nueva es `rc.8`). **`npm install prisma` sin versión fijada instala un Release Candidate.** El dist-tag `prev` apunta a `7.10.0`. Los runtimes también divergen: `@prisma/client@latest` = 7.10.0, mientras que el runtime de Prisma 8 es un paquete distinto, `@prisma/orm-postgres@8.0.0-rc.8`.

**Fijar la versión exacta en `package.json` es obligatorio, no opcional.**

#### ¿Tiene Prisma soporte RLS nativo? Sí, pero solo en 8, y no resuelve lo que hacía falta

`CLAUDE.md` §1 ordenaba: *"Si el punto 4 resulta positivo (Prisma con RLS nativo), detente y avisa al usuario: cambia la decisión D12."* Se hizo. El resultado tiene tres partes:

1. **Prisma 8 sí introduce RLS declarativo nativo.** Los modelos se marcan con `@@rls` (fail-closed: *"A model marked `@@rls` stays fail-closed until you remove the marker"*) y las políticas se declaran como bloques `policy_select` en PSL, cubriendo *"every operation, not just SELECT"*. También se pueden declarar desde TypeScript (`rlsEnabled`, `policySelect`, `policyUpdate`), `db verify` comprueba que los roles nombrados existan, y `contract infer` **introspecciona** políticas ya existentes en la base y las materializa como bloques `@@rls`, distinguiendo permisivas de restrictivas.
2. **Prisma 7 (la estable) NO lo tiene.** El issue oficial que lo pide sigue abierto desde 2022-04-08, con 85 comentarios y 166 reacciones, etiquetado `status/has-stopgap`.
3. **Y lo decisivo: el RLS nativo cubre la Barrera 1, no la Barrera 2.** No existe **en ninguna versión de Prisma** una API de primera clase para fijar el contexto de tenant por transacción: ni `setContext`, ni `withContext`, ni un envoltorio documentado de `SET LOCAL` / `set_config` / `SET ROLE`. Verificado abriendo la referencia del cliente de Prisma 8, cuya superficie es de construcción de consultas y nada más.

El único patrón que Prisma documenta oficialmente para multi-tenancy con RLS es un Client Extension que envuelve cada consulta en una transacción y fija el tenant con `set_config(..., TRUE)` — exactamente el que ya describe `CLAUDE.md` §4.1. Viene con **descargo explícito de no ser apto para producción** (*"This extension is provided as an example only. It is not intended to be used in production environments"*) y con una limitación conocida: *"Because this example extension wraps every query in a new batch transaction, explicitly running transactions with `$transaction()` may not work as intended."*

**Drizzle tampoco la resuelve.** Su propia `/docs/rls` fija el tenant con `set local` dentro de una transacción.

**Decisión (confirmada por el usuario): Prisma 7.10.0, versión exacta.** Razones:

- Prisma 8 no es GA, su comportamiento puede cambiar, **no tiene página de documentación de RLS** (la URL esperada devuelve 404), se anunció como Early Access, y su documentación no cubre PgBouncer ni pooling externo. Construir la fundación de un producto de varios años sobre eso contradice el criterio de elección de este ADR.
- Las políticas RLS en SQL manual dentro de las migraciones tienen **expresividad completa**: `FORCE ROW LEVEL SECURITY`, políticas restrictivas y deny-by-default — nada de lo cual está documentado como expresable desde la PSL de Prisma 8.
- El RLS nativo **no habría eliminado el trabajo de la Barrera 2**, que es la parte cara.

Se reevalúa cuando Prisma 8 sea GA y publique documentación de RLS. La ruta de migración existe: `contract infer` puede introspeccionar nuestras políticas SQL.

#### PgBouncer — cambió la recomendación

`CLAUDE.md` §4.1 advertía que *"con PgBouncer en modo transacción, Prisma requiere `?pgbouncer=true`"*. **Ya no.** La documentación oficial dice hoy: *"We recommend **not** setting `pgbouncer=true` in the database connection string if you're using PgBouncer 1.21.0 or later."*

Lo que **no** cambió: PgBouncer debe correr en **modo transacción**; Prisma usa prepared statements, así que hay que configurar `max_prepared_statements > 0`; y los comandos del CLI necesitan una **conexión directa** separada.

Advertencia registrada: esa documentación está etiquetada como v7 y la de Prisma 8 no cubre pooling externo. La exigencia de `CLAUDE.md` §4.1 de **probar el escenario explícitamente antes de producción** sigue vigente y se cumple en P1.

#### `engines`

`prisma@7.10.0` y `@prisma/client@7.10.0` exigen `^20.19 || ^22.12 || >=24.0`. Node 24 los satisface. (`prisma@8.0.0-rc.12` exigiría `>=22.18.0`; `@prisma/orm-postgres@8.0.0-rc.8` no declara `engines` en absoluto — su requisito de Node 22.18+ existe solo como prosa en la guía de migración, no verificado por el gestor de paquetes.)

Fuentes: `https://registry.npmjs.org/-/package/prisma/dist-tags` · `https://github.com/prisma/prisma/releases` · `https://www.prisma.io/changelog/2026-07-17` · `https://www.prisma.io/changelog/2026-08-02` · `https://www.prisma.io/docs/orm/reference/error-reference` · `https://www.prisma.io/docs/orm/reference/orm-client` · `https://github.com/prisma/prisma/issues/12735` · `https://github.com/prisma/prisma-client-extensions/tree/main/row-level-security` · `https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/pgbouncer`

### 5. Drizzle ORM — verificado como contraste, **no se adopta**

- Mantiene RLS de primera clase: `pgPolicy()` y `pgRole()` existen tanto en la estable **0.45.2** (2026-03-27) como en **1.0.0-rc.4** (2026-06-27). Verificado en el código fuente, no solo en la documentación.
- **Pero `pgTable.withRLS()` no existe en la estable**: ahí es `.enableRLS()`. Y **la página oficial `/docs/rls` documenta la API de la 1.0 RC**, no la de la versión que instalarías. Quien siga la documentación al pie de la letra sobre una instalación estable llamará a una función que no existe.
- `FORCE ROW LEVEL SECURITY` —requisito explícito de `CLAUDE.md` §4.1— **no aparece documentado** en `/docs/rls`.
- `crudPolicy()` es específico del adaptador de Neon, no genérico.
- La 1.0.0 sigue en RC sin fecha de GA publicada. Sin política de LTS ni fechas EOL.
- **Y su propia documentación fija el tenant con `set local` dentro de una transacción**: elegir Drizzle no elimina la capa de transacción-con-tenant, solo mueve la declaración de políticas al esquema TypeScript.

Las tres razones de D12 (la garantía real la da PostgreSQL, la madurez de Prisma, y la integración futura con Noctis Commerce que ya usa Prisma) siguen en pie.

Fuentes: `https://orm.drizzle.team/docs/rls` · `https://orm.drizzle.team/docs/v0-v1-changes` · `https://registry.npmjs.org/drizzle-orm` · `https://raw.githubusercontent.com/drizzle-team/drizzle-orm/0.45.2/drizzle-orm/src/pg-core/table.ts`

### 6. Next.js — **16.3.3** (llega en P12)

- Versión vigente: **16.3.3** (2026-08-25). Es una release de seguridad: corrige dos RCE críticos (uno en servidores Windows, otro en la API de optimización de imágenes). La línea 15.x recibió el mismo parche como `15.5.24` el mismo día.
- `engines`: `>=20.9.0`, sin techo. React: peer `^18.2.0 || ^19.0.0`, aunque el App Router incorpora un React Canary con React 19.2.
- **La afirmación de `CLAUDE.md` §1 de que «Next.js no tiene LTS» ya no es exacta.** Existe una política de soporte formal y publicada en `https://nextjs.org/support-policy`, con dos fases —**Active LTS** y **Maintenance LTS**— y una ventana de **dos años desde el lanzamiento inicial del major**:

| Línea | Lanzamiento | Estado |
|---|---|---|
| 16.x | 2025-10-21 | **Active LTS** |
| 15.x | 2024-10-21 | **Maintenance LTS** |
| 14.x y anteriores | ≤ 2023-10-26 | **Sin soporte** |

- **La diferencia con Node.js no es la ausencia de LTS, sino su forma:** en Next.js **toda** versión mayor entra al modelo automáticamente (no hay designación selectiva ni distinción par/impar), y la ventana es fija en dos años, no ~30 meses variables.
- **Y hay un detalle que empeora el cuadro, no lo mejora:** la política dice literalmente que *"For Maintenance LTS versions, updates will land as semver-minor releases, even if they are breaking changes."* Es decir, **un cambio rompedor puede llegar en un minor** durante el segundo año de vida de la versión.

**Consecuencia obligatoria, reforzada:** cero lógica de negocio en el frontend. Todo cálculo, toda regla y toda decisión de autorización viven en el backend. El frontend debe poder reescribirse entero sin tocar el dominio. Y hay que **presupuestar el mantenimiento recurrente del frontend** (ítem C6 de `docs/FASE0-CHECKLIST.md`): un major aproximadamente anual no es opcional ni postergable indefinidamente.

Fuentes: `https://nextjs.org/support-policy` · `https://registry.npmjs.org/-/package/next/dist-tags` · `https://github.com/vercel/next.js/releases` · `https://raw.githubusercontent.com/vercel/next.js/v16.3.3/packages/next/package.json`

## Decisión

| Componente | Versión fijada | Fin de soporte confirmado |
|---|---|---|
| Node.js | **24.20.0** | **2028-04-30** |
| PostgreSQL | **18.6** | **2030-11-14** |
| NestJS | **11.2.3** | *sin política publicada* |
| Prisma | **7.10.0** (exacta) | *sin política publicada* |
| Next.js (P12) | **16.3.3** | **~2027-10-21** (2 años desde 2025-10-21) |
| TypeScript | última estable, modo estricto máximo | — |

Se fijan en `.nvmrc`, en `engines` de `package.json`, en el `Dockerfile` y en `docker-compose.yml` (imágenes por digest).

## Consecuencias

**Qué se gana**

- Base de datos con más de cuatro años de soporte por delante y sin ninguna decisión pendiente.
- Runtime en LTS activo, con la ruta de salto ya identificada y fechada.
- ORM en versión GA, sin exposición a una superficie de API que su propio proveedor declara sujeta a cambios.
- La trampa del `latest` de Prisma queda neutralizada por versión exacta.

**Qué se sacrifica o queda condicionado**

- **Node 24 vence el 2028-04-30**, poco menos de dos años. Node 26 promueve el **2026-10-28** y llega hasta 2029-04-30. El salto se planifica para cuando promueva, no antes: NestJS 11 todavía no prueba Node 26 en su CI.
- **NestJS y Prisma no publican política de soporte.** No hay dato duro que permita cumplir el criterio de «la versión con el soporte más largo» sobre esos dos. Se mitiga eligiendo el major GA vigente y siguiendo su changelog.
- **NestJS 12 será ESM.** La migración es un trabajo real, anticipado con la elección de Vitest.
- **Next.js exige un major aproximadamente anual**, con cambios rompedores posibles en minors durante el Maintenance LTS. Es un costo operativo recurrente, no un evento único.
- **Prisma 8 es una reevaluación pendiente, no un descarte.** Cuando sea GA y publique documentación de RLS, `contract infer` permite introspeccionar las políticas SQL que este proyecto escribirá a mano.

**Qué habría que hacer si esto cambia**

- Si Node 26 promueve antes de cerrar P4: no interrumpir la corrida. El salto es un paquete propio, con su ADR.
- Si Prisma 8 llega a GA con documentación de RLS: ADR nuevo que reemplace a ADR-002, evaluando si mover las políticas del SQL manual al schema. **La Barrera 2 seguirá siendo trabajo propio** salvo que Prisma publique una API de contexto de tenant.
- Si PostgreSQL 19 sale GA antes de producción: evaluar; la política de 5 años da margen y no hay urgencia.
