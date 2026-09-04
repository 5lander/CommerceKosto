# ADR-002: ORM — Prisma 7.10.0 frente a Drizzle para RLS multi-tenant

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-08-27 |
| Paquete | P0 |
| Decisores | Usuario / Claude Code |

## Contexto

`CLAUDE.md` §4.1 exige **tres barreras** de aislamiento entre companies, y las dos primeras dependen de qué puede hacer el ORM:

- **Barrera 1 — la base.** `company_id` en toda tabla, RLS *deny-by-default*, `FORCE ROW LEVEL SECURITY`, y un rol de aplicación que no sea superusuario ni dueño de las tablas.
- **Barrera 2 — la capa de transacción-con-tenant.** RLS necesita que el tenant se fije **por transacción** (`SET LOCAL` / `set_config(..., true)`). El ORM usa un pool: sin una capa que abra transacción interactiva y fije el tenant **dentro** de ella, una consulta puede ejecutarse en una conexión sin tenant fijado, y eso es una fuga.

`DECISIONES.md` D12 dejaba la elección abierta con una condición explícita: **si Prisma ya soportaba RLS de forma nativa, había que parar y reconsiderar.** La verificación de ADR-001 la resolvió.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| **Prisma 7.10.0 (estable)** | Migraciones versionadas con historial, tipado fuerte, `driver adapters` (`@prisma/adapter-pg`), ecosistema y documentación amplios | No sabe declarar políticas RLS: van como SQL manual en las migraciones |
| **Prisma 8 (RC)** | **Sí** trae RLS declarativo nativo (`@@rls`, `policy_select`) | Es Release Candidate, **sin página de documentación de RLS**, y con aviso oficial de que su comportamiento puede cambiar. Y cubre la Barrera 1, **no la Barrera 2** |
| **Drizzle** | Mantiene `pgPolicy` y RLS de forma declarativa | Su documentación de RLS describe la API de la **1.0 RC**, no la de la estable. Tampoco resuelve la Barrera 2 |

## El hallazgo que decidió

**En ninguna versión de Prisma —ni en la 8 RC— existe una API para fijar el tenant por transacción.** El único patrón que Prisma documenta es una extensión de cliente con `set_config(..., TRUE)` que lleva **descargo explícito de no ser apta para producción**. Drizzle está en la misma situación.

Es decir: el RLS nativo habría ahorrado escribir las políticas, que es la parte fácil y la que además queda **mejor** en SQL manual —`FORCE ROW LEVEL SECURITY`, políticas restrictivas, *deny-by-default* completo, nada de lo cual está documentado como expresable desde la PSL de Prisma 8—. Lo que no habría ahorrado es la Barrera 2, que es la parte difícil y la que hay que escribir a mano en cualquiera de las tres opciones.

Se ejecutó la parada que exigía D12. **El usuario decidió mantener Prisma.**

## Decisión

**Prisma 7.10.0, con la versión fijada exacta en `package.json` (sin `^` ni `~`), y las políticas RLS como SQL manual dentro del bloque `-- MANUAL:` de cada migración.**

Tres consecuencias operativas que forman parte de la decisión:

1. **`audit:migrations` M6 hace imposible olvidar una política.** Una migración que crea una tabla sin `ENABLE` + `FORCE` + al menos una `POLICY` rompe el build. La lista de tablas exentas está vacía y debe seguir así.
2. **El CLI y el runtime usan credenciales distintas.** `prisma.config.ts` clava el CLI a `MIGRATION_DATABASE_URL` (`costeo_migrator`, dueño de las tablas); el runtime recibe su cadena por parámetro en `PrismaConnection` y se conecta como `costeo_app`. El esquema de entorno **rechaza el arranque** si esa cadena trae otro usuario.
3. **La versión va exacta por una trampa real:** el dist-tag `latest` de npm apunta a `8.0.0-rc.12`. Un `npm install prisma` sin versión instala un Release Candidate.

## Consecuencias

- Se gana: expresividad completa en las políticas, migraciones reversibles verificadas (ADR-004) y un ORM estable con soporte de `driver adapters`.
- Se sacrifica: las políticas no viven junto al modelo en `schema.prisma`, sino en las migraciones. El coste real de eso es que hay que leer dos archivos para saber qué protege una tabla; `audit:migrations` compensa impidiendo que falte.
- **Qué lo revertiría:** que Prisma 8 llegue a GA **y** publique documentación de RLS **y** —lo decisivo— ofrezca una API soportada para fijar el tenant por transacción. Las tres cosas, no una. Mientras falte la tercera, cambiar de versión no cambia nada de lo que importa.
- Nota de compatibilidad: en P0 se usa el generador `prisma-client-js` y no el nuevo `prisma-client`, por razones de compilación explicadas en el propio `schema.prisma`. Ese cambio entra en la misma reevaluación.
