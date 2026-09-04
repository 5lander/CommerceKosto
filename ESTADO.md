# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** ninguno — **P7 cerrado.**
**Fase del protocolo:** CIERRE de P7
**Último commit:** `P7: Períodos · conteo físico` (P6 `16200e5`, P5 `e5e3f7d`, P4 `1529f5d`, P3 `6f4a3be`, P2 `1cd10a5`, P1 `3555c9c`, P0 `0f2d606`)
**Fecha de última actualización:** 2026-09-04

### Dónde se retoma exactamente

**Ocho paquetes cerrados: P0 a P7.** El siguiente es **P8 — Vistas analíticas**, y necesita confirmación del usuario antes de empezar.

**Ya se puede cerrar un mes y compararlo con el siguiente.** El período es de una ubicación, su frontera son dos instantes resueltos al abrirlo, y un mes cerrado no admite movimientos por ninguna de las cinco rutas del libro — ni por una sexta que se salte la aplicación entera.

**Hecho en P7 — completo**

| # | Entregable | Estado |
|---|---|---|
| 1 | `period` **por ubicación**, con la frontera del mes como dos `timestamptz` resueltos una sola vez | ✅ |
| 2 | Cerrado es de solo lectura (D6): guarda en las cinco escrituras + **trigger** que cubre cualquier otra | ✅ |
| 3 | Reapertura **solo del `OWNER`**, con motivo obligatorio y evento de auditoría | ✅ |
| 4 | Conteo físico **parcial** (D7), con la cobertura medida sobre el **valor** | ✅ |
| 5 | **Conteo a ciegas** (R8): dos casos de uso, dos permisos, dos DTO. `BODEGA` cuenta y no concilia | ✅ |
| 6 | **Confirmar congela** teórico y costo por línea: la conciliación de un mes cerrado es una lectura | ✅ |
| 7 | `CONSUMO_REAL` de SPEC §16 encadenado mes a mes, con su cobertura al lado | ✅ |
| 8 | **ADR-010** con las nueve decisiones que el SPEC no escribe | ✅ |
| 9 | **INC-013**, encontrada escribiendo una prueba del propio paquete | ✅ |
| 10 | Presupuesto medido: `GET /conteos/:id` p95 **88,4 ms** contra 300, con 500 ítems | ✅ |
| 11 | **659 pruebas**: 413 unitarias con la base apagada + 246 de integración | ✅ |

### Lo que un «tú» futuro necesita saber de P7

**1. Hay TRES números que se parecen y no son el mismo. Nómbralos siempre.**

| | |
|---|---|
| **saldo del libro** | `SUM(quantity)` sobre `inventory_movement`. Lo de P6 |
| **stock teórico del corte** | El saldo del libro **hasta `cutoff_at`** del conteo |
| **inventario físico** | Lo contado donde se contó, **lo teórico donde no** |

P8 usa los tres. Confundirlos produce un food cost real plausible y equivocado.

**2. El conteo NO ajusta el libro, y eso es lo que lo hace útil.**
Si al confirmar se emitiera un `AJUSTE` por la diferencia, `diferencia = conteo − teorico` (SPEC §18) daría **cero siempre**: el hallazgo desaparecería en el acto de registrarlo. El libro dice lo que debería haber; el conteo, lo que hay; su resta es el hallazgo.

**3. Un ítem sin contar vale su TEÓRICO, no cero — y la cobertura no lo detecta.**
Es el guardián 3 de P7, y es la tercera vez que aparece la misma forma de fallo:

| | Invariante que se cumple | Desglose que no |
|---|---|---|
| **P5** | R7 da cero | el desglose del costo está mal |
| **P6** | el saldo cuadra | el tipo del movimiento está mal |
| **P7** | la cobertura dice 50 % | el inventario final está a la mitad |

Valorar en cero lo no contado rompe **3 pruebas de 659** y deja `consumo_real` en +17,00 en vez de −3,00. **Cuando un invariante agregado esté verde, pregúntate qué desglose está tapando** — y comprueba cifras absolutas contra casos a mano, no relaciones entre ellas.

**4. La frontera del mes es un instante, no una fecha, y esto es INC-013.**
Las cinco primeras horas UTC de cada día 1 pertenecen al mes anterior en Ecuador. Me lo encontré escribiendo una prueba: `2026-09-01T00:00:00Z` es el 31 de agosto a las 19:00 en Guayaquil. **Las fechas de prueba llevan `12:00Z`**, que cae en el mismo día natural en toda América. No es automatizable sin falsos positivos.

**5. La guarda EXPLICA, el trigger GARANTIZA.**
Quitando `ExigirPeriodoAbierto` de las cinco escrituras, **ningún movimiento entra igualmente** —el trigger los rechaza todos—, pero salen como **500** en vez de 409. Es INC-012 en vivo. Vale para todo lo que se construya encima: la base garantiza, el dominio explica, y son dos trabajos distintos.

**6. Nadie puede leer `audit_log`. Nadie.**
Ni la aplicación, ni el migrator, ni el dueño de la tabla: `FORCE ROW LEVEL SECURITY` sin política de `SELECT` para ningún rol, que es lo que SEGURIDAD.md §10 pide. **Los eventos de P0 a P7 se escriben y su contenido no está verificado por ninguna prueba.** Es trabajo de P11, y quien lo haga tendrá que crear `costeo_backoffice` con su política.

**7. M11 volvió a evitar INC-012, por segunda vez.**
Las 20 restricciones y los tres triggers de P7 se clasificaron en `guardas-de-dominio.md` **antes del primer endpoint**, porque M11 paró la migración. Resultado: cuatro 🔴, tres de ellas triggers que una petición corriente alcanza — lo contrario de P6, donde quedaron ⚪ por inalcanzables. Ninguna produjo un 500.

**8. El conteo no necesitó ningún índice nuevo sobre el libro.**
El corte (`occurred_at < cutoff_at`) entra en la misma condición del índice de P6 que el tenant y la ubicación. Es lo que se gana guardando la frontera como un instante en vez de calcularla con `date_trunc` en cada consulta: con la expresión, ese plan sería un `Seq Scan` sobre 240.000 filas.

### Lo que conviene que el usuario mire antes de P8

1. **Falta la tabla de unidades vendidas.** P8 la necesita para `venta_neta_mes`, y sin ella el food cost real no cierra: P7 entrega la mitad física de SPEC §16 (`inicial + compras − final físico`) y la otra mitad depende de ese dato. **Es lo primero de P8.**
2. **La explosión del consumo NO aplica el rendimiento** (pendiente desde P6). Se sigue SPEC §4.3 al pie de la letra. **Afecta al stock teórico de SPEC §18, que es P8.** Merece confirmarse contra el Excel **antes** de ese paquete.
3. **`CONSUMO_REAL` no está contrastado contra el Excel**, y no por descuido: el Excel **no tiene dimensión temporal** (SPEC §3), así que no hay celda de «consumo real de marzo» contra la que comparar. La verificación real llega con P8.
4. **El consolidado de P9 puede sumar meses cerrados con meses abiertos**, porque el período es por ubicación. Tendrá que decirlo en la respuesta.
5. **El rendimiento por lote de una subpreparación: se decidió NO añadir columna** (P6). Sigue siendo aditivo si el usuario prefiere lo contrario.
6. **La tasa de IVA de compra vive en el PRECIO, no en la company** (P3).
7. **No existe la tabla `unit_conversion`** que los entregables de P2 listaban. Razonado en `docs/pasos/P2/CONSTRUCCION.md`.
8. **Umbral de bloqueo por IP en 25 en vez de 5** (P1), por los NAT de un restaurante entero.
9. **Refresh rotativo aplazado a P12** (P1), con el riesgo residual en ADR-006.
10. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada; bloquea la migración de datos del Excel.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | 30 reglas sobre **228 archivos** (203 en P6). **P7 no añade ninguna regla**, y el porqué está razonado en su auditoría |
| `audit:arch` | ✅ | 202 módulos, 841 dependencias, cero violaciones |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11. **M11 volvió a parar la primera migración de P7** |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 413 unitarias (sin base) + 246 de integración |

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | ✅ Completado | `0f2d606` | 2026-08-27 |
| P1 — IAM · tenants · ubicaciones · roles | ✅ Completado | `3555c9c` | 2026-09-04 |
| P2 — Catálogo · ítems · artículos · unidades | ✅ Completado | `1cd10a5` | 2026-09-04 |
| P3 — Precios de referencia con vigencia | ✅ Completado | `6f4a3be` | 2026-09-04 |
| P4 — Recetas · productos · combos | ✅ Completado | `1529f5d` | 2026-09-04 |
| P5 — MOTOR DE COSTEO ⭐ | ✅ Completado | `e5e3f7d` | 2026-09-04 |
| P6 — Inventario · libro mayor append-only | ✅ Completado | `16200e5` | 2026-09-04 |
| **P7 — Períodos · conteo físico** | ✅ Completado | *(el de este paquete)* | 2026-09-04 |
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
| 2 | **`decimal.js` dentro de `domain`**, con excepción acotada a `shared/domain/decimal/` | P0 | **Decisión del usuario.** Mitigada con `Decimal.clone()`, escala explícita obligatoria en toda división, y prohibición de importarla fuera de esa carpeta. ADR-003 |
| 3 | **Vitest** como runner, con plugin SWC | P0 | La capa `domain` no tiene decoradores y corre sin transformación; NestJS 12 va hacia Vitest por defecto en proyectos ESM |
| 4 | **P0 entrega `Money`, `Ratio`, `Count` y `Quantity`. Solo `UnitCost` se aplaza** | P0 | `Quantity` se adelantó **por decisión del usuario**: el criterio de aceptación de P2 exige que una conversión inválida se rechace en el dominio |
| 5 | **`argon2` se aplaza a P1** | P0 | No se usa hasta que haya sesiones |
| 6 | Dos checks nuevos: **`audit:migrations`** y **`audit:sec-headers`** | P0 | La reversibilidad de migraciones y SEGURIDAD.md §11 no eran verificables con los nueve originales |
| 7 | La regla de marcadores pendientes vive en `audit:forbidden`, no en ESLint | P0 | `no-warning-comments` marcaría cada comentario en español que contenga la palabra «todo» |
| 8 | Las reglas de `dependency-cruiser` se anclan **por capa**, no por ubicación | P0 | Siguen valiendo si el código se mueve |
| 9 | `audit:forbidden` enmascara comentarios antes de buscar | P0 | La prosa que **explica** una regla contiene por necesidad lo que la regla prohíbe |
| 10 | `allowScripts` versionado en `package.json` para 4 paquetes | P0 | npm 11 bloquea los install scripts por defecto |
| 11 | `src/shared/application/` para puertos transversales | P0 | CLAUDE.md §2 no lo lista, pero es preferible a inventar un módulo `audit` que tampoco está |
| 12 | **El empaque es un ÍTEM**, no una tabla propia | P5 | `T4_EMPAQUES` duplicaría la cadena de costo entera y R13. **ADR-008** |
| 13 | **Si hay receta, manda la receta** sobre el precio estándar de un `PRODUCIDO` | P5 | Es el problema que el LEEME del Excel declara como deuda. R10 sigue entera. **ADR-008** |
| 14 | **El combo suma componentes ya costeados**, sin volver a aplicar merma ni dividir por porciones | P5 | Volver a aplicarla es cobrar la merma dos veces (R12). **ADR-008** |
| 15 | **R6 cierta por construcción**: se divide una vez y el margen es el complemento | P5 | Dos divisiones que caigan a la vez en un empate en el decimal 13 dan `1.000000000001` |
| 16 | **Costear uno pasa por costear todos** | P5 | Dos rutas para el mismo número son dos oportunidades de que difieran |
| 17 | La receta de una subpreparación se expresa **por unidad de uso**, no por lote | P5 | **Confirmado en P6: no se añade columna de rendimiento por lote** |
| 18 | **La cantidad del movimiento lleva SIGNO**, garantizado por `CHECK` + FK compuesta `(type, direction)` | P6 | Sin signo el saldo deja de ser una suma. Sin la FK, `('COMPRA','SALIDA')` cuela una cantidad negativa. **ADR-009** |
| 19 | **Se guarda el importe TOTAL, no el unitario** | P6 | Al comprar el hecho es la factura; reconstruirla con una división pierde centavos. **ADR-009** |
| 20 | **La corrección conserva el TIPO** del movimiento que anula | P6 | Como `AJUSTE`, el mes cerraría contando compras que nadie hizo. **ADR-009** |
| 21 | **La producción se valora al precio de referencia**, no al costo de la receta | P6 | El valor de un inventario no puede cambiar porque alguien edite una receta. **ADR-009** |
| 22 | **`inventory.read` no se concede a `BODEGA`**, y ninguna escritura devuelve el saldo | P6 | Con el saldo despeja el consumo, y de ahí la receta (§4.3). **ADR-009** |
| 23 | **`exigirUbicacionEnAlcance` se muda de `recipes` a `iam`** | P6 | Es autorización de sesión, no una regla de recetas |
| 24 | **El período es de una UBICACIÓN**, no de la company | P7 | El conteo se hace por ubicación (R2); uno de company obligaría a diez ubicaciones a contar el mismo día. **ADR-010** |
| 25 | **La frontera del mes son dos instantes**, resueltos al abrirlo | P7 | Con la zona aplicada en cada consulta, cambiarla movería de mes movimientos ya cerrados. Y hace que el corte use el índice de P6. **ADR-010** |
| 26 | **La ausencia de fila en `period` es el estado ABIERTO** | P7 | Exigir abrir el mes pararía el sistema el día 1 de cada mes. **ADR-010** |
| 27 | **El conteo NO ajusta el libro** | P7 | Un `AJUSTE` por la diferencia haría que `diferencia = conteo − teórico` diera cero siempre. **ADR-010** |
| 28 | **Un ítem sin contar vale su TEÓRICO, no cero** | P7 | Valorarlo en cero equivale a declararlo consumido entero, e infla el consumo real de todo conteo parcial. **ADR-010** |
| 29 | **Confirmar CONGELA** teórico y costo por línea | P7 | Los precios tienen vigencia (R5): recalcular mañana daría otro número para un mes ya informado. **ADR-010** |
| 30 | **Un solo conteo confirmado por período**, con columna anulable única en vez de índice parcial | P7 | Prisma no declara índices parciales y aparecería como deriva en `migrate:verify`. **ADR-010** |
| 31 | **Cerrar el mes es un paso del conteo**, no un endpoint suelto | P7 | Es lo que D6 describe, y evita el ciclo `periods ↔ inventory` que `audit:arch` pararía. **ADR-010** |
| 32 | **`BODEGA` cuenta y no concilia** | P7 | La conciliación lleva stock teórico, diferencia y valorización (§4.3). Y hace el conteo ciego, que SPEC §4 pide. **ADR-010** |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` | P0 | Nada hoy |
| 4 | **La explosión del consumo no aplica el rendimiento del ítem.** Se sigue SPEC §4.3, que es la única frase del SPEC sobre el asunto | P6 | Nada hoy. **Afecta al stock teórico de SPEC §18, que es P8.** Merece confirmarse contra el Excel antes de ese paquete |
| 5 | **`CONSUMO_REAL` no se puede contrastar contra el Excel**, porque el Excel no tiene períodos (SPEC §3). La aritmética está probada con casos a mano | P7 | Nada hoy. La verificación real llega con P8 |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| — | *(ninguna)* | — | — |

> **Pendiente estructural, no deuda:** nadie puede leer `audit_log` porque no existe rol con `SELECT` sobre ella. Es lo que SEGURIDAD.md §10 pide, no un olvido, y se resuelve en **P11** creando `costeo_backoffice` con su política.

---

## Convenciones establecidas

| Ámbito | Convención |
|---|---|
| Estructura de módulos | `apps/api/src/modules/<modulo>/{domain,application,infrastructure}` + `src/shared/{domain,application,infrastructure}` |
| Nombres de archivo | `kebab-case.ts`, sin excepciones (`forceConsistentCasingInFileNames`) |
| Idioma | Identificadores en inglés; comentarios, mensajes de error y documentación en español (CLAUDE.md §3) |
| Imports | Sin extensión (`from './escalas'`): `module: commonjs` + `moduleResolution: node` |
| Aserciones de compilación | `*.type-contract.ts` — no se ejecutan, las verifica `tsc` |
| Pruebas unitarias | `src/**/*.spec.ts`, corren **con la base apagada**, con guardián que lo hace cumplir |
| Pruebas de integración | `apps/api/test/integracion/**/*.spec.ts` |
| **Fechas en pruebas y cargas** | **Hora `12:00Z`**, que cae en el mismo día natural en toda América. Las cinco primeras horas UTC de un día 1 son del mes anterior en Ecuador (INC-013) |
| Opcionales | `\| null` explícito, nunca `?`, por `exactOptionalPropertyTypes` |
| Escalas decimales | `PRESENTACION` 2 · `ALMACENAMIENTO` 12 · `DIVISION` 12 · `MAXIMA` 30 |
| **Decimales en respuestas** | **Todos a escala de ALMACENAMIENTO.** `_sum` de Prisma normaliza y leer la columna no |
| Comparar importes | API completa en el tipo. **Nunca** `.toNumber()` ni operadores relacionales |
| Cantidades | Siempre `Quantity` con su `UnidadDeUso`. Mezclar unidades lanza `UnidadIncompatibleError` |
| **`Quantity` → escalar** | `magnitude(): Ratio` es el **único** puente, explícito y con nombre |
| Redondeo | Medio hacia arriba (*half away from zero*), el `ROUND()` de Excel |
| **Intervalos de período** | **Semiabiertos `[inicio, fin)`.** El instante exacto de `finEn` es del mes siguiente, en SQL, en el trigger y en TypeScript |
| Nombres de tablas | `snake_case` singular (`audit_log`, `inventory_movement`, `physical_count_line`) |
| Nombres de migraciones | `<timestamp>_<slug>/` con `migration.sql` y `down.sql` |
| Bloques SQL manuales | `-- MANUAL: BEGIN/END` en el up, `-- MANUAL-REVERSE: BEGIN/END` en el down. **Los triggers se sueltan antes que sus funciones**: las tablas se borran después |
| **Globs de migraciones en las reglas** | `apps/*/prisma/migrations/**/*.sql`, **nunca** `prisma/migrations/...` (INC-007 caso 9) |
| Formato de commits | `P{n}: {nombre}` — ver `docs/PROTOCOLO.md` |

---

## Notas de contexto

- El SPEC completo está en `docs/SPEC.md`; las reglas obligatorias en `CLAUDE.md`; el protocolo en `docs/PROTOCOLO.md`; la checklist en `docs/AUDITORIA.md`
- **`docs/incidencias/README.md` tiene TRECE fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. **INC-007 (9 recurrencias), INC-008, INC-012 e INC-013 no son de una herramienta concreta**, y merecen leerse aunque no se esté diagnosticando nada
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete
- **La misma forma de fallo lleva tres paquetes seguidos apareciendo**: P5 con R7, P6 con el saldo, P7 con la cobertura. **Un invariante agregado que se cumple tapando un desglose que no.** Cuando un número global esté verde, pregúntate qué desglose lo estaría tapando, y comprueba **cifras absolutas** contra casos calculados a mano — no relaciones entre ellas
- **El contador de archivos de `audit:forbidden` no es decorativo.** Cuando una regla cambia de alcance, ese número tiene que moverse (INC-007 caso 9)
- **Una prueba de plan de ejecución necesita volumen REALISTA, no solo mucho volumen** — y tiene que **aceptar el plan bueno**: exigir `Index Scan` sobre una tabla diminuta rompe la prueba por un plan que está bien. Es la otra mitad de la misma lección
- **`docs/sistema/guardas-de-dominio.md` cubre P0–P7.** M11 falla si una migración nueva con `CHECK` o `RAISE EXCEPTION` no tiene su sección. **Ha parado las dos migraciones a las que se ha enfrentado**, y es la razón de que INC-012 no haya reaparecido
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** Toda validación que sea control de seguridad va en el CAMPO
- **Y la lección que las engloba: un check que FALLA tampoco está verificado.** Hay que preguntarse en **cuántos** sitios falla. El verde no es el único color sospechoso
