# CHANGELOG

Una entrada por commit de paquete. Formato: `## P{n} — {nombre}` con fecha, qué se entregó y qué quedó pendiente.

---

## P6 — Inventario · libro mayor append-only · 2026-09-04

**Objetivo:** saber cuánto hay y por qué, sin poder mentir.

### Entregado

- **`inventory_movement` append-only en tres capas** —privilegio, trigger de sentencia y `audit:forbidden`— con los **siete** tipos del SPEC §7. Extendido a `inventory_transfer` e `inventory_production`, que son cabeceras de hechos ya escritos
- **El saldo es `SUM(quantity)`, no un campo.** No existe `inventory_balance`, y era lo previsto: R3
- **La cantidad lleva signo, y lo garantiza la base.** `CHECK` que cruza dirección con signo, más **clave foránea compuesta `(type, direction)`** para que la dirección no pueda discrepar de su catálogo — sin ella, declarar `('COMPRA','SALIDA')` colaría una cantidad negativa
- **Transferencias como par atómico** que **suma cero por construcción**: la entrada es `salida.negated()`, no una comprobación que alguien pueda quitar
- **Producción con R10 entera**: el alta al costo **estándar**, el costo **real** del lote al lado, y la varianza. Efecto buscado: la suma de los importes de los movimientos `PRODUCCION` de un lote **es** la varianza
- **Corrección de signo contrario que CONSERVA el tipo**, para que `compras_del_mes` (SPEC §16) se cancele sola. Es la única excepción a la regla de signos, acotada en el `CHECK` a `reverses_movement_id IS NOT NULL`
- **El interruptor de stock, conmutable** (`llevaStock` en `catalog`): con stock propio se consume la preparación; sin él, al vender se explota su receta
- **`BODEGA` escribe el libro y no puede leerlo**: `inventory.read` no se le concede, y **ninguna escritura devuelve el saldo resultante** — con él despejaría la receta (§4.3)
- **`exigirUbicacionEnAlcance` se muda de `recipes` a `iam`**, que es su sitio: es autorización de sesión
- **El presupuesto medido**: p95 **60,8 ms** contra 300, con 500 ítems y 1,2 millones de movimientos en la tabla, y los planes verificados
- **ADR-009** con las cinco decisiones que el SPEC no escribe
- **596 pruebas**: 383 unitarias con la base apagada, 213 de integración

### Lo que se descubrió por el camino

**Novena recurrencia de INC-007, y la cazó la regla que dejó escrita la octava.** Al forzar el guardián de las dos reglas append-only nuevas, falló en **2 sitios cuando debía fallar en 4**. El glob `prisma/migrations/**/*.sql` está anclado a la raíz y las migraciones viven en `apps/api/prisma/...`: **desde P0, `no-select-star` y `append-only-sql-audit_log` no habían examinado una sola migración.** El contador del informe pasó de 189 a 203 archivos, que es la medida de que el arreglo hizo algo.

**La prueba del plan de ejecución no medía nada al principio.** Con una sola ubicación en la tabla, `Seq Scan` es la elección correcta —la tabla entera es el resultado— y la prueba fallaba por un motivo ajeno al índice. Se arregló sembrando 19 ubicaciones de ruido. Misma lección de INC-007, aplicada a un dato en vez de a un glob.

**El mismo número salía con dos formas:** `_sum` de Prisma devuelve `"8.5"` y leer la columna devuelve `"8.500000000000"`. Todo pasa ahora por la escala de almacenamiento, que además permite comparar el `SUM` de PostgreSQL con el pliegue del dominio sin normalizar nada.

**INC-012 no reapareció, aunque `ESTADO.md` la daba por segura en este paquete.** Los triggers append-only resultaron inalcanzables desde la API —no existe ruta que edite un movimiento, y lo sostiene `audit:forbidden`, no la disciplina de nadie— y **M11 paró la primera migración a la que se enfrentó**, obligando a clasificar las 18 restricciones antes del primer endpoint.

**El guardián 3 enseña más por lo que no rompe.** Emitiendo la corrección como `AJUSTE` fallan 3 pruebas de 74, y siguen en verde el saldo, la reconstrucción del libro y el criterio de aceptación de P6. Lo único que lo caza es la agregación por tipo. Es la misma forma de fallo que R7 en P5: un invariante que se cumple tapando uno que no.

### Pendiente

- **La tabla de unidades vendidas.** P6 registra la *consecuencia* de una venta sobre el stock, no la cifra de ventas: son datos distintos, con períodos distintos. La necesita P8
- **El semáforo `REPONER`/`OK` para `BODEGA`** llega en P8, con el punto de reorden de SPEC §18. Los permisos ya están repartidos para que sea el único dato que reciba
- **El rendimiento por lote de una subpreparación**: se decidió **no** añadir columna. La receta ya es por unidad de uso y producir 5 litros es `receta × 5`. Es aditiva si el usuario la quiere
- **La explosión del consumo no aplica el rendimiento**, siguiendo SPEC §4.3. Anotado como duda: afecta al stock teórico de P8

---

## P5 — Motor de costeo · 2026-09-04

**Objetivo:** el cálculo correcto, demostrable y sin base de datos.

### Entregado

- **El motor, en `costing/domain`**: costeo del producto (SPEC §14 entero), cascada de subpreparaciones y costo de combos. **45 pruebas con PostgreSQL apagado**
- **`docs/pruebas/casos-conocidos.md` completo**: CC-004 (AP frente a EP), CC-005 (cascada), CC-006 (combo), CC-007 (IVA no recuperable) y CC-009 (los cuatro bordes) — **escritos antes de tocar el motor**, como el plan exige
- **R6 cierta por construcción**: se divide una vez y el margen es el complemento, así `mc% + food_cost% = 1` no depende de que dos redondeos no caigan a la vez en un empate
- **R10, R12 y R14 activas** · **R4 aplicada** con los dos casos dando números distintos
- **R7 a través del motor**, no con valores transcritos: `0.00` con canario a `1e-6`
- **`GET /costeo`** y **`GET /costeo/:productId`**, con permiso `costing.read` que **`BODEGA` no tiene** (§4.3, comprobado sobre la respuesta cruda)
- **El empaque es un ítem** (`product.packaging_item_id`), no una tabla propia — **ADR-008**
- **El presupuesto de rendimiento, medido**: p95 **136,8 ms** sobre 200 productos y 1.600 líneas, contra 400 de presupuesto, con los planes de ejecución verificados
- **505 pruebas**: 343 unitarias con la base apagada, 162 de integración

### Lo que se descubrió por el camino

**R7 no detecta un costo equivocado.** Al invertir R4 fallan 12 pruebas y **ninguna es CC-R7**: la conciliación es una identidad algebraica y el costo aparece en sus dos lados. Detecta deriva y términos que faltan; no detecta un número mal calculado. Lo que caza eso son los casos conocidos, y por eso sus valores salen del Excel.

**Dos restricciones de la base salían como 500** — un producto activo sin PVP y un precio sin artículo. La base garantizaba; el dominio no explicaba. **INC-012**, con las dos guardas añadidas y **M11** en `audit:migrations` para que no vuelva.

**Octava recurrencia de INC-007, con el mismo carácter que la séptima.** La regla nueva marcaba 3 migraciones de 5 porque su `` era un retroceso literal. La destapó preguntarse **cuántas** deberían fallar, no si fallaba. Prevención: `sin-caracteres-de-control` en `audit:forbidden` — la primera de INC-007 que impide que el fallo se escriba.

**La documentación de API y del modelo de datos se había quedado en P2.** P3 y P4 dieron H4 por bueno sin estarlo. Los tres tramos se escribieron en este commit.

### Pendiente

| Qué | Cuándo |
|---|---|
| El rendimiento por lote de una subpreparación: hoy la receta va por unidad de uso | **P6.** Merece confirmarse antes |
| Menu engineering y las demás vistas (SPEC §15–§18) | P8 |
| R7 con dataset completo: compras reales y conteo físico | P8 |
| Previsualizar qué platos se mueven al confirmar un precio | P8 |

---

## P4 — Recetas, productos y combos · 2026-09-04

**Objetivo:** que un ciclo se rechace al guardar y que propagar entre locales sea una decisión con marcha atrás.

### Entregado

- **12 tablas**: `product`, `product_location`, `combo_component`, `recipe` versionada, `recipe_line`, el registro de propagación y cinco catálogos
- **R9 activa** — ciclos rechazados **al guardar**, directos y a tres niveles, con el camino (`mayonesa → salsa → mayonesa`) en el mensaje. Recorrido memorizado que corta al primer ciclo
- **R11 activa** — previsualización con cuántas ubicaciones perderían su receta, permiso separado de nivel company, registro de quién propagó qué, y **reversión por local que no borra nada**
- **R4 modelada y probada** — la base AP/EP con los dos casos dando resultados **distintos y conocidos**
- **E12 pasa a regla activa** — `BODEGA` no ve recetas, comprobado sobre la respuesta cruda
- **ADR-007** — propagación por copia frente a herencia
- **444 pruebas**: 298 unitarias con la base apagada, 146 de integración

### Lo que se descubrió por el camino

**Un error de dominio que no lo era.** `CicloEnRecetaError` extendía `Error` a secas y salía por el filtro como `INTERNAL_ERROR` 500 —un fallo del servidor— cuando lo que hay es una receta mal escrita. El `Record` exhaustivo de códigos hace su trabajo solo si el error entra por la puerta.

**Los parámetros de consulta entraban sin validar.** `GET /recetas` empezó con cinco `@Query` sueltos y `max-params` lo marcó. La solución no fue agruparlos: se les puso **esquema**, igual que a un cuerpo. Un parámetro de URL es entrada no confiable exactamente igual.

### Pendiente

| Qué | Cuándo |
|---|---|
| El cálculo del costo del producto (SPEC §14) | P5 |
| Componentes de combo por API | Sin paquete: la tabla y sus reglas existen, el endpoint no |
| Lista blanca de knip para `shared/domain/**` | P5, y **P5 no cierra con ella puesta** |

---

## P3 — Precios de referencia con vigencia · 2026-09-04

**Objetivo:** ningún precio se mueve solo.

### Entregado

- **`reference_price` con vigencia**, nunca sobrescritura (R5). El precio cuelga del **artículo de compra**, porque «2.30» no significa nada sin «el saco de 2 kg»
- **La cadena de costo del insumo de SPEC §12, completa y como dominio puro** — precio neto, costo bruto de uso, costo neto de uso y sobrecosto de merma, con las dos guardas de cero del SPEC. **P5 la puede usar tal cual**
- **Los parámetros de costeo de D3**, sembrados por un trigger al nacer la company. Ninguno está en el código
- **R5 hecha cumplir en cuatro capas**: el estado, dos permisos separados, un trigger que impide reescribir el importe, y la condición en el `WHERE` que cierra la carrera entre dos confirmaciones simultáneas
- **408 pruebas**: 277 unitarias con la base apagada, 131 de integración

### Los tres criterios, probados

**E8** — se confirma un precio de enero, se lee el costo de febrero, se confirma uno de marzo, y el costo de febrero es el mismo. **E9** — un precio sugerido existe, se ve, y el costo devuelve 404 hasta que alguien lo confirma. **E20/R13** — sin IVA recuperable el costo sube exactamente 1.15 veces, ni un dígito más.

### Lo que se descubrió por el camino

**`migrate:new` dependía de la base de desarrollo de cada quien.** `prisma migrate dev` es interactivo y se planta ante cualquier aviso —dos de ellos espurios en este paquete—, y peor: mira los **datos** de la base local para decidir si avisa. Se cambió a `migrate diff`, que produce el mismo SQL, no es interactivo y compara `prisma/migrations` con el modelo. La misma técnica que el paso del `down` ya usaba por la misma razón.

**Una prueba de la base pasaba sin tocar nada.** «Un precio confirmado no se puede reescribir» lanzaba el `UPDATE` sin tenant: RLS filtraba, cero filas, y `UPDATE 0` es un éxito — el trigger nunca se disparaba. Es INC-007 en otra forma. Ahora la escritura va por `TenantTransaction` y la afirmación es sobre el importe guardado, no sobre el mensaje que Prisma envuelve.

**La regla del catálogo escrita en P2 hizo su trabajo en P3.** `pricing` necesitaba el rendimiento del ítem y el primer intento consultó `tx.item` a mano; `tablas-de-catalogo-solo-en-catalog` lo marcó, y se resolvió como manda CLAUDE.md §2 — `catalog` exporta `LeerItem`.

### Una decisión que merece confirmación

**La tasa de IVA de compra se modeló en el PRECIO, no en la company.** El SPEC la nombra en la fórmula de §12 pero no dice dónde vive, y §11 solo trae «recuperable SI/NO». En Ecuador el alimento sin procesar es 0 % y el detergente 15 %: una única tasa por company estaría equivocada para uno de los dos. Se eligió el superconjunto — si la intención era una sola tasa, este modelo la expresa; al revés habría que migrar cada precio.

### Pendiente

| Qué | Cuándo |
|---|---|
| Sugerencia automática desde la compra real (`ULTIMA_COMPRA`) | P6, cuando exista el movimiento que la dispara |
| El rendimiento con vigencia | Sin paquete: hoy el costo histórico usa el rendimiento actual del ítem |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |

---

## P2 — Catálogo: ítems, artículos de compra, unidades · 2026-09-04

**Objetivo:** la fuente única de verdad del proyecto.

### Entregado

- **Ocho tablas**: `unit` (global, de solo lectura para la aplicación), sus catálogos, `item_group`, `item` y `purchase_article`, todas con RLS `ENABLE` + `FORCE`
- **El factor de conversión se CALCULA, no se captura** — se deriva cuando la presentación y la unidad de uso comparten dimensión, se exige cuando no, y se **rechaza** cuando es derivable
- **La fuente única de verdad, hecha cumplir por dos vías**: `audit:arch` impide importar la infraestructura de `catalog`, y `audit:forbidden` impide tocar sus tablas desde cualquier otro sitio
- **Índice GIN + `pg_trgm`** sobre `lower(name)` para la deduplicación de P10, como índice de expresión y no como columna generada
- **371 pruebas**: 253 unitarias con la base apagada, 118 de integración

### Deuda pagada

**La excepción `enmiendasAutorizadas`** de `sin-migracion-commiteada-modificada` está retirada, tal como se había escrito en P1. La lista está vacía y la regla sigue midiendo — con su prueba del guardián.

### Lo que se descubrió por el camino

**M10 marcaba un borrado legítimo.** El `down` de P2 retira las capacidades `catalog.*` de `permission`, a las que solo apunta `role_permission`, que se vacía en la sentencia de al lado. La primera versión marcaba **todo** borrado sobre una tabla que sobrevive, y eso habría empujado a abrir una lista de excepciones por migración — el patrón que INC-011 y `no-sql-interpolado` ya enseñaron que envejece mal. Ahora M10 **lee las claves foráneas** y solo marca cuando alguien que apunta a esa tabla no se vacía ni se suelta en el mismo archivo. Sigue cazando el caso original.

**El código de dominio `CONFLICTO` volvió**, retirado en P1 por no tener consumidor. El `Record` exhaustivo del filtro obligó a mapearlo antes de compilar, que es exactamente para lo que está.

### Desviación del plan, consciente

**No existe la tabla `unit_conversion`** que los entregables listaban. Entre unidades de la misma dimensión sus filas serían derivables del cociente de `factor_to_base`; entre dimensiones distintas —«un huevo pesa 50 g»— la conversión no es universal sino **del ítem**, y por eso vive en `purchase_article.conversion_factor`. Una tabla global entre `unid` y `g` afirmaría que todos los huevos pesan lo mismo.

### Pendiente

| Qué | Cuándo |
|---|---|
| Plegado de acentos en la deduplicación | P10, en la consulta |
| Unidades propias por company | Sin paquete; hoy se modelan como presentación del artículo |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |

---

## P1 — IAM · tenants · ubicaciones · roles · 2026-09-04

**Objetivo:** que el aislamiento funcione antes de que exista un dato de negocio.

### Entregado

- **Las tres barreras de CLAUDE.md §4.1, completas y probadas.** 14 tablas con RLS `ENABLE` + `FORCE` y 29 políticas; un envoltorio único de transacción-con-tenant; el tenant saliendo de la sesión y de ningún otro sitio
- **Login completo** — política anti fuerza bruta con dos ventanas y umbral distinto por eje, Argon2id con tiempo constante frente a correos inexistentes, sesión con token opaco de 256 bits hasheado en base, rotación al iniciar y revocación total al cambiar contraseña
- **Autorización deny-by-default** — guard global, capacidades en vez de roles rígidos, escalada vertical y horizontal probadas
- **Ubicaciones, invitación de usuario y asignación de roles**, con el límite del plan resuelto dentro de la transacción que inserta
- **Invitación de punta a punta sin una sola credencial real**, usando el adaptador falso de correo que P0 dejó cableado
- **`audit:deps`**, el duodécimo check: acepta avisos uno a uno con motivo y fecha de revisión, y rompe ante cualquiera que no esté en la lista
- **ADR-006** · **INC-010** e **INC-011** · modelo de datos, seguridad, configuración y superficie de API actualizados

### D12 cerrada del todo

**Las cuatro condiciones verificadas**, incluida la que podía obligar a reabrir la elección de ORM: PgBouncer 1.25.2 en modo transacción, con `default_pool_size = 1` para que la reutilización de conexión entre clientes sea segura y no probable. Detalle en ADR-006.

### Lo que se descubrió por el camino

**El repositorio de auditoría de P0 no había funcionado nunca** ([INC-010](incidencias/INC-010-returning-bajo-rls-exige-politica-de-select.md)). `create()` de Prisma emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` pasa por la política de `SELECT`. Se descubrió al escribirle su primera prueba de integración: **un repositorio sin prueba de integración no está verificado**, por evidente que parezca su código.

**Un `down.sql` que `migrate:verify` daba por bueno fallaba en la base real** ([INC-011](incidencias/INC-011-el-down-solo-se-probaba-en-base-vacia.md)), porque `migrate:verify` corre sobre bases **limpias** donde ninguna fila referencia nada. Y la guarda `NOT EXISTS` que se añadió para arreglarlo tampoco servía: bajo RLS, «no hay filas» y «no puedo verlas» son la misma respuesta. Prevención: comprobación **M10**.

**M10 entró en verde sin medir nada** — séptima recurrencia de [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md), cazada por la prueba del guardián en el mismo minuto.

**El limitador de peticiones no tenía ninguna prueba**, y P0 ya lo listaba como pendiente. Ahora la tiene — y hubo que escribirla dos veces, porque el primer intento acabó midiendo el **otro** mecanismo que devuelve 429: el bloqueo por fuerza bruta.

**El bloqueo por IP habría dejado fuera a restaurantes enteros.** Aplicando literalmente el umbral de SEGURIDAD.md §2.1 a los dos ejes, cinco errores repartidos entre cinco empleados detrás del mismo NAT bloquean el local completo durante una hora. Se separó: 5 por cuenta, 25 por IP.

También se **afinó** `no-sql-interpolado` en la dirección estricta: ahora distingue la plantilla etiquetada de Prisma —la forma segura, que antes marcaba— y **la única exención por archivo del repositorio desapareció**. Más `no-prisma-raw` para el único hueco que quedaba.

### Pendiente

| Qué | Cuándo |
|---|---|
| Refresh rotativo con detección de reuso (SEGURIDAD.md §2.2) | P12, cuando exista el cliente que pueda rotarlo |
| Limitador en memoria → Redis | P15 |
| Excepción `enmiendasAutorizadas` de `sin-migracion-commiteada-modificada` | P2 |
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |
| Cesión de propiedad (`OWNER`) | Sin paquete asignado; la puerta está cerrada |
| `EXPLAIN ANALYZE` con volumen sintético realista | P5 |

**329 pruebas en verde** · 227 unitarias con la base apagada, 102 de integración.

---

## P0 — Fundación del repositorio · 2026-08-27

**Objetivo:** que escribir código malo sea difícil. P0 no implementa negocio: implementa las condiciones para que el negocio se escriba bien.

### Entregado

- **`npm run audit` con once verificaciones**, en CI y en pre-commit: tipos, lint, prohibiciones, capas, código muerto, complejidad, duplicación, migraciones, secretos, cabeceras de seguridad y pruebas
- **Tipos de dominio para dinero y cantidades** — `Money`, `Ratio`, `Count`, `Quantity` y `UnidadDeUso`, con marca nominal, `valueOf()` que lanza y API de comparación completa. 98 pruebas
- **Mini-conciliación R7** con tres productos reales del Excel de referencia. `ROUND(diff, 2) = 0.00`, con canario a `1e-6`
- **PostgreSQL 18.6 fijado por digest**, con dos roles separados: `costeo_migrator` (dueño) y `costeo_app` (sujeto a RLS, no superusuario). Verificado por 9 pruebas contra la base real
- **Migraciones reversibles** con `down.sql` generado y verificado por una escalera de cuatro pasos sobre bases reales
- **`audit_log` append-only en tres capas**, con RLS deny-by-default. 14 pruebas
- **Aplicación NestJS** — entorno validado por Zod, `correlation_id` por `AsyncLocalStorage`, `/health` y `/ready` separadas, cabeceras de SEGURIDAD.md §4.4 con nonce por respuesta, limitador, timeout, formato único de error y falsos de correo y almacenamiento
- **CI en GitHub Actions** con acciones fijadas por SHA, que levanta el stack completo y comprueba que responde **sin una sola credencial real**
- **ADR-001 a ADR-005** · **INC-001 a INC-009** · documentación de sistema, modelo de datos, configuración y despliegue

### Decisiones que cierran preguntas abiertas

- **D2 cerrada** (ADR-001): Node 24.20.0, PostgreSQL 18.6, NestJS 11.2.3, Prisma 7.10.0, Next.js 16.3.3, con sus fechas de fin de soporte verificadas en fuente oficial
- **D12 cerrada** (ADR-002): se mantiene Prisma. El RLS nativo existe solo en Prisma 8 RC y cubre la Barrera 1, **no la Barrera 2**

### Lo que se descubrió por el camino

**Seis checks pasaban en verde sin medir nada** — un parser ausente, un fixture en ruta excluida, un glob que dejaba fuera las pruebas, unos patrones de ignorar mal anclados, una clave de configuración que la herramienta ignora, y un guardián que solo cubría dos de las tres formas de abrir una conexión. Cuatro de los seis los encontró la prueba del guardián. Registrado en [INC-007](incidencias/INC-007-un-check-pasa-en-verde-sin-medir-nada.md).

**Una regla de seguridad fallaba abierto**: la comprobación de que `DATABASE_URL` usa el rol de la aplicación no se ejecutaba si otra variable era inválida. [INC-008](incidencias/INC-008-superrefine-no-corre-si-otro-campo-fallo.md), y la regla general está ahora en `CLAUDE.md` §3.

### Pendiente

| Qué | Cuándo |
|---|---|
| Prueba del limitador de peticiones — hoy no protege ninguna ruta | P1 |
| Barreras 2 y 3 del aislamiento | P1 |
| `CompanyId`, `LocationId`, `ItemId`, `ProductId` | P1–P4 |
| `UnitCost` | P3 |
| CC-004 (base AP frente a EP) — no se pudo extraer del Excel: las 293 líneas de T3 están todas en base EP | P5 |
| Generador `prisma-client-js` → `prisma-client` | Con la evaluación de Prisma 8 |
| Salto a Node 26 | Promueve a LTS el 2026-10-28 |

**174 pruebas en verde** · 128 unitarias con la base apagada, 46 de integración.
