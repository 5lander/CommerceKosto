# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** ninguno — **P6 cerrado.**
**Fase del protocolo:** CIERRE de P6
**Último commit:** `P6: Inventario · libro mayor append-only` (P5 `e5e3f7d`, P4 `1529f5d`, P3 `6f4a3be`, P2 `1cd10a5`, P1 `3555c9c`, P0 `0f2d606`)
**Fecha de última actualización:** 2026-09-04

### Dónde se retoma exactamente

**Siete paquetes cerrados: P0 a P6.** El siguiente es **P7 — Períodos y conteo físico**, y necesita confirmación del usuario antes de empezar.

**El libro de inventario existe y no se puede editar.** El saldo es una suma sobre él, no un campo; se comprueba plegando los movimientos crudos en TypeScript y exigiendo que coincida con el `SUM` de PostgreSQL hasta el último de los 12 decimales.

**Hecho en P6 — completo**

| # | Entregable | Estado |
|---|---|---|
| 1 | `inventory_movement` append-only en **tres capas**, con los siete tipos del SPEC §7 | ✅ |
| 2 | Saldo como **proyección** (R3). No existe `inventory_balance`, y era lo previsto | ✅ |
| 3 | Transferencias como **par que suma cero por construcción** (R2) | ✅ |
| 4 | Producción con **R10 entera**: alta al estándar, costo real del lote al lado, varianza | ✅ |
| 5 | **Interruptor de stock conmutable** (`llevaStock`), con la explosión del consumo | ✅ |
| 6 | Corrección de signo contrario que **conserva el tipo** | ✅ |
| 7 | **`BODEGA` escribe el libro y no lo lee**, comprobado sobre respuesta cruda | ✅ |
| 8 | **ADR-009** con las cinco decisiones que el SPEC no escribe | ✅ |
| 9 | **INC-007 sube a 9**: dos reglas llevaban desde P0 sin examinar una migración | ✅ |
| 10 | Presupuesto medido: p95 **60,8 ms** contra 300, con 1,2 M de movimientos | ✅ |
| 11 | **596 pruebas**: 383 unitarias con la base apagada + 213 de integración | ✅ |

### Lo que un «tú» futuro necesita saber de P6

**1. `BODEGA` no puede leer el saldo, y esto condiciona todo endpoint futuro.**
`saldo = inicial + compras − consumo`. Quien registra las compras conoce el inicial y las compras; con el saldo despeja el consumo, y el consumo dividido entre las unidades vendidas **es** la cantidad de la receta. Tres consecuencias que hay que respetar en P7 y P8:
- `inventory.read` no se le concede.
- **Ninguna escritura devuelve el saldo resultante.** Un `POST` que responda «nuevo saldo: 12,4 kg» filtra lo mismo que un `GET`.
- El semáforo `REPONER`/`OK` es de P8, cuando exista el punto de reorden.

**2. La corrección conserva el TIPO, y el saldo no lo detecta.**
Emitiéndola como `AJUSTE` fallan 3 pruebas de 74; siguen en verde el saldo, la reconstrucción del libro y el criterio de aceptación de P6. Lo único que lo caza es la agregación **por tipo**, de donde sale `compras_del_mes`. **Es la misma forma de fallo que R7 en P5**: un invariante que se cumple tapando uno que no. Evidencia en `docs/pasos/P6/evidencia/guardian-3-correccion-de-otro-tipo.txt`.

**3. El signo lo garantiza una clave foránea compuesta, no solo un `CHECK`.**
Un `CHECK` no puede consultar otra tabla, así que la dirección viaja **en la fila** y la FK `(type, direction)` impide que discrepe de su catálogo. Sin ella, declarar `('COMPRA','SALIDA')` colaría una cantidad negativa. Mismo mecanismo que P3 usó con el artículo de compra.

**4. La producción se valora al precio de referencia, y eso se aparta de ADR-008 a propósito.**
El motor de costeo dice «si hay receta, manda la receta»; el libro dice «manda el precio de referencia». No chocan: **el valor de un inventario no puede cambiar porque alguien edite una receta**, y el precio de referencia es una fila con vigencia que nadie sobrescribe (R5). El desajuste es la varianza, que es la señal que R10 quiere. Razonado en **ADR-009 decisión 4**.

**5. Un check que falla en menos sitios de los que debería sigue estando roto — y esta vez encontró algo de P0.**
El glob de migraciones de `audit:forbidden` estaba anclado a la raíz y no casaba con `apps/api/prisma/migrations/`. **Dos reglas llevaban desde P0 sin examinar una sola migración.** El contador del informe —189 → 203 archivos— es lo que lo confirma. **Ese contador no es decorativo: cuando una regla cambia de alcance, tiene que moverse.**

**6. Una prueba de plan de ejecución necesita volumen REALISTA, no solo mucho volumen.**
Con una sola ubicación en la tabla, `Seq Scan` es la elección correcta y la prueba fallaba por un motivo ajeno al índice. Hicieron falta 19 ubicaciones de ruido. Es INC-007 aplicada a un dato.

**7. INC-012 no reapareció, y el motivo se puede repetir.**
Las 18 restricciones nuevas se clasificaron en `guardas-de-dominio.md` **antes** de escribir el primer endpoint, porque M11 paró la migración. Los triggers append-only quedaron ⚪ porque **no hay ruta de la API que edite un movimiento**, y lo sostiene `audit:forbidden` y no la disciplina de nadie: una guarda de runtime protegería contra código que no compila.

### Lo que conviene que el usuario mire antes de P7

1. **El rendimiento por lote de una subpreparación: se decidió NO añadir columna.** La receta ya es por unidad de uso, así que producir 5 litros es `receta × 5` y el movimiento de producción funciona sin nada nuevo. Una columna sería ergonomía de captura y crearía dos fuentes para el mismo número. **Es aditiva si la quieres, y no invalida historial.**
2. **La explosión del consumo NO aplica el rendimiento.** Se sigue SPEC §4.3 al pie de la letra —«`consumo ÷ unidades vendidas` = cantidad de la receta»—, que es la única frase del SPEC sobre el asunto y es inequívoca. **Merece confirmarse contra el Excel**: afecta al stock teórico de SPEC §18, que es P8.
3. **Falta la tabla de unidades vendidas.** P6 registra la *consecuencia* de una venta sobre el stock, no la cifra de ventas. P8 la necesita para la venta neta y el food cost.
4. **La tasa de IVA de compra vive en el PRECIO, no en la company** (P3). Confirmada el 2026-09-04.
5. **No existe la tabla `unit_conversion`** que los entregables de P2 listaban. Razonado en `docs/pasos/P2/CONSTRUCCION.md`.
6. **Umbral de bloqueo por IP en 25 en vez de 5** (P1), para no dejar fuera a un restaurante entero detrás de un NAT.
7. **Refresh rotativo aplazado a P12** (P1), con el riesgo residual en ADR-006.
8. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada; bloquea la migración de datos del Excel.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | **30 reglas sobre 203 archivos.** Dos nuevas de append-only, y **14 archivos más que en P5**: las migraciones, que no se escaneaban desde P0 |
| `audit:arch` | ✅ | 181 módulos, 737 dependencias, cero violaciones |
| `audit:deadcode` | ✅ | Sin ninguna lista blanca |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones** |
| `audit:migrations` | ✅ | M1–M11. **M11 paró la primera migración a la que se enfrentó**, como se diseñó en P5 |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | 383 unitarias (sin base) + 213 de integración |

## Progreso

| Paquete | Estado | Commit | Fecha |
|---|---|---|---|
| P0 — Fundación del repositorio | ✅ Completado | `0f2d606` | 2026-08-27 |
| P1 — IAM · tenants · ubicaciones · roles | ✅ Completado | `3555c9c` | 2026-09-04 |
| P2 — Catálogo · ítems · artículos · unidades | ✅ Completado | `1cd10a5` | 2026-09-04 |
| P3 — Precios de referencia con vigencia | ✅ Completado | `6f4a3be` | 2026-09-04 |
| P4 — Recetas · productos · combos | ✅ Completado | `1529f5d` | 2026-09-04 |
| P5 — MOTOR DE COSTEO ⭐ | ✅ Completado | `e5e3f7d` | 2026-09-04 |
| **P6 — Inventario · libro mayor append-only** | ✅ Completado | *(el de este paquete)* | 2026-09-04 |
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
| 2 | **`decimal.js` dentro de `domain`**, con excepción acotada a `shared/domain/decimal/` | P0 | **Decisión del usuario.** Mitigada con `Decimal.clone()`, escala explícita obligatoria en toda división, y prohibición de importarla fuera de esa carpeta. ADR-003 |
| 3 | **Vitest** como runner, con plugin SWC | P0 | La capa `domain` no tiene decoradores y corre sin transformación; NestJS 12 va hacia Vitest por defecto en proyectos ESM |
| 4 | **P0 entrega `Money`, `Ratio`, `Count` y `Quantity`. Solo `UnitCost` se aplaza** | P0 | `Quantity` se adelantó **por decisión del usuario**: el criterio de aceptación de P2 exige que una conversión inválida se rechace en el dominio. **Efecto: la lista blanca de knip no hizo falta** |
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
| 17 | La receta de una subpreparación se expresa **por unidad de uso**, no por lote | P5 | **Confirmado en P6: no se añade columna de rendimiento por lote.** Producir 5 litros es `receta × 5` |
| 18 | **La cantidad del movimiento lleva SIGNO**, garantizado por `CHECK` + FK compuesta `(type, direction)` | P6 | Sin signo el saldo deja de ser una suma. Sin la FK, `('COMPRA','SALIDA')` cuela una cantidad negativa. **ADR-009** |
| 19 | **Se guarda el importe TOTAL, no el unitario** | P6 | Al comprar el hecho es la factura; reconstruirla con una división pierde centavos y `compras_del_mes` deja de cuadrar. **ADR-009** |
| 20 | **La corrección conserva el TIPO** del movimiento que anula | P6 | Como `AJUSTE`, el mes cerraría contando compras que nadie hizo. Es la única excepción a la regla de signos, acotada a `reverses_movement_id IS NOT NULL`. **ADR-009** |
| 21 | **La producción se valora al precio de referencia**, no al costo de la receta | P6 | El valor de un inventario no puede cambiar porque alguien edite una receta. El desajuste **es** la varianza que R10 quiere. **ADR-009** |
| 22 | **`inventory.read` no se concede a `BODEGA`**, y ninguna escritura devuelve el saldo | P6 | Con el saldo despeja el consumo, y de ahí la receta (§4.3). **ADR-009** |
| 23 | **`exigirUbicacionEnAlcance` se muda de `recipes` a `iam`** | P6 | Es autorización de sesión, no una regla de recetas. Al necesitarla un segundo módulo, las alternativas eran duplicarla o importar un error de dominio ajeno |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` para no romper el entorno actual | P0 | Nada hoy |
| 2 | ~~CC-004 no se puede extraer del Excel~~ | P0 | ✅ **Resuelto en P5** |
| 3 | ~~El rendimiento por lote de una subpreparación~~ | P5 | ✅ **Decidido en P6: no se añade columna.** La receta es por unidad de uso y `receta × cantidad` está completo. Es aditiva si el usuario prefiere lo contrario |
| 4 | **La explosión del consumo no aplica el rendimiento del ítem.** Se sigue SPEC §4.3 —«`consumo ÷ unidades vendidas` = cantidad de la receta»—, que es la única frase del SPEC sobre el asunto | P6 | Nada hoy. **Afecta al stock teórico de SPEC §18, que es P8.** Merece confirmarse contra el Excel antes de ese paquete |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| — | *(ninguna)* | — | — |

> La lista blanca de knip para `shared/domain/**` **no fue necesaria**. Se anota para que nadie la reintroduzca por costumbre.

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
| **Decimales en respuestas** | **Todos a escala de ALMACENAMIENTO.** `_sum` de Prisma normaliza (`"8.5"`) y leer la columna no (`"8.500000000000"`): sin normalizar, el mismo número sale con dos formas por la misma API |
| Comparar importes | API completa en el tipo. **Nunca** `.toNumber()` ni operadores relacionales |
| Cantidades | Siempre `Quantity` con su `UnidadDeUso`. Mezclar unidades lanza `UnidadIncompatibleError` |
| **`Quantity` → escalar** | `magnitude(): Ratio` es el **único** puente, explícito y con nombre. `grep magnitude(` da la lista de sitios donde se afirma que el `Money` que se multiplica está por unidad de uso |
| Redondeo | Medio hacia arriba (*half away from zero*), el `ROUND()` de Excel. **No** banker's rounding |
| Nombres de tablas | `snake_case` singular (`audit_log`, `inventory_movement`) |
| Nombres de migraciones | `<timestamp>_<slug>/` con `migration.sql` y `down.sql` |
| Bloques SQL manuales | `-- MANUAL: BEGIN/END` en el up, `-- MANUAL-REVERSE: BEGIN/END` en el down |
| **Globs de migraciones en las reglas** | `apps/*/prisma/migrations/**/*.sql`, **nunca** `prisma/migrations/...`: el escáner compara rutas relativas a la raíz del repositorio (INC-007 caso 9) |
| Formato de commits | `P{n}: {nombre}` — ver `docs/PROTOCOLO.md` |

---

## Notas de contexto

- El SPEC completo está en `docs/SPEC.md`; las reglas obligatorias en `CLAUDE.md`; el protocolo en `docs/PROTOCOLO.md`; la checklist en `docs/AUDITORIA.md`
- **`docs/incidencias/README.md` tiene DOCE fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. **INC-007 (9 recurrencias), INC-008 e INC-012 no son de una herramienta concreta sino de cómo se verifica**, y merecen leerse aunque no se esté diagnosticando nada
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete
- **P5 está hecho, y su lección se queda.** Lo que protege el número no es R7 —que es una identidad algebraica— sino **los casos conocidos**, cuyos valores salen del Excel y no del código. Cualquier cambio en `costing/domain` se corre contra los nueve
- **P6 añade la misma lección en otro sitio: el saldo tampoco detecta un tipo equivocado.** Con la corrección emitida como `AJUSTE`, el saldo cuadra, la reconstrucción del libro cuadra y el criterio de aceptación de P6 pasa. Lo único que lo caza es la agregación por tipo. **Cuando un invariante agregado esté verde, preguntarse qué desglose lo estaría tapando**
- **`docs/sistema/guardas-de-dominio.md` cubre P0–P6.** `audit:migrations` M11 falla si una migración nueva con `CHECK` o `RAISE EXCEPTION` no tiene su sección. **Paró la primera migración a la que se enfrentó**, que es por lo que INC-012 no reapareció en P6
- **El contador de archivos de `audit:forbidden` no es decorativo.** Cuando una regla cambia de alcance, ese número tiene que moverse; si no se mueve, el alcance no cambió. Es lo que destapó el caso 9 de INC-007
- **Una prueba de plan de ejecución necesita volumen REALISTA, no solo mucho volumen.** Con una sola ubicación en la tabla, `Seq Scan` es la elección correcta de PostgreSQL. La prueba de rendimiento de inventario siembra 19 ubicaciones de ruido por eso, y está anotado en la constante
- **Cuatro checks resultaron estar mal cableados, y los cuatro se descubrieron por provocarles un fallo, no por verlos en verde**
- **`audit:deadcode` está verificado en los DOS sentidos**, que es lo que importa con inyección de dependencias
- **El generador de Prisma es `prisma-client-js`, no el nuevo `prisma-client`**, y está razonado en el propio `schema.prisma`
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** Toda validación que sea control de seguridad va en el CAMPO
- **Y la lección de P5 sobre eso mismo: un check que FALLA tampoco está verificado.** Hay que preguntarse en **cuántos** sitios falla. El verde no es el único color sospechoso — y en P6 esa pregunta destapó dos reglas que llevaban desde P0 sin examinar una sola migración
