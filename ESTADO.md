# ESTADO.md — Memoria del proyecto costeo-saas

> **Este archivo es la única memoria que sobrevive a una compactación de contexto.**
> Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada paquete.
> Escríbelo pensando en alguien que no vivió las sesiones anteriores.

---

## Estado actual

**Paquete en curso:** ninguno — **P10 cerrado.**
**Fase del protocolo:** CIERRE de P10
**Último commit:** `P10: Importación de catálogo` (P9 `47f1e7d`, P8 `0067bd1`, P7 `72f0ba1`, P6 `16200e5`, P5 `e5e3f7d`, P4 `1529f5d`, P3 `6f4a3be`, P2 `1cd10a5`, P1 `3555c9c`, P0 `0f2d606`)
**Fecha de última actualización:** 2026-09-07

### EL PROYECTO CAMBIÓ DE MODO — leer esto antes que nada

**Hay fecha comercial: la semana que viene un restaurante tiene que estar usando el sistema.** Eso
cambió el ALCANCE, no el estándar del motor. Decisión del usuario, no negociable:

| Pospuesto | Motivo |
|---|---|
| **P11 y P13** (back office, API y frontend) | Con un cliente, el back office es el usuario. Crear el tenant es un seed |
| **P10 como autoservicio** | Sin UI de subida, previsualización, deduplicación ni confirmación en dos pasos. Lo que se construyó es un comando |
| **P14** (capa visual / manual de marca) | Frontend sobrio y consistente, sin identidad de marca |
| **P15 completo** | Las tres barreras y la confidencialidad de BODEGA siguen vigentes en el motor. El endurecimiento de escala se pospone |

**Y lo que cambió del protocolo, solo esto:** `apps/api` conserva las 7 fases, la auditoría completa
y un commit por paquete. **El frontend no lleva las 7 fases** —allí no hay lógica de negocio, así que
la auditoría de ~100 verificaciones protege poco y cuesta mucho—: tipos, lint, y que la pantalla haga
lo que dice. **Un commit por PANTALLA**, no por paquete.

Lo que NO cambia en ningún sitio: nada de `any`, dinero y cantidades nunca en punto flotante,
decimales cruzando fronteras como string, cero lógica de negocio en el frontend, sin dependencias
nuevas sin autorización, sin `--no-verify`.

### Dónde se retoma exactamente

**Once paquetes cerrados: P0 a P10.** Lo siguiente es la **Fase B — desplegar**, y empieza con una
**parada entera**: no se ejecuta nada de infraestructura hasta que el usuario apruebe opciones con
coste mensual real.

**Hecho en P10 — completo**

| # | Entregable | Estado |
|---|---|---|
| 1 | Migración `p10_importaciones`: `import_job` + `import_job_status`, RLS deny-by-default y FORCE | ✅ |
| 2 | **Escritura EN LOTE en los cuatro módulos dueños**, una transacción por lote | ✅ |
| 3 | **Escritura de `combo_component`** — la tabla existía desde P4 y nadie la había escrito nunca | ✅ |
| 4 | Descriptor `PRECIOS` y columnas `empaque` / `activo` en `PRODUCTOS` | ✅ |
| 5 | `npm run importar`, con guarda de producción y sesión por el camino del login | ✅ |
| 6 | **D4 cerrada** — ADR-014. No quedan decisiones 🔴 | ✅ |
| 7 | **ADR-013** (parser aislado) y **ADR-014** (`LNK` era un componente de combo) | ✅ |
| 8 | **835 pruebas**: 558 unitarias con la base apagada + 277 de integración | ✅ |

### Lo que un «tú» futuro necesita saber de P10

**1. `combo_component` llevaba seis paquetes existiendo sin que nadie la escribiera.**
P4 creó la tabla, P5 la lee para costear (`componentesDeCombos`) y **entre P4 y P10 no se insertó una
sola fila**. Un combo se podía crear como producto y no se podía componer nunca: costaba cero.
Ninguna prueba lo vio porque ninguna creaba un combo con componentes. **Lo destapó preguntar qué
representaba una columna de un Excel**, no una revisión de código.

La lección, que es nueva: **una tabla con lectura y sin escritura es un agujero que ningún check ve.**
`audit:deadcode` mira exports de TypeScript, no rutas de escritura a la base. Si un día se añade una
tabla y solo se cablea su lectura, va a pasar otra vez.

**2. La transacción por método era el fallo, y no se podía envolver desde fuera.**
Cada método de repositorio abre su propia `TenantTransaction.run()`. 200 ítems = 200 transacciones.
Y `ClienteDeTransaccion` es `Prisma.TransactionClient`, que **no expone `$transaction`**: no hay
forma de que una transacción contenga a otra. La solución fue un método de repositorio nuevo por
módulo. **La atomicidad es por pasada, no entre módulos**, y eso no se puede arreglar con este ORM.

**3. Un check de CÓDIGO MUERTO encontró un agujero de SEGURIDAD.**
knip señaló `MAXIMO_BYTES` y `MAXIMO_DE_FILAS` como exports sin usar. No eran código muerto: eran los
topes de `SEGURIDAD.md` §5.1 **declarados y desconectados**. Estaban escritos desde que se escribió
el parser y no los aplicaba nadie. Es INC-007 al revés: no es que el verde mienta, es que el rojo
dice más de lo que parece. **Cuando knip señale una constante de configuración, pregunta si es que
sobra o es que no se aplicó.**

**4. `audit:arch` corrigió el sitio de dos tipos de negocio.**
`TipoDeProducto` y `OrigenDePrecio` vivían en los puertos. Son reglas —SPEC §8 y D8—, y el dominio
del lote los necesitaba: la regla de dependencia lo paró y se mudaron al dominio, con el puerto
reexportándolos. **Cuando el dominio necesita un tipo que está en `application`, casi siempre el tipo
está en el sitio equivocado.**

**5. El CLI abre sesión con contraseña, por el mismo camino que el navegador.**
La alternativa —un atajo que fabricara una `SesionActiva` sin credenciales— era una puerta que no
existe en ningún otro sitio del sistema, y bastaría con que alguien la expusiera un día por HTTP.
Con `IniciarSesion` + `ValidarSesion` no hay puerta nueva, y se hereda el bloqueo por intentos y el
registro en `audit_log`. **La contraseña llega por `COSTEO_IMPORT_PASSWORD`.**

**6. El importador se niega en producción, y la salida es una bandera explícita.**
`--operacion-supervisada` levanta la negativa, exige además `--confirmar`, e imprime contra qué base
va a escribir antes de hacerlo. El procedimiento completo está en `docs/runbooks/despliegue.md`. Se
resolvió en P10 a propósito: dejarlo para el día del despliegue habría costado la tarde.

**7. Lo que se aplazó del importador, y por qué se puede aplazar.**
El primer cliente **no es el dueño del Excel de referencia**, así que el importador **no aprende su
dialecto**: ni alias de cabecera ni el mapeo `INS`/`SUP`/`SUB`/`LNK`. Sería vocabulario de un archivo
que no se va a importar. **La pasada de análisis no escribe nada** y ya reporta columnas no
reconocidas y obligatorias ausentes: cuando llegue el archivo real, ajustar los alias es media hora
sin tocar el camino de escritura.

### Lo que un «tú» futuro necesita saber de P9

**1. El error de este paquete que sobrevive a una revisión es promediar un porcentaje.**
Un local que vende 200 con food cost del 80 % y otro que vende 100.000 con el 30 % dan **30,1 %**, no 55 %. La media simple le da a cada local un voto igual y el dueño decide por dólar. Los dos números son plausibles en pantalla; solo uno decide precios bien. La prueba unitaria lleva los dos y compara contra la media simple explícitamente.

**2. La comparativa de compras sale del LIBRO, no de `reference_price`.**
El precio de referencia es de company y no tiene ubicación: compararlo entre locales daría el mismo número siempre. Lo que varía es la factura, y `purchase_article_id` en `inventory_movement` estaba puesto desde P6 exactamente para esto. Hay una prueba que lo fija: el precio de referencia es 2,00 y la comparativa devuelve 1,20 y 1,68.

**3. El consolidado escala LINEAL, y el presupuesto se cumple al 92 %.**
Diez ubicaciones: p95 de **734 ms contra 800**, medido con la API y la base en la misma red. La proporción es 8,9× pese al `Promise.all`, porque la mayor parte del trabajo es CPU de Node y eso no se paraleliza esperando. **Alrededor de doce ubicaciones se rompe** — ahí entra la vista materializada que ADR-012 §7 deja diseñada.

**4. `audit:forbidden` paró un atajo real y el arreglo mejoró el diseño.**
El repositorio de `inventory` resolvía nombres leyendo `item` y `purchase_article` directamente. La regla `tablas-de-catalogo-solo-en-catalog` lo cazó: ahora devuelve ids y `analytics` pone los nombres con `ListarItems` y `ListarArticulos`.

**5. El hook de pre-commit podía pasar en verde SIN correr la integración, y se arregló.**
Con la base arriba y sana, la sonda TCP de `audit:tests` —un intento, 1,5 s— la tragó el atasco de INC-016 y el check se degradó a `PARCIAL`. Es INC-007 caso 8 en el peor sitio: se degrada justo bajo las condiciones que hacen falso todo lo demás. Ahora son **tres intentos**: una base apagada falla las tres al instante, una viva con hipo contesta a la segunda.

**6. La migración de P9 no crea ni una tabla.** Solo un permiso. Es la señal de que P8 dejó el terreno hecho: el consolidado es la suma de lo que cada ubicación ya publica, no un cálculo nuevo por otro camino.

### Lo que un «tú» futuro necesita saber de P8

**−1. Si `npm run audit` falla en pruebas de integración que NO tocan lo que cambiaste, mira el tamaño de la base antes que el diff.**
Las suites siembran y no limpian, y el libro es append-only **también para el dueño**: no se puede borrar por company. La base crece hasta que el timeout de 2 s tumba peticiones **al azar**, en suites distintas cada vez. `npm run db:reset -- --si`. Es **INC-014**.

**0. El Excel se puede leer, y se leyó. Está en `C:\Users\Lander\Downloads\`.**
No hace falta `openpyxl`: un `.xlsx` es un ZIP con XML, y `scratchpad/xlsx.py` lo lee en 60 líneas. **Cuando una fórmula del SPEC sea dudosa, míralo.** La verificación de P8 cerró una duda de dos paquetes, confirmó el hallazgo del rendimiento por lote contra la fuente y encontró dos divergencias que nadie había escrito. Sigue sin versionarse: es dato de cliente.

**1. R7 destapó un fallo de P6 que llevaba dos paquetes con 596 pruebas en verde encima.**
La receta es del **lote**; la venta, de **porciones**. Vender 100 unidades de un producto que rinde 2 consume **50** lotes, no 100 (SPEC §14: `costo_por_porcion = costo_neto_lote / rendimiento_porciones`). P6 no dividía, así que con rendimiento 4 cada venta sacaba del inventario cuatro veces lo real.

**Ninguna prueba lo vio porque todos los productos de prueba tenían rendimiento 1**, que es el único valor con el que multiplicar y dividir coinciden. La corrección vive en `totalConsumido`, el punto único que P6 y P8 comparten. **ADR-011 §1.**

**Verificado después contra el Excel**, que divide exactamente igual. Y el tamaño real del fallo: **11 de los 48 productos del cliente tienen rendimiento distinto de 1**, con valores de hasta **185**.

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
2. **Las vistas no están contrastadas contra el Excel celda a celda**, y ahora se sabe por qué no se puede: **el Excel no tiene ninguna unidad vendida cargada** (`T2_PRODUCTOS.H` es cero en los 48 productos). Sus tres vistas que dependen de ese dato están en cero. No hay valores esperados que extraer — pero **sus fórmulas sí se verificaron una a una**, y coinciden.
3. ~~El coste de armar el contexto no tiene medición propia~~ ✅ **Medido en P9: 734 ms de 800 con diez ubicaciones.** Cumple al 92 % y escala lineal, así que **doce ubicaciones lo rompen**. Es el aviso que P10 y P11 heredan.
4. ~~El consolidado puede sumar meses cerrados con abiertos~~ ✅ **Resuelto en P9:** la respuesta trae `estadoDelPeriodo` por ubicación y los contadores `cerradas` / `abiertas`.
5. **D4 (`LNK`) sigue en 🔴.** No ha bloqueado nada; bloquea la migración de datos del Excel.
6. **Nadie puede leer `audit_log`** — pendiente estructural de P11, sin cambios desde P7.

### Lo que la limpieza de la base destapó — leer antes de tocar una prueba de rendimiento

**La base de desarrollo se vació por primera vez desde P0.** Pasó de 3087 MB a 12 MB, y con ella cayeron tres cosas que llevaban tiempo tapadas:

1. **El puerto 5432 del host llegaba a pgbouncer, no a PostgreSQL.** Es **INC-015**. Explica los `ETIMEDOUT` que INC-014 atribuía al tamaño de la base: con `DEFAULT_POOL_SIZE: 1`, dieciocho suites entrando por el pooler se atascan. `docker compose down && up` lo arregla; `restart` no. **INC-014 quedó corregida** en vez de reescrita: el diagnóstico incompleto se deja visible.

2. **`db:reset` tenía dos errores, y el segundo era silencioso.** `DROP SCHEMA public CASCADE` no lo puede deshacer `costeo_migrator` —es dueño del esquema, no de la base— y además se habría llevado `pg_stat_statements` y `pg_trgm`, que viven en `public` y los crea `initdb` **como superusuario**. El script vacía ahora el esquema en vez de tirarlo.

3. **Dos pruebas de plan pasaban por el residuo de corridas anteriores.** Exigían índice donde `Seq Scan` era la elección **correcta**: la company medida era la tabla entera. Pasaban porque cientos de companies viejas hacían de ruido por accidente. Corregido: `rendimiento-de-costeo.spec.ts` siembra sus propias `COMPANIES_DE_RUIDO = 9`.

**La regla que queda, y vale para P9 en adelante:** una prueba de rendimiento que solo pasa sobre una base sucia no mide el sistema, mide el residuo. Si escribes una que compare planes, **siembra tú el ruido**.

### Cómo se mide ahora el presupuesto de §5 — y la deuda que deja

**`/costeo` está bien: p95 ≈ 85 ms contra 400 en la topología de producción.** Lo que estaba mal era dónde se medía. Las tres suites de rendimiento corren en el host y hablan con la base por el proxy de Docker Desktop, que se atasca ~300 ms cuando cruza volumen: **nunca han medido el sistema.**

Lo implementado:

1. **La medición se ejecuta siempre y su número se imprime siempre**, en cualquier máquina.
2. **El presupuesto solo se exige en CI**, que corre sobre Linux con el mismo `docker-compose.yml` y sin ese proxy.
3. Fuera de ahí la aserción se salta **con el motivo escrito en la salida**.
4. Las aserciones de **plan** (`EXPLAIN`, uso de índice) siguen corriendo en todas partes: el plan no depende del transporte.

**Se intentó antes una sonda** que midiera el transporte y decidiera sola. No funciona: el atasco va y viene por minutos, así que medirlo veinte segundos antes no predice nada. Daba falsos verdes y falsos rojos **pareciendo rigurosa**. Está contado en INC-016 para que nadie lo reintente.

**Y una regla operativa que sale de ahí:** `docker compose stop api` antes de correr la suite. Con `costeo-api` levantado, el transporte del host pasa de un máximo de 20 ms a uno de **60 segundos**, y la suite de 18 en verde a cinco archivos en rojo distintos cada vez.

> **Deuda técnica, con fecha de pago en P9.** El presupuesto queda guardado por CI y por nadie más. Lo que corresponde es **`npm run bench`**: un banco que levante la API en la red de compose y mida ahí. P9 lo necesita de todos modos — trae su propio presupuesto de 800 ms para el consolidado de diez ubicaciones, y medirlo a través del proxy no serviría de nada.

### Estado de los doce checks

| Check | Estado | Nota |
|---|---|---|
| `audit:types` | ✅ | |
| `audit:lint` | ✅ | Con `--no-inline-config` |
| `audit:forbidden` | ✅ | 31 reglas sobre **303 archivos**. **Paró un `as unknown as` real en P10** |
| `audit:arch` | ✅ | 267 módulos, 1171 dependencias. **Paró dos tipos que vivían en la capa equivocada** |
| `audit:deadcode` | ✅ | Sin lista blanca. **Destapó dos límites de seguridad desconectados** |
| `audit:complexity` | ✅ | |
| `audit:duplication` | ✅ | **0 clones.** Cazó dos en P10 |
| `audit:migrations` | ✅ | M1–M11 · **11 migraciones** |
| `audit:secrets` | ✅ | |
| `audit:deps` | ✅ | |
| `audit:sec-headers` | ✅ | 18 pruebas |
| `audit:tests` | ✅ | **558 unitarias** (sin base) + **277 de integración**; 5 saltadas con motivo (INC-016) |

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
| P8 — Vistas analíticas | ✅ Completado | `0067bd1` | 2026-09-04 |
| P9 — Consolidado y comparativa | ✅ Completado | `47f1e7d` | 2026-09-06 |
| **P10 — Importación de catálogo, acotada** | ✅ Completado | *(el de este paquete)* | 2026-09-07 |
| P11 — Back office | ⏸️ **POSPUESTO** | — | Con un cliente, el back office es el usuario |
| P12 — Frontend app cliente | 🟡 **Siguiente, recortado a 5 pantallas** | — | Fase C del sprint |
| P13 — Frontend back office | ⏸️ **POSPUESTO** | — | No hay back office que operar |
| P14 — Capa visual | ⏸️ **POSPUESTO** | — | Frontend sobrio, sin identidad de marca |
| P15 — Endurecimiento | ⏸️ **POSPUESTO** | — | El aislamiento sigue vigente; la escala se pospone |

Estados: ⬜ Pendiente · 🟡 En curso · ✅ Completado · ⏸️ Pospuesto con motivo

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
| 40 | **La escritura en lote es un método de repositorio nuevo por módulo**, no un envoltorio | P10 | `ClienteDeTransaccion` no expone `$transaction`: una transacción no puede contener a otra |
| 41 | **La atomicidad es POR PASADA, no entre módulos.** Se compensa validando todo antes de escribir nada | P10 | Limitación del ORM, no del diseño. Documentada en el puerto y en `CONSTRUCCION.md` |
| 42 | **Una línea es receta o es combo según el TIPO DEL PRODUCTO DESTINO**, no según una columna | P10 | SPEC §8 ya lo dice. Pedírselo al archivo sería pedirle que repita algo con opción a contradecirse. **ADR-014** |
| 43 | **Un combo no puede contener otro combo** | P10 | Es lo que «componentes que son productos simples» significa, y hace innecesario validar ciclos ahí |
| 44 | **Los precios importados se confirman en bloque, a petición explícita** | P10 | R5 exige que alguien decida, no que decida 149 veces. Queda en `audit_log` con su nombre |
| 45 | **El CLI abre sesión con contraseña, por el camino del login** | P10 | Un atajo que fabricara sesiones sería una puerta que no existe en ningún otro sitio |
| 46 | **`import_job` no tiene ninguna FK hacia lo importado** | P10 | Si la tuviera, borrar un ítem obligaría a decidir qué hacer con su historia |
| 47 | **El análisis vive en `jsonb` y no se lee de vuelta** | P10 | Es caché de algo reproducible. Leerlo tipado exigía un `as unknown as` que `audit:forbidden` para |

---

## Dudas abiertas para el usuario

| # | Duda | Paquete que la levantó | Qué bloquea |
|---|---|---|---|
| 1 | **La máquina de desarrollo corre Node 24.19.0; ADR-001 fija 24.20.0.** `engines` admite `>=24.19.0 <25` | P0 | Nada hoy |
| 4 | ~~La explosión del consumo no aplica el rendimiento del ítem~~ | P6 | ✅ **CERRADA: verificado contra el Excel.** `T3_RECETAS.N` usa la cantidad de la receta tal cual; el rendimiento del ítem (`T1.L`) aparece **solo** en el costo (`T1.M = K/L`). El rendimiento encarece la unidad, no aumenta lo que sale de la bodega. **ADR-011 §1** |
| 7 | ~~El MC promedio de menu engineering: el SPEC y el Excel se contradicen~~ | P8 | ✅ **CERRADA en P10 por decisión del usuario: se queda PONDERADO**, como dice SPEC §319 y como es el Kasavana-Smith canónico. El `AVERAGE` del Excel es el atajo que la hoja hace fácil, y con cola larga desplaza el eje y reclasifica platos entre cuadrantes. La implementación actual era correcta. **ADR-015**, que además hace visible el MC de referencia y sus dos operandos para que el cliente pueda reproducirlo |
| 5 | **Las seis vistas no se pueden contrastar contra el Excel celda a celda**, porque el Excel no tiene dimensión temporal (SPEC §3). La aritmética está probada con casos a mano y R7 cierra sobre el sistema entero | P7 · P8 | Nada. Es una limitación del origen, no una tarea pendiente |
| 8 | ✅ **RESUELTA: `/costeo` cumple §5 con holgura. La que fallaba era la medición.** En la topología de producción —API y base en la misma red— el p95 es **~85 ms contra un presupuesto de 400** (21 %). El modo de 370 ms era **el proxy de Docker Desktop en Windows**, que se atasca ~300 ms cuando cruza un resultado grande: la misma consulta de 1.600 filas tarda 2 ms dentro del contenedor y pega picos de 320 ms desde el host. **INC-016** trae las once cosas que se descartaron midiendo | P8 | **Pero deja una decisión abierta: las tres suites de rendimiento corren en el host y nunca han medido el sistema.** Ver abajo |
| 6 | **El coste de armar el contexto de las vistas no está medido.** Cinco consultas más el costeo de la carta, por (ubicación, mes) | P8 | Nada hoy. **P9 lo multiplica por el número de ubicaciones** y tiene presupuesto de 800 ms |

---

## Deuda técnica aceptada conscientemente

> Solo entra aquí lo que el **usuario aprobó explícitamente** posponer.

| # | Deuda | Paquete | Cuándo se paga |
|---|---|---|---|
| 1 | **`npm run bench`** — el presupuesto de tiempo de §5 solo se exige en CI, porque el proxy de Docker en Windows falsea la medición en local (INC-016). Falta el banco que mida en la topología de producción | P8 | ⚠️ **VENCIDA DOS VECES.** Se fijó para P9 (no se pagó) y se re-fechó a P10 (tampoco). **Nueva fecha: después del lanzamiento**, y el motivo se dice en voz alta — este sprint no añade ningún presupuesto p95 nuevo y el tiempo sale del frontend. **Decisión del usuario, no un olvido** |
| 2 | **Vistas materializadas para períodos cerrados** — el plan de P9 las listaba; no se construyeron porque el criterio de aceptación se cumple sin ellas y una caché de números es una fuente de números rancios | P9 | **Cuando aparezca una company con más de diez ubicaciones**, o cuando el número de CI se acerque al techo. El umbral está medido, no supuesto: ADR-012 §7 |

| 3 | **Los alias del dialecto real del cliente** en los descriptores de importación | P10 | Cuando llegue su archivo. La pasada de análisis **no escribe nada** y ya reporta columnas no reconocidas y obligatorias ausentes: ajustarlo es media hora sin tocar el camino de escritura |
| 4 | **Prueba de similitud dominio ↔ `pg_trgm`** — el dominio quita tildes y `pg_trgm` no. Medido: `similarity('tomate riñón','tomate rinon') = 0.53`, por encima del umbral de 0.3, así que el criterio de aceptación se sostiene; lo que no está probado es que coincidan siempre | P10 | Después del lanzamiento |

> **Pendiente estructural, no deuda:** nadie puede leer `audit_log` porque no existe rol con `SELECT` sobre ella. Es lo que SEGURIDAD.md §10 pide, no un olvido, y se resolvía en **P11 — que está pospuesto**. Con un solo cliente el back office es el usuario, pero conviene saber que el log se escribe y no se lee.

> **Una tabla con lectura y sin escritura no la ve ningún check.** `combo_component` llevó seis paquetes así. `audit:deadcode` mira exports de TypeScript, no rutas de escritura a la base.

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
- **`docs/incidencias/README.md` tiene CATORCE fichas.** Se lee al inicio de cada paquete y antes de diagnosticar cualquier error. **INC-007 (9 recurrencias), INC-008, INC-012 e INC-013 no son de una herramienta concreta**, y merecen leerse aunque no se esté diagnosticando nada
- El Excel de referencia está en `C:\Users\Lander\Downloads\Modelo_Costeo_Auditado_SNACKLAB.xlsx`. **No está versionado y no debe estarlo**: es dato de cliente
- **La verificación de versiones de ADR-001 se hizo el 2026-08-26.** Si pasan meses, reverificar antes de fiarse de las fechas de EOL
- **Node 26 promueve a LTS el 2026-10-28**, dentro de dos meses. El salto es el ítem C7 de FASE0-CHECKLIST y merece su propio paquete
- **La misma forma de fallo lleva tres paquetes seguidos apareciendo**: P5 con R7, P6 con el saldo, P7 con la cobertura. **Un invariante agregado que se cumple tapando un desglose que no.** Cuando un número global esté verde, pregúntate qué desglose lo estaría tapando, y comprueba **cifras absolutas** contra casos calculados a mano — no relaciones entre ellas
- **El contador de archivos de `audit:forbidden` no es decorativo.** Cuando una regla cambia de alcance, ese número tiene que moverse (INC-007 caso 9)
- **Una prueba de plan de ejecución necesita volumen REALISTA, no solo mucho volumen** — y tiene que **aceptar el plan bueno**: exigir `Index Scan` sobre una tabla diminuta rompe la prueba por un plan que está bien. Es la otra mitad de la misma lección
- **`docs/sistema/guardas-de-dominio.md` cubre P0–P7.** M11 falla si una migración nueva con `CHECK` o `RAISE EXCEPTION` no tiene su sección. **Ha parado las dos migraciones a las que se ha enfrentado**, y es la razón de que INC-012 no haya reaparecido
- **`SET`-y-`superRefine` de Zod no corren si otro campo falló.** Toda validación que sea control de seguridad va en el CAMPO
- **Y la lección que las engloba: un check que FALLA tampoco está verificado.** Hay que preguntarse en **cuántos** sitios falla. El verde no es el único color sospechoso
