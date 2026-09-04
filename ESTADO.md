# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** P0 — Fundación del repositorio
**Fase del protocolo:** COMMIT — todo lo demás cerrado
**Último commit:** `929634b` (first commit, solo documentación)
**Fecha de última actualización:** 2026-08-27

### Dónde se retoma exactamente

P0 está **terminado y auditado**. Solo queda el commit único.

Si retomas aquí: lee `docs/pasos/P0/AUDITORIA-RESULTADO.md`, que tiene las once salidas del guardián y el estado punto por punto de la checklist. Después, `git add -A` y el commit `P0: Fundación del repositorio`.

**Hecho y verificado**

| # | Entregable | Estado |
|---|---|---|
| 1 | **ADR-001** — D2 resuelta, seis puntos verificados en fuente oficial con pasada adversarial | ✅ |
| 2 | **Corrección documental** — CLAUDE.md §1, DECISIONES.md (D2, D12), AUDITORIA.md, SEGURIDAD.md, OPTIMIZACION.md, PROTOCOLO.md | ✅ |
| 3 | **`docs/pruebas/casos-conocidos.md`** — CC-001, CC-002, CC-003 y CC-R7, extraídos del Excel | ✅ |
| 4 | **`docs/incidencias/`** — **INC-001 a INC-009**, todas con prevención automatizada, e índice | ✅ |
| 5 | Higiene: `.gitattributes` (eol=lf), `.gitignore`, `.editorconfig`, `.nvmrc` | ✅ |
| 6 | Monorepo npm workspaces + `tsconfig` en modo estricto máximo | ✅ |
| 7 | **Los once checks de `npm run audit`** — los once en verde y midiendo | ✅ |
| 8 | Hook de pre-commit vía `core.hooksPath` (cero dependencias) | ✅ |
| 9 | **`Money`, `Ratio`, `Count`, `Quantity`** + núcleo decimal y unidad de uso — **98 pruebas en verde, sin base de datos** | ✅ |
| 10 | **Mini-conciliación R7** con tres productos reales del Excel — da `0.00`, con canario | ✅ |
| 11 | **Docker Compose** con PostgreSQL 18.6 fijado por digest + los dos roles de BD | ✅ |
| 12 | **`prisma.config.ts` + `schema.prisma`** — el CLI clavado al rol migrator | ✅ |
| 13 | **Migraciones reversibles**: `migrate:new`, `migrate:down`, `migrate:verify` | ✅ |
| 14 | **Migración de `audit_log`** append-only en tres capas + RLS deny-by-default | ✅ |
| 15 | **23 pruebas de integración**: Barrera 1 y append-only, verificadas contra la base real | ✅ |
| 16 | **Aplicación NestJS**: entorno validado por Zod, `correlation_id` por `AsyncLocalStorage`, `/health` y `/ready`, cabeceras de §4.4 con nonce por respuesta, limitador, timeout, formato único de error, fakes de correo y almacenamiento, puerto de auditoría sobre `audit_log` | ✅ |
| 17 | **Los once checks en verde y midiendo**: `audit:deadcode` y `audit:sec-headers` desbloqueados y con su prueba del guardián hecha | ✅ |
| 18 | **`Dockerfile` multi-stage** (imagen fijada por digest, usuario sin privilegios, sin `npm` entre el init y el proceso) + `.dockerignore` | ✅ |
| 19 | **CI en GitHub Actions**: mismo `npm run audit`, acciones fijadas por SHA de commit, `migrate:verify`, `npm audit --audit-level=high`, y el stack completo levantado y respondiendo | ✅ |
| 20 | **La prueba del guardián: las once salidas capturadas**, en `docs/pasos/P0/evidencia/` y en `AUDITORIA-RESULTADO.md` | ✅ |
| 21 | **Documentación del paquete**: `CONSTRUCCION.md`, `AUDITORIA-RESULTADO.md`, ADR-002 a ADR-005, `docs/sistema/*` (con `costeo_shadow`), runbook de despliegue, CHANGELOG, INC-007 a INC-009 | ✅ |

**Pendiente en P0, en este orden**

| # | Entregable | Notas |
|---|---|---|
| 21 | Commit único `P0: Fundación del repositorio` | Es lo único que queda |

### Estado de los once checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | `tsc` sobre `apps/api` y sobre `tools` (JSDoc con `checkJs`) |
| `audit:lint` | ✅ | Con `--no-inline-config`: los `eslint-disable` no tienen efecto |
| `audit:forbidden` | ✅ | 22 reglas sobre 132 archivos. Desde el paso 16 escanea también `apps/*/test/**`, que estaba fuera |
| `audit:arch` | ✅ | Con autocomprobación: verifica que detecta una violación deliberada |
| `audit:deadcode` | ✅ | **Verificado en los dos sentidos**: marca un export sin uso y NO marca un provider inyectado por decorador |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | |
| `audit:migrations` | ✅ | 1 migración, verificada además por `migrate:verify` contra bases reales |
| `audit:secrets` | ✅ | |
| `audit:tests` | ✅ | 128 unitarias (sin base) + 46 de integración |
| `audit:sec-headers` | ✅ | 18 pruebas. Guardián hecho: quitar `X-Frame-Options` lo pone en rojo |

---

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | 🟡 En curso | — | — |
| P1 — IAM · tenants · ubicaciones · roles | ⬜ Pendiente | — | — |
| P2 — Catálogo · ítems · artículos · unidades | ⬜ Pendiente | — | — |
| P3 — Precios de referencia con vigencia | ⬜ Pendiente | — | — |
| P4 — Recetas · productos · combos | ⬜ Pendiente | — | — |
| P5 — MOTOR DE COSTEO ⭐ | ⬜ Pendiente | — | — |
| P6 — Inventario · libro mayor append-only | ⬜ Pendiente | — | — |
| P7 — Períodos · conteo físico | ⬜ Pendiente | — | — |
| P8 — Vistas analíticas | ⬜ Pendiente | — | — |
| P9 — Consolidado y comparativa | ⬜ Pendiente | — | — |
| P10 — Importación Excel/CSV | ⬜ Pendiente | — | — |
| P11 — Back office | ⬜ Pendiente | — | — |
| P12 — Frontend app cliente | ⬜ Pendiente | — | — |
| P13 — Frontend back office | ⬜ Pendiente | — | — |
| P14 — Capa visual | ⬜ Pendiente | — | — |
| P15 — Endurecimiento | ⬜ Pendiente | — | — |

Estados: ⬜ Pendiente · 🟡 En curso · ✅ Completado · ⚠️ Completado con pendientes

---

## Decisiones tomadas durante la construcción

> Toda decisión técnica que no estaba en el SPEC y se resolvió al implementar.

| # | Decisión | Paquete | Razón |
|---|---|---|---|
| 1 | **Prisma 7.10.0**, versión exacta, con las políticas RLS como SQL manual en las migraciones | P0 | El RLS nativo existe solo en Prisma 8, que es RC. Y no habría eliminado la Barrera 2. **Confirmada por el usuario.** ADR-001 |
| 2 | **`decimal.js` dentro de `domain`**, con excepción acotada a `shared/domain/decimal/` | P0 | **Decisión del usuario.** Mitigada con `Decimal.clone()` (inmune a la configuración global), escala explícita obligatoria en toda división, y prohibición de importarla fuera de esa carpeta. ADR-003 |
| 3 | **Vitest** como runner, con plugin SWC | P0 | La capa `domain` no tiene decoradores y corre sin transformación; NestJS 12 va hacia Vitest por defecto en proyectos ESM |
| 4 | **P0 entrega `Money`, `Ratio`, `Count` y `Quantity`. Solo `UnitCost` se aplaza a P3** | P0 | `Quantity` se adelantó **por decisión del usuario**: el criterio de aceptación de P2 exige que una conversión inválida (kg → unidades sin factor) se rechace **en el dominio**, y eso es justo lo que resuelve la unidad tipada. Si llegara en P3, P2 modelaría cantidades sin tipo y habría que retipar el catálogo después. `UnitCost` sí puede esperar: no tiene consumidor antes de P3. **Efecto: la lista blanca de knip no hizo falta** |
| 5 | **`argon2` se aplaza a P1** | P0 | No se usa hasta que haya sesiones. Instalarlo ahora sería una dependencia sin uso, y además exige `node-gyp` |
| 6 | Dos checks nuevos: **`audit:migrations`** y **`audit:sec-headers`** | P0 | La reversibilidad de migraciones (D1 de la auditoría) y SEGURIDAD.md §11 no eran verificables con los nueve originales |
| 7 | La regla de marcadores pendientes vive en `audit:forbidden`, no en ESLint | P0 | `no-warning-comments` no distingue mayúsculas, y en un proyecto escrito en español marcaría cada comentario que contenga la palabra "todo" |
| 8 | Las reglas de `dependency-cruiser` se anclan **por capa**, no por ubicación | P0 | Siguen valiendo si el código se mueve, y permiten que la autocomprobación use un fixture fuera de `apps/` |
| 9 | `audit:forbidden` enmascara comentarios (y opcionalmente cadenas) antes de buscar | P0 | La prosa que **explica** una regla contiene por necesidad lo que la regla prohíbe. Sin esto el escáner se acusa a sí mismo |
| 10 | `allowScripts` versionado en `package.json` para 4 paquetes | P0 | npm 11 bloquea los install scripts por defecto. Aprobación explícita y revisable, que es lo que pide SEGURIDAD.md §9 |
| 11 | `src/shared/application/` para puertos transversales | P0 | CLAUDE.md §2 no lo lista, pero es preferible a inventar un módulo `audit` que tampoco está |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` para no romper el entorno actual, y `.nvmrc` apunta a 24.20.0 | P0 | Nada hoy. Conviene actualizar Node antes de cerrar P0 |
| 2 | **CC-004 (base AP frente a base EP) no se puede extraer del Excel**: las 293 líneas de `T3_RECETAS` están **todas** en base `EP`. Hay que construirlo y calcular su valor esperado a mano desde SPEC §13 | P0 | **P5.** Es la regla R4, la más frágil del modelo, y quien la calcule no debería ser quien escriba después la aritmética que la verifica. Ítem B2 de FASE0-CHECKLIST |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| — | *(ninguna)* | — | — |

> La lista blanca de knip para `shared/domain/**`, que el usuario aprobó como deuda con fecha de pago en P5, **no fue necesaria**. Un export con pruebas no es código muerto para knip, así que `Money`, `Ratio`, `Count` y `Quantity` quedan cubiertos por sus propias suites. Se anota aquí para que nadie la reintroduzca por costumbre.

---

## Convenciones establecidas

| Ámbito | Convención |
|---|---|
| Estructura de módulos | `apps/api/src/modules/<modulo>/{domain,application,infrastructure}` + `src/shared/{domain,application,infrastructure}` |
| Nombres de archivo | `kebab-case.ts`, sin excepciones (`forceConsistentCasingInFileNames`) |
| Idioma | Identificadores en inglés; comentarios, mensajes de error y documentación en español (CLAUDE.md §3) |
| Imports | Sin extensión (`from './escalas'`): `module: commonjs` + `moduleResolution: node` |
| Aserciones de compilación | `*.type-contract.ts` — no se ejecutan, las verifica `tsc`. Único sitio donde se admite `@ts-expect-error` |
| Pruebas unitarias | `src/**/*.spec.ts`, corren **con la base apagada**, con guardián que lo hace cumplir |
| Pruebas de integración | `apps/api/test/integracion/**/*.spec.ts` |
| Opcionales | `\| null` explícito, nunca `?`, por `exactOptionalPropertyTypes` |
| Escalas decimales | `PRESENTACION` 2 · `ALMACENAMIENTO` 12 · `DIVISION` 12 · `MAXIMA` 30 |
| Comparar importes | API completa en el tipo (`compare`, `equals`, `lessThan`, `greaterThan`, `lessThanOrEqual`, `greaterThanOrEqual`, `isZero`, `isNegative`, `isPositive`). **Nunca** `.toNumber()` ni operadores relacionales |
| Cantidades | Siempre `Quantity` con su `UnidadDeUso`. Mezclar unidades lanza `UnidadIncompatibleError` |
| Redondeo | Medio hacia arriba (*half away from zero*), el `ROUND()` de Excel. **No** banker's rounding |
| Nombres de tablas | `snake_case` singular (`audit_log`, `inventory_movement`) |
| Nombres de migraciones | `<timestamp>_<slug>/` con `migration.sql` y `down.sql` |
| Bloques SQL manuales | `-- MANUAL: BEGIN/END` en el up, `-- MANUAL-REVERSE: BEGIN/END` en el down |
| Formato de commits | `P{n}: {nombre}` — ver `docs/PROTOCOLO.md` |

---

## Notas de contexto

- El SPEC completo está en `docs/SPEC.md`; las reglas obligatorias en `CLAUDE.md`; el protocolo en `docs/PROTOCOLO.md`; la checklist en `docs/AUDITORIA.md`
- **`docs/incidencias/README.md` ya tiene nueve fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. Cuatro son del entorno Windows; las dos últimas (INC-007, INC-008) no son de una herramienta concreta sino de **cómo se verifica**, y merecen leerse aunque no se esté diagnosticando nada
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete, no colarlo en medio de una corrida
- **P5 (motor de costeo) es el camino crítico.** Es el único componente donde un error no se ve en pantalla: produce números plausibles y equivocados que el cliente usa para fijar precios. Todo P0–P4 existe para alimentarlo
- **Cuatro checks resultaron estar mal cableados, y los cuatro se descubrieron por provocarles un fallo, no por verlos en verde:** `audit:complexity` sin el parser de TypeScript · `audit:arch` con el fixture dentro de una ruta excluida · `audit:forbidden` sin escanear `apps/*/test/**`, así que un `as any` en una prueba no lo veía nadie · `audit:secrets` con los patrones de ignorar anclados a la raíz, que reportaba dos veces cada hallazgo por escanear también el compilado
- **`audit:deadcode` está verificado en los DOS sentidos**, que es lo que importa con inyección de dependencias: marca un export sin uso, y **no** marca una clase cuya única referencia es `useClass` en un módulo de NestJS. Se comprobó con la misma clase (`PrismaAuditLogRepository`) en las dos situaciones: registrada, no la marca; sin registrar, la marca como archivo muerto. Evidencia en `docs/pasos/P0/evidencia/`
- **El generador de Prisma es `prisma-client-js`, no el nuevo `prisma-client`**, y está razonado en el propio `schema.prisma`: el nuevo emite TypeScript que entra en la compilación del proyecto, agota el heap por defecto de `tsc` y rompe `tsc --build` con TS6059. El cambio entra en la evaluación de Prisma 8, no antes
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** La comprobación de que `DATABASE_URL` usa `costeo_app` estaba en el `superRefine` del objeto y quedaba sin ejecutar cuando, por ejemplo, `PORT` era inválido. Está en el campo desde entonces. Lo encontró la prueba que exige que se listen TODOS los problemas de configuración a la vez
- **El limitador de peticiones está cableado pero no tiene ninguna ruta que proteger en P0**: `/health` y `/ready` llevan `@SkipThrottle` a propósito. Su prueba (`security/bruteforce.test`) es de P1, como ya dice SEGURIDAD.md §11 — no se ha escrito una prueba de mentira para que la casilla esté marcada
- **Lección aprendida al construir el tooling:** varios checks pasaron en verde sin estar midiendo nada — `audit:complexity` sin el parser de TypeScript, `audit:arch` con el fixture dentro de una ruta excluida. Por eso la prueba del guardián (paso 18) es criterio de commit y no un extra: un check verde sobre un repositorio vacío no demuestra que funcione, demuestra que no encontró nada
