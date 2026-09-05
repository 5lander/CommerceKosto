# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** ninguno — **P8 cerrado.**
**Fase del protocolo:** CIERRE de P8
**Último commit:** `P8: Vistas analíticas` (P7 `72f0ba1`, P6 `16200e5`, P5 `e5e3f7d`, P4 `1529f5d`, P3 `6f4a3be`, P2 `1cd10a5`, P1 `3555c9c`, P0 `0f2d606`)
**Fecha de última actualización:** 2026-09-04

### Dónde se retoma exactamente

**Nueve paquetes cerrados: P0 a P8.** El siguiente es **P9 — Consolidado de company y comparativa entre ubicaciones**, y necesita confirmación del usuario antes de empezar.

**Las seis vistas del Excel existen, y R7 cierra sobre el sistema entero.** Era el último criterio de aceptación pendiente desde P0.

**Hecho en P8 — completo**

| # | Entregable | Estado |
|---|---|---|
| 1 | Food cost real y varianza (SPEC §16) **con R7 sobre dataset completo** | ✅ |
| 2 | Menu engineering con los cuatro cuadrantes, más `SIN_DATOS` e `INACTIVO` | ✅ |
| 3 | Punto de equilibrio con **clasificación explícita** de T6 | ✅ |
| 4 | Inventario valorizado con estados, cobertura y punto de reorden | ✅ |
| 5 | Resumen gerencial con semáforos, y `SIN_DATO` como cuarto estado | ✅ |
| 6 | `BODEGA` **no recibe ninguna vista**: solo el semáforo, sin la cantidad | ✅ |
| 7 | `product_sales` y `fixed_cost`: los dos datos que el sistema no puede deducir | ✅ |
| 8 | **La corrección del consumo teórico**, que R7 destapó | ✅ |
| 9 | **ADR-011** con las siete decisiones | ✅ |
| 10 | **702 pruebas**: 442 unitarias con la base apagada + 260 de integración | ✅ |

### Lo que un «tú» futuro necesita saber de P8

**1. R7 destapó un fallo de P6 que llevaba dos paquetes con 596 pruebas en verde encima.**
La receta es del **lote**; la venta, de **porciones**. Vender 100 unidades de un producto que rinde 2 consume **50** lotes, no 100 (SPEC §14: `costo_por_porcion = costo_neto_lote / rendimiento_porciones`). P6 no dividía, así que con rendimiento 4 cada venta sacaba del inventario cuatro veces lo real.

**Ninguna prueba lo vio porque todos los productos de prueba tenían rendimiento 1**, que es el único valor con el que multiplicar y dividir coinciden. La corrección vive en `totalConsumido`, el punto único que P6 y P8 comparten. **ADR-011 §1.**

**2. Cuarta vez que aparece la misma forma de fallo, y ahora con nombre.**

| | Invariante verde | Desglose roto |
|---|---|---|
| P5 | R7 da cero | el desglose del costo |
| P6 | el saldo cuadra | el tipo del movimiento |
| P7 | la cobertura dice 50 % | el inventario final |
| **P8** | **R7 da cero con rendimiento 1** | **el consumo, al doble** |

La lección de P8 añade algo a las anteriores: **no basta con tener la prueba, el caso de prueba tiene que ser el que distingue.** Con rendimiento 1 los dos caminos de R7 coinciden aunque uno esté mal.

**3. Un redondeo intermedio invierte una recomendación de negocio.**
El índice de popularidad, escrito con la fórmula del SPEC tal cual, da `0.999999999999` donde debe dar `1`, y el producto cae en `CABALLO` en vez de `ESTRELLA`. Se arregla con **una sola división**. Vale para todo el proyecto: cuando un número se compara contra un umbral, cuenta cuántas divisiones hay antes.

**4. Tres traducciones del Excel producen números plausibles si se hacen mal.**
El signo de las mermas (allí positivas, aquí con signo), el consumo (allí calculado, aquí además registrable) y la receta por lote frente a la venta por porción. Las tres dan cifras creíbles. **Cada fórmula que se traiga del Excel hay que traducirla, no copiarla.**

**5. `analytics` no consulta ninguna tabla ajena.**
Pide la carta a `costing`, el libro y el conteo a `inventory` por dos casos de uso que ese módulo expone en `para-analitica.ts`, el mes a `periods` y los parámetros a `pricing`. Es lo que evita dos sitios que mantener en sincronía el día que cambie el signo de algo — y lo que hizo que la corrección del consumo fuera **una** línea.

**6. Una sola pasada alimenta las seis vistas.**
`contexto.ts` reúne todo en cinco consultas fijas más el costeo. Pedirlo por vista multiplicaría por cinco el trabajo más caro del sistema. **Su coste no está medido**, y es lo primero que P9 debería medir: el consolidado lo multiplica por el número de ubicaciones.

**7. `BODEGA`, por tercera vez.**
P6 le negó el saldo, P7 la conciliación, P8 las seis vistas. Y las tres veces con las mismas dos consecuencias: **ninguna escritura devuelve lo que acaba de calcular**, y **la proyección reducida es un tipo propio, nunca un `Omit` de la completa**.

### Lo que conviene que el usuario mire antes de P9

1. **El rendimiento del ÍTEM sigue sin confirmarse contra el Excel** (abierta desde P6), y ahora importa más: afecta al `consumo_teorico` que P8 publica en dos vistas. **No confundirlo con el rendimiento por lote**, que es el que P8 corrigió: aquel vive en el costo (SPEC §12), este en la cantidad (SPEC §14).
2. **Las vistas no están contrastadas contra el Excel celda a celda**, y no se puede: el Excel no tiene dimensión temporal (SPEC §3). Lo que sí sale del Excel son los nueve casos del motor de costeo, que P8 no toca.
3. **El coste de armar el contexto no tiene medición propia.** Presupuesto de P9: 800 ms para diez ubicaciones.
4. **El consolidado de P9 puede sumar meses cerrados con meses abiertos**, porque el período es por ubicación (P7). Tendrá que decirlo.
5. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada; bloquea la migración de datos del Excel.
6. **Nadie puede leer `audit_log`** — pendiente estructural de P11, sin cambios desde P7.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | 30 reglas sobre **251 archivos** (228 en P7) |
| `audit:arch` | ✅ | 222 módulos, 973 dependencias. **Paró un ciclo real** en P8 |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones.** Cazó la cuarta repetición del bloque de auditoría |
| `audit:migrations` | ✅ | M1–M11. **M11 ha parado las tres migraciones a las que se ha enfrentado** |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 442 unitarias (sin base) + 260 de integración |

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
| P7 — Períodos · conteo físico | ✅ Completado | `72f0ba1` | 2026-09-04 |
| **P8 — Vistas analíticas** | ✅ Completado | *(el de este paquete)* | 2026-09-04 |
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
| 33 | **El consumo teórico se DIVIDE por el rendimiento por lote** | P8 | La receta es del lote y la venta es de porciones (SPEC §14). **Corrige un fallo de P6** que R7 destapó. **ADR-011** |
| 34 | **El índice de popularidad se calcula con UNA división**, no desde `popularidad` | P8 | Tres redondeos encadenados dan `0.999999999999` donde debe dar `1`, e invierten el cuadrante. **ADR-011** |
| 35 | **`CONSUMO_POR_VENTA` no entra en los agregados del libro** | P8 | El Excel no tiene movimientos de consumo; este sistema sí. Sumarlos y además restar el teórico lo descuenta dos veces. **ADR-011** |
| 36 | **El signo del libro se SUMA**, no se resta como en el Excel | P8 | Aquí una merma ya es negativa (ADR-009); restarla la sumaría. **ADR-011** |
| 37 | **T6 lleva clasificación explícita**, no el prefijo del concepto | P8 | Lo pide el propio SPEC §17: «Nómina» quedaría fuera del prime cost sin avisar. **ADR-011** |
| 38 | **`BODEGA` no recibe ninguna de las seis vistas**, solo el semáforo | P8 | Todas llevan consumo o stock teórico (§4.3). Tercera vez que aparece la misma asimetría. **ADR-011** |
| 39 | **Las unidades vendidas son un entero** (`Count`), con `CHECK` en la base | P8 | Es lo que P5 ya asumía en `totalesDelMes` y lo que menu engineering necesita para contar |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` | P0 | Nada hoy |
| 4 | **La explosión del consumo no aplica el rendimiento del ítem.** Se sigue SPEC §4.3, que es la única frase del SPEC sobre el asunto | P6 | Nada hoy. **Afecta al stock teórico de SPEC §18, que es P8.** Merece confirmarse contra el Excel antes de ese paquete |
| 5 | **Las seis vistas no se pueden contrastar contra el Excel celda a celda**, porque el Excel no tiene dimensión temporal (SPEC §3). La aritmética está probada con casos a mano y R7 cierra sobre el sistema entero | P7 · P8 | Nada. Es una limitación del origen, no una tarea pendiente |
| 6 | **El coste de armar el contexto de las vistas no está medido.** Cinco consultas más el costeo de la carta, por (ubicación, mes) | P8 | Nada hoy. **P9 lo multiplica por el número de ubicaciones** y tiene presupuesto de 800 ms |

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
