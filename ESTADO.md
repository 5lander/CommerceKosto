# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** ninguno — **P5 cerrado.**
**Fase del protocolo:** CIERRE de P5
**Último commit:** `P5: Motor de costeo` (P4 `1529f5d`, P3 `6f4a3be`, P2 `1cd10a5`, P1 `3555c9c`, P0 `0f2d606`)
**Fecha de última actualización:** 2026-09-04

### Dónde se retoma exactamente

**Seis paquetes cerrados: P0, P1, P2, P3, P4 y P5.** El siguiente es **P6 — Inventario, libro mayor append-only**, y necesita confirmación del usuario antes de empezar.

**El motor de costeo existe y está probado.** Es dominio puro, corre con PostgreSQL apagado y reproduce los números que `V_COSTEO` del Excel ya tenía calculados — incluidos los que allí estaban escritos a mano.

**Los siete ítems que este archivo dejó escritos para P5, uno por uno**

| # | Qué pedía | Estado |
|---|---|---|
| 1 | R7 da exactamente 0, en cada build | ✅ `0.00` con canario a `1e-6`, **a través del motor** y no con valores transcritos |
| 2 | R6: `mc% + food_cost% = 1` | ✅ Cierta **por construcción**: se divide una vez y el margen es el complemento |
| 3 | R14: `venta_neta = pvp / (1 + iva_venta)` | ✅ Activa |
| 4 | R12: la merma no se cobra dos veces | ✅ Activa. El combo tampoco la vuelve a aplicar |
| 5 | Retirar la lista blanca de knip | ✅ **Nunca existió.** Verificado: `knip.json` no tiene excepción para `shared/domain/**` |
| 6 | `EXPLAIN ANALYZE` con volumen realista | ✅ p95 **136,8 ms** contra 400 de presupuesto, con los planes verificados |
| 7 | Correr el motor contra CC-001..CC-R7 | ✅ Los nueve casos escribibles hoy. CC-008 (menu engineering) es de P8 |

**Hecho en P5 — completo**

| # | Entregable | Estado |
|---|---|---|
| 1 | **`costing/domain`**: costeo del producto (SPEC §14), cascada de subpreparaciones, costo de combos | ✅ |
| 2 | **`casos-conocidos.md` completo**: CC-004, 005, 006, 007 y 009 escritos **antes** de tocar el motor | ✅ |
| 3 | **Carga en lote**: `CostosDeItems` en `pricing` y `LeerCarta` en `recipes`. Ocho consultas fijas | ✅ |
| 4 | **`GET /costeo`** y **`GET /costeo/:productId`** con permiso `costing.read` | ✅ |
| 5 | **Migración `p5_costeo`**: `product.packaging_item_id`, el índice de la carta y el permiso. Reversible y verificada | ✅ |
| 6 | **ADR-008** — el empaque, la precedencia de la cascada y el combo | ✅ |
| 7 | **INC-012** con prevención automatizada (**M11**) y `docs/sistema/guardas-de-dominio.md` | ✅ |
| 8 | **INC-007 sube a 8** con `sin-caracteres-de-control`, la primera prevención que ataca la causa | ✅ |
| 9 | **Hueco de documentación de P3 y P4 cerrado**: `docs/apis/` y `modelo-datos.md` | ✅ |
| 10 | **505 pruebas**: 343 unitarias con la base apagada + 162 de integración | ✅ |

### Lo que un «tú» futuro necesita saber de P5

**1. R7 NO detecta un costo equivocado, y es lo más importante de este paquete.**
Al invertir R4 —intercambiar `EP` y `AP`— fallan 12 pruebas y **ninguna es CC-R7**: la conciliación sigue dando `0.00` con el motor calculando mal cada línea. No es un fallo de la prueba: la identidad `costo_ventas_teorico == venta_neta_mes − mc_mes` se sostiene cualquiera que sea el costo, porque el costo está en los dos lados. R7 detecta **deriva aritmética** y **términos que faltan**; no detecta un número mal calculado. **P8 la va a correr con el dataset completo: una R7 verde no es evidencia de que el motor esté bien.** Evidencia en `docs/pasos/P5/evidencia/guardian-1-r4-invertida.txt`.

**2. Si hay receta, manda la receta.**
Un ítem `PRODUCIDO` con receta vigente se costea por su receta; su precio de referencia es el costo estándar de una preparación que todavía no tiene receta —que es cómo llegan las 24 filas `SUB` al migrar el Excel—. R10 sigue entera: lo que prohíbe es el costo del **último lote**, y la cascada usa precios confirmados. Razonado en **ADR-008**, comprobado en CC-005.

**3. El empaque es un ítem, no una tabla.**
`product.packaging_item_id` → `item`. `empaque_neto` de SPEC §14 es su `costo_neto_uso`, por la misma cadena de §12. Una tabla propia habría duplicado la cadena de costo y R13.

**4. Ahora hay un sitio donde mirar qué restricción de la base tiene guarda de dominio.**
`docs/sistema/guardas-de-dominio.md`, con las de P0 a P5 clasificadas en 🔴 alcanzable / 🟡 filtrada por esquema / ⚪ estructural. **M11 de `audit:migrations` falla si una migración nueva con `CHECK` o `RAISE` no tiene su sección.** Nace de INC-012 y **P6 es el candidato claro a repetirlo**: el libro append-only es trigger puro, y un `UPDATE` sobre `inventory_movement` tiene que salir como error de dominio con mensaje, no como 500.

**5. Un check que falla no está verificado: hay que mirar en CUÁNTOS sitios falla.**
La octava recurrencia de INC-007 se destapó porque M11 marcaba «3 de 5» y debía marcar 5. El verde no es el único color sospechoso.

### Lo que conviene que el usuario mire antes de P6

1. **El rendimiento por lote de una subpreparación no existe.** La receta de una preparación se expresa **por unidad de uso**: para una salsa cuya receta rinde 5 litros hay que escribir las cantidades divididas entre 5. Es incómodo de capturar. `item` no tiene columna para ello y P5 no se la inventó porque el rendimiento por lote pertenece a P6, donde existe el movimiento de producción que lo hace significar algo. **Es la duda más accionable ahora mismo.**
2. **La tasa de IVA de compra vive en el PRECIO, no en la company** (P3). Confirmada por el usuario el 2026-09-04.
3. **No existe la tabla `unit_conversion`** que los entregables de P2 listaban. Razonado en `docs/pasos/P2/CONSTRUCCION.md`.
4. **Umbral de bloqueo por IP en 25 en vez de 5** (P1), para no dejar fuera a un restaurante entero detrás de un NAT.
5. **Refresh rotativo aplazado a P12** (P1), con el riesgo residual en ADR-006.
6. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada hasta ahora; bloquea la migración de datos del Excel.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | **28 reglas** sobre 168 archivos. La 28 es `sin-caracteres-de-control` (INC-007 caso 8) |
| `audit:arch` | ✅ | 172 módulos, 660 dependencias, cero violaciones. Con autocomprobación |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | **M1–M11.** M11 es nueva y nace de INC-012 |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 343 unitarias (sin base) + 162 de integración |

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | ✅ Completado | `0f2d606` | 2026-08-27 |
| P1 — IAM · tenants · ubicaciones · roles | ✅ Completado | `3555c9c` | 2026-09-04 |
| P2 — Catálogo · ítems · artículos · unidades | ✅ Completado | `1cd10a5` | 2026-09-04 |
| P3 — Precios de referencia con vigencia | ✅ Completado | `6f4a3be` | 2026-09-04 |
| P4 — Recetas · productos · combos | ✅ Completado | `1529f5d` | 2026-09-04 |
| **P5 — MOTOR DE COSTEO ⭐** | ✅ Completado | *(el de este paquete)* | 2026-09-04 |
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
| 12 | **El empaque es un ÍTEM**, no una tabla propia | P5 | `T4_EMPAQUES` del Excel duplicaría la cadena de costo entera y R13. `empaque_neto` es el `costo_neto_uso` del ítem. **ADR-008** |
| 13 | **Si hay receta, manda la receta** sobre el precio estándar de un `PRODUCIDO` | P5 | Es el problema que el LEEME del Excel declara como deuda. R10 sigue entera: prohíbe el costo del ÚLTIMO LOTE, no el derivado de precios confirmados. **ADR-008** |
| 14 | **El combo suma componentes ya costeados**, sin volver a aplicar merma ni dividir por porciones | P5 | Volver a aplicarla es cobrar la merma dos veces (R12). El SPEC no escribe la fórmula. **ADR-008** |
| 15 | **R6 cierta por construcción**: se divide una vez y el margen es el complemento | P5 | Dos divisiones que caigan a la vez en un empate en el decimal 13 dan `1.000000000001`. Un invariante no puede depender de que eso no pase |
| 16 | **Costear uno pasa por costear todos** | P5 | Dos rutas para el mismo número son dos oportunidades de que difieran, y aquí eso no se ve en pantalla |
| 17 | La receta de una subpreparación se expresa **por unidad de uso**, no por lote | P5 | El rendimiento por lote pertenece a P6. **Es la duda abierta más accionable** |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` para no romper el entorno actual, y `.nvmrc` apunta a 24.20.0 | P0 | Nada hoy. Conviene actualizar Node antes de cerrar P0 |
| 2 | ~~CC-004 no se puede extraer del Excel~~ | P0 | ✅ **Resuelto en P5.** Se construyó partiendo de `INS-113`, cuya mitad `EP` **el Excel sí tiene** (`0.4615384615`); lo único a mano es la mitad `AP`, que es `1.5 × 0.20`. La advertencia del ítem B2 queda cubierta por esa mitad corroborada |
| 3 | **El rendimiento por lote de una subpreparación no existe.** La receta de una preparación va por unidad de uso: una salsa que rinde 5 litros obliga a escribir las cantidades divididas entre 5 | P5 | Nada hoy. **Incómodo de capturar, y conviene decidirlo antes de P6**, que es donde el movimiento de producción lo haría significar algo |

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
- **`docs/incidencias/README.md` tiene DOCE fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. Cuatro son del entorno Windows; **INC-007 (8 recurrencias), INC-008 e INC-012 no son de una herramienta concreta sino de cómo se verifica**, y merecen leerse aunque no se esté diagnosticando nada. **INC-012 es la que más probable es que reaparezca en P6**: el libro append-only es trigger puro
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete, no colarlo en medio de una corrida
- **P5 está hecho, y su lección se queda.** Era el camino crítico porque es el único componente donde un error no se ve en pantalla: produce números plausibles y equivocados que el cliente usa para fijar precios. Lo que protege ese número no es R7 —que es una identidad algebraica y no detecta un costo mal calculado— sino **los casos conocidos**, cuyos valores esperados salen del Excel y no del código. Cualquier cambio en `costing/domain` se corre contra los nueve
- **`docs/sistema/guardas-de-dominio.md` es nuevo y hay que mantenerlo.** Dice qué restricción de la base es alcanzable desde la API y dónde está su guarda de dominio. `audit:migrations` M11 falla si una migración nueva con `CHECK` o `RAISE EXCEPTION` no tiene su sección
- **Cuatro checks resultaron estar mal cableados, y los cuatro se descubrieron por provocarles un fallo, no por verlos en verde:** `audit:complexity` sin el parser de TypeScript · `audit:arch` con el fixture dentro de una ruta excluida · `audit:forbidden` sin escanear `apps/*/test/**`, así que un `as any` en una prueba no lo veía nadie · `audit:secrets` con los patrones de ignorar anclados a la raíz, que reportaba dos veces cada hallazgo por escanear también el compilado
- **`audit:deadcode` está verificado en los DOS sentidos**, que es lo que importa con inyección de dependencias: marca un export sin uso, y **no** marca una clase cuya única referencia es `useClass` en un módulo de NestJS. Se comprobó con la misma clase (`PrismaAuditLogRepository`) en las dos situaciones: registrada, no la marca; sin registrar, la marca como archivo muerto. Evidencia en `docs/pasos/P0/evidencia/`
- **El generador de Prisma es `prisma-client-js`, no el nuevo `prisma-client`**, y está razonado en el propio `schema.prisma`: el nuevo emite TypeScript que entra en la compilación del proyecto, agota el heap por defecto de `tsc` y rompe `tsc --build` con TS6059. El cambio entra en la evaluación de Prisma 8, no antes
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** La comprobación de que `DATABASE_URL` usa `costeo_app` estaba en el `superRefine` del objeto y quedaba sin ejecutar cuando, por ejemplo, `PORT` era inválido. Está en el campo desde entonces. Lo encontró la prueba que exige que se listen TODOS los problemas de configuración a la vez
- **El limitador de peticiones está cableado pero no tiene ninguna ruta que proteger en P0**: `/health` y `/ready` llevan `@SkipThrottle` a propósito. Su prueba (`security/bruteforce.test`) es de P1, como ya dice SEGURIDAD.md §11 — no se ha escrito una prueba de mentira para que la casilla esté marcada
- **Y la lección de P5 sobre eso mismo: un check que FALLA tampoco está verificado.** M11 marcaba «3 migraciones de 5» y debía marcar 5; la regla estaba rota y su salida era roja. Hay que preguntarse en **cuántos** sitios falla, no solo si falla. El verde no es el único color sospechoso
- **Lección aprendida al construir el tooling:** varios checks pasaron en verde sin estar midiendo nada — `audit:complexity` sin el parser de TypeScript, `audit:arch` con el fixture dentro de una ruta excluida. Por eso la prueba del guardián (paso 18) es criterio de commit y no un extra: un check verde sobre un repositorio vacío no demuestra que funcione, demuestra que no encontró nada
