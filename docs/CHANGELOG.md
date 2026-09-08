# CHANGELOG

Una entrada por commit de paquete. Formato: `## P{n} — {nombre}` con fecha, qué se entregó y qué quedó pendiente.

---

## P15 — Endurecimiento · 2026-09-08

**Tres hallazgos, ninguno salido de leer código: los tres salieron de ejecutar algo que hasta ahora
no se ejecutaba.**

**Un pentest que ataca** (`test/integracion/pentest.spec.ts`, 21 pruebas con dos tenants vivos:
inyección SQL, IDOR, XSS almacenado, asignación masiva, sesión, fuga por error). Encontró dos
agujeros reales:

- **Un byte NUL convertía cualquier campo de texto en un 500.** PostgreSQL no puede guardarlo y su
  rechazo subía como `INTERNAL_ERROR`; era INC-012 otra vez, alcanzable desde cualquier campo por
  cualquier usuario autenticado. `EsquemaPipe` rechaza ahora los caracteres de control **antes** de
  Zod — nunca en un refinamiento de objeto, que es la trampa de INC-008 — y por punto de código, no
  con una regex que obligue a meterlos en el fuente.
- **`GET /costeo?locationId=<de otra company>` respondía 200.** Sin fuga —RLS aguantó y devolvía los
  productos del propio usuario— pero con **todos los costos a cero**: un número plausible y falso,
  que en este producto es peor que un error. `exigirUbicacionEnAlcance` salía temprano para los roles
  de company. La sesión lleva ahora las ubicaciones de la company (`session_lookup` con un LATERAL,
  cero consultas nuevas por petición) y los 27 llamantes heredaron la comprobación sin tocar ninguno.

**`npm run bench`, la deuda aplazada desde P9.** Base propia creada y borrada, `grants.sql` antes de
migrar, volumen sintético realista (219.000 movimientos, 14.000 líneas de receta, 5 companies para
que RLS filtre), p95 de 30 corridas sobre los casos de uso —no sobre HTTP, INC-016— con el suelo del
entorno medido al lado, y **salida con código 1** si un presupuesto se pasa.

En su primera corrida: **el consolidado tardaba 1.399 ms contra un límite de 800.** No por ninguna
consulta lenta, sino por leer cincuenta veces la tabla `item` y calcular veinte veces los mismos
costos. Se arregló el código, no el umbral: filtro cuadrático en `CostosDeItems` (→1.351), ámbito de
lecturas de company compartidas por operación (→844) y la carta leída una vez por ubicación en vez de
dos (→**677**). El inventario de una ubicación bajó de paso de 156 a 110 ms.

Los doce checks en verde. **578 unitarias + 298 de integración.**

---

## Sprint de salida a cliente — Fases A a D · 2026-09-07 y 08

**Objetivo:** que un restaurante pueda usar el sistema. Alcance recortado por decisión del usuario;
el estándar del motor, intacto.

### Fase A — P10, importación acotada

Escritura en lote en los cuatro módulos dueños (antes, 200 ítems eran 200 transacciones y la fila 150
mala dejaba escritas las 149 buenas). `combo_component` tiene por fin una ruta de escritura: llevaba
seis paquetes con lectura y sin escritura. **D4 cerrada** leyendo el Excel: `LNK` era el apaño con el
que la hoja armaba un combo (ADR-014). `npm run importar` con guarda de producción. Y el **MC de
referencia visible y reproducible** (ADR-015).

### Fase B — desplegar

**ADR-016 cierra D10**: un VPS en Hostinger con PostgreSQL propio, no gestionado. El hook `initdb`
que crea `costeo_migrator` y `costeo_app` solo existe si la base es nuestra. Lo que se pierde queda
escrito: sin failover, parches nuestros, respaldo nuestro. **Cadena de respaldo que restaura y
compara**, probada con 4.812.678 filas del libro. Cuatro runbooks completos.

### Fase C — cinco pantallas

`apps/web` con Next.js 16.3.4, React 19.2.8 y TypeScript. Sin librería de UI, sin gestor de estado,
sin cliente HTTP. Login y sucursal · costeo · ingeniería de menú con el MC de referencia · rejilla de
ventas navegable por teclado · inventario con la hoja **a ciegas** y la conciliación tras otro
permiso. CORS habilitado con lista blanca exacta.

### Fase D — la sesión

`docs/runbooks/sesion-con-el-cliente.md`: el guion en seis pasos, la comprobación previa, y **las
tres diferencias conocidas con las palabras exactas para explicarlas antes de que el cliente las
vea** — los céntimos frente a Excel, los ítems sin contar al teórico, y el MC ponderado.

### Lo que apareció al usar el sistema de verdad

Dos fallos serios que ninguna prueba vio: `SugerirPreciosEnLote` rechazaba todas las filas porque
`typeof x === 'string'` no discrimina cuando el éxito es un tipo marcado —que en ejecución es una
cadena—, y `combo_component` no tenía escritura. Y un tercero cazado por el linter del frontend: la
conversión a porcentaje truncaba, y `0.2799` salía «27,9 %» pintado de verde con el umbral en 28 %.

### Pendiente

Aprovisionar el VPS (necesita la cuenta de Hostinger), los datos del tenant real, y el destino de
`RESPALDO_COMANDO_SUBIDA`. Después, **P15**.

---

## P10b — El MC de referencia, visible y reproducible · 2026-09-07

**Objetivo:** cerrar la única contradicción encontrada entre el SPEC y el Excel del que sale, y que
el cliente pueda ver por qué su hoja da otro número.

### Decidido

**El MC promedio de menu engineering se queda PONDERADO** — `Σ(mc × unidades) / Σ(unidades)`—, como
dice SPEC §15 y como es el Kasavana-Smith canónico. El `AVERAGE` del Excel **es** la media simple, y
es el atajo que una hoja hace fácil: con cola larga desplaza el eje y convierte en «perros» a los
platos que sostienen el negocio. La implementación de P8 era correcta. **ADR-015**.

### Entregado

- `mcTotal` y `unidadesConMargen` en la respuesta, para que `mcTotal / unidadesConMargen = mcPromedio`
  se pueda rehacer a mano
- **`unidadesConMargen` no es `unidadesTotales`**, y hay una prueba que lo fija: un producto sin PVP
  no entra en ninguno de los dos lados de la división, así que dividir por el total daría otro número
  y el cliente tendría razón al decir que no cuadra
- `metodoMcPromedio: 'PONDERADO_POR_UNIDADES'` viajando pegado al número, no escrito en el frontend
- **La frase explicativa la escribe el frontend**, desde sus recursos (D11): la API da números
- Duda 7 de `ESTADO.md` cerrada

---

## P10 — Importación de catálogo, acotada a una migración operada · 2026-09-07

**Objetivo:** que el catálogo de un cliente entre sin digitarlo, y que entre entero o no entre.

**Alcance recortado por decisión del usuario, con fecha comercial encima.** No hay pantalla de
subida, ni previsualización en dos pasos, ni deduplicación asistida: es un comando que un operador
ejecuta con el archivo delante. Lo que sí se construyó entero es la pieza que no caduca.

### Entregado

- **Escritura EN LOTE en los cuatro módulos dueños**, una transacción por lote. Es lo que más vale
  del paquete: antes, cada método de repositorio abría su propia transacción, así que 200 ítems eran
  200 transacciones y **la fila 150 mala dejaba escritas las 149 buenas**. Y no se podía envolver
  desde fuera: `Prisma.TransactionClient` no expone `$transaction`
- **`combo_component` tiene por fin una ruta de escritura.** P4 creó la tabla, P5 la lee para
  costear, y **entre P4 y P10 nadie insertó una fila**: un combo se podía crear y jamás componer, y
  costaba cero. No lo destapó ninguna prueba — lo destapó preguntar qué representaba una columna de
  un Excel
- **D4 cerrada leyendo el archivo, no interpretándolo.** `LNK` no era un tipo de insumo: era el apaño
  con el que el Excel armaba un combo (`=INDEX(V_COSTEO!$H, MATCH(...))` sobre el costo por porción
  de un producto de venta). **ADR-014**
- Migración `p10_importaciones`: `import_job` + `import_job_status` con RLS deny-by-default y
  `FORCE`, ocho `CHECK` con sus guardas documentadas, y el permiso `import.write` **de nivel
  company** — `GERENTE_LOCAL` no lo recibe
- Descriptor `PRECIOS` nuevo, y `empaque` / `activo` en `PRODUCTOS`. Sin precio no hay costo, y sin
  costo la sesión con el cliente no demuestra nada
- **`npm run importar`**, ejecutando `dist/cli.js` (INC-017), con guarda de producción por bandera
  explícita y **sesión abierta por el mismo camino que el login** — no hay ninguna ruta nueva que
  fabrique una sesión sin credenciales
- **ADR-013**: el parser en `.mjs` fuera de `src/`, en proceso hijo sin variables de entorno, con
  plazo y techo de memoria. Y lo que **no** aporta: sin reintentos, sin DLQ, sin sandbox de sistema
- **835 pruebas**: 558 unitarias con la base apagada + 277 de integración

### Lo que la auditoría paró

Cuatro cosas reales, ninguna arreglada bajando un umbral. La que más vale: **knip destapó que los
topes de tamaño y de filas de `SEGURIDAD.md` §5.1 estaban escritos y no los aplicaba nadie.** Un
check de código muerto encontró un agujero de seguridad.

### Pendiente

- **`npm run bench` re-fechado a después del lanzamiento.** Se fijó para P9, no se pagó; se re-fechó
  a P10, tampoco. Dicho, no escondido
- Alias del dialecto real del cliente: cuando llegue su archivo. La pasada de análisis no escribe
- Prueba de similitud dominio ↔ `pg_trgm` (la diferencia de tildes)
- P11, P13, P14 y P15 **pospuestos**, con su motivo en `ESTADO.md`

---

## P9 — Consolidado de company y comparativa entre ubicaciones · 2026-09-06

**Objetivo:** ver la cadena completa y comparar locales.

### Entregado

- **Consolidado de company**: agrega ventas, márgenes, consumo, compras, inventario y costos fijos de todas las ubicaciones de un mes
- **Los porcentajes se recalculan sobre los totales, nunca se promedian.** Es la decisión que justifica el paquete: un local pequeño con food cost del 80 % y otro grande con el 30 % dan 30,1 % ponderado y 55 % en media simple, y **el segundo número es plausible en pantalla y falso**. Hay una prueba con los dos valores que cae si alguien sustituye la fórmula
- **Una ubicación sin datos del mes se aparta y se nombra**, no suma cero — la misma regla que ADR-010 §5 aplicó a un ítem sin contar
- **El consolidado dice el estado del período de cada ubicación**, porque el período es por ubicación (ADR-010 §1) y puede estar sumando meses cerrados con abiertos
- **Comparativa del mismo producto entre ubicaciones**: PVP, food cost, margen y unidades, con mínimo, máximo y brecha para ordenar por dispersión
- **Comparativa de precios de compra desde el LIBRO**, no desde `reference_price` —que es de company y daría el mismo número siempre—, agrupada también por artículo para poder responder «¿y es que compra otra marca?»
- **Permiso `analytics.consolidated.read`, de nivel company.** `GERENTE_LOCAL` **no** lo tiene: ver la cadena entera es la escalada horizontal que E18 prohíbe en la propagación de recetas. Tres pruebas de 403 y una cuarta que verifica que sigue viendo lo suyo
- **ADR-012** con las siete decisiones
- **727 pruebas**: 457 unitarias con la base apagada + 270 de integración

### Medido

| | mediana | p95 |
|---|---|---|
| Una ubicación | 69 ms | — |
| **Diez ubicaciones** | 616 ms | **734 ms** de 800 |

Cumple **al 92 %**, y escala lineal: **alrededor de doce ubicaciones se rompe**.

### Pendiente

- **Las vistas materializadas no se construyeron**, y no es un olvido: el criterio de aceptación se cumple sin ellas y una caché de números en este sistema es una fuente de números rancios. ADR-012 §7 deja el diseño y el umbral medido que las dispararía
- **`npm run bench` sigue sin existir.** Era la deuda que P8 dejó con fecha de pago en P9 y **no se pagó**: el presupuesto se midió a mano con la API en contenedor. La deuda sigue abierta

---

## P8 — Vistas analíticas · 2026-09-04

**Objetivo:** las seis vistas del Excel, por ubicación.

### Entregado

- **Food cost real y varianza** (SPEC §16) **con la conciliación R7**, que ahora corre sobre un **dataset completo** en cada build: catálogo, precios con vigencia, receta, motor de costeo, unidades vendidas y libro. Era el último criterio de aceptación pendiente desde P0
- **Menu engineering Kasavana-Smith** con los cuatro cuadrantes, más `SIN_DATOS` e `INACTIVO` que el SPEC también fija. **El índice se calcula con una sola división** para que el empate exacto en 1 sea determinista
- **Punto de equilibrio, prime cost y margen de seguridad** (SPEC §17) con **clasificación explícita** de T6 —`MANO_DE_OBRA` / `OTRO_FIJO` / `VARIABLE`—, que es lo que el propio SPEC pide en lugar del frágil prefijo «Sueldos*»
- **Inventario valorizado** con estados, días de cobertura y punto de reorden (SPEC §18)
- **Resumen gerencial** con semáforos por company (D3), y un cuarto estado —`SIN_DATO`— que existe para que ninguna interfaz pinte de verde la ausencia de medición
- **`product_sales`**: las unidades vendidas, que faltaban desde P6 y de las que dependen tres de las seis vistas. En lote y por reemplazo (D9), que es lo que la grilla de P12 necesita
- **`fixed_cost`** (T6) con su catálogo de clasificación
- **`BODEGA` no recibe ninguna vista**, solo el semáforo `REPONER`/`OK` **sin la cantidad**, servido desde su propio caso de uso y con su propio tipo
- **ADR-011** con las siete decisiones del paquete
- **702 pruebas**: 442 unitarias con la base apagada, 260 de integración

### Lo que se descubrió por el camino

**R7 destapó un fallo que llevaba dos paquetes en el código.** La receta es del **lote** y la venta es de **porciones**: vender 100 unidades de un producto que rinde 2 consume **50** lotes, no 100. P6 multiplicaba por las unidades sin dividir, así que con un rendimiento de 4 cada venta sacaba del inventario cuatro veces lo que sale de la bodega.

**Ninguna de las 596 pruebas de P0–P6 lo vio**, porque `rendimiento_porciones = 1` es el único valor con el que multiplicar y dividir dan lo mismo, y todos los productos de prueba lo tenían en 1. Lo encontró la conciliación de SPEC §16, que con rendimiento 2 daba **98,00** sobre un caso de 102 dólares.

Es la primera vez que R7 demuestra para qué existe, y la corrección vive en el punto único que P6 y P8 comparten: `totalConsumido`.

**El índice «exactamente 1» no salía exacto.** Escribiendo la fórmula del SPEC tal cual —tres operaciones, cada una redondeando a escala 12— el producto de la frontera daba `0.999999999999` y caía en `CABALLO` en vez de `ESTRELLA`. No es un error de presentación: es una recomendación de negocio invertida por un residuo en el decimal doce.

**El consumo se podía contar dos veces.** El Excel no tiene movimientos de consumo; este sistema sí puede tenerlos (P6). Sumarlos *y* restar el consumo teórico daba 40 kg de stock donde había 70 — un número perfectamente creíble que dice que falta mercancía que está en la estantería. El invariante que lo fija es una prueba: el stock teórico da lo mismo esté o no registrado el consumo por venta.

**`audit:arch` paró un ciclo real** entre `contexto.ts` y `vistas.ts`, y `audit:duplication` cazó la cuarta repetición del bloque de auditoría, que se extrajo a `shared/application`.

### Lo que el guardián 1 enseña

Volver al código de P6 deja **442 unitarias en verde, 246 de integración de P0–P7 en verde, y falla UNA sola** de las ~700 del proyecto. Esa prueba detecta que el consumo teórico es el doble de lo que debería.

La lección no es que faltara una prueba: es que **el caso de prueba tenía que tener rendimiento distinto de uno**. Con rendimiento 1 los dos caminos de R7 coinciden aunque uno esté mal, y el invariante verde tapa el desglose roto — la misma forma de fallo de P5, P6 y P7, por cuarta vez.

### Pendiente

- **El rendimiento del ÍTEM sigue sin confirmarse contra el Excel**, y ahora importa más: afecta al `consumo_teorico` que P8 ya publica
- **El coste de armar el contexto no tiene medición propia.** Es lo primero que P9 debería medir: el consolidado lo multiplica por el número de ubicaciones
- El **estado del período** en el consolidado de P9
- **Leer `audit_log`** — P11
- D4 (`LNK`) sigue en 🔴

---

## P7 — Períodos · conteo físico · 2026-09-04

**Objetivo:** poder cerrar un mes y compararlo con el siguiente.

### Entregado

- **El período es de una UBICACIÓN**, no de la company: el conteo se hace por ubicación (R2) y el cierre ocurre al cargarlo, así que un período de company obligaría a que las diez ubicaciones de una cadena contaran el mismo día
- **La frontera del mes se guarda como dos instantes**, resueltos una sola vez al abrirlo. `occurred_at` es absoluto y su mes depende de la zona horaria: las 02:00 UTC del 1 de abril son marzo en Guayaquil. Con la frontera escrita, cambiar la zona algún día **no mueve de mes movimientos ya cerrados**
- **La ausencia de fila es el estado abierto.** Exigir abrir el mes pararía el sistema solo el día 1 de cada mes
- **Un mes cerrado no admite movimientos, y la garantía está en la base**: trigger `BEFORE INSERT` sobre el libro, más la guarda `exigirLibroEscribible` que las cinco escrituras comparten. **Alcanza a la corrección**, que conserva la fecha del original (R3)
- **Reapertura solo del `OWNER`**, con motivo obligatorio y evento `period.reopened`
- **El conteo NO ajusta el libro.** Emitir un `AJUSTE` por la diferencia haría que `diferencia = conteo − teórico` (SPEC §18) diera cero siempre: el hallazgo desaparecería en el mismo acto de registrarlo
- **Conteo parcial (D7) con su cobertura**, medida sobre el **valor** y no sobre el número de ítems. **Un ítem sin contar vale su teórico, no cero** — valorarlo en cero equivaldría a declararlo consumido entero
- **Confirmar congela** el stock teórico y el costo de cada línea, y materializa una línea por cada ítem con saldo. La conciliación de un mes cerrado pasa a ser **una lectura**: 500 filas en 0,165 ms
- **`CONSUMO_REAL` de SPEC §16** —`inicial + compras − final físico`— encadenado mes a mes, con la cobertura pegada. Es la mitad física del food cost real; la otra necesita las unidades vendidas, que son de P8
- **`BODEGA` cuenta y no concilia**: `count.write` sí, `count.read` no. La hoja lista **todos** los ítems almacenables tengan saldo o no, para que el conteo sea ciego de verdad — que es lo que SPEC §4 pide y lo que mejora la calidad del dato
- **`shared/infrastructure/config/periods.ts`**: la zona horaria del calendario contable, como configuración versionada (D6, D11)
- **ADR-010** con las nueve decisiones que el SPEC no escribe
- **659 pruebas**: 413 unitarias con la base apagada, 246 de integración
- **El presupuesto medido**: `GET /conteos/:id` p95 **88,4 ms** contra 300, con 500 ítems; y `POST /inventario/movimientos` **52,3 ms** con 240 períodos cerrados en la tabla

### Lo que se descubrió por el camino

**INC-013, encontrada escribiendo una prueba del propio paquete.** Una compra fechada `2026-09-01T00:00:00Z` se rechazó por un período que nadie había cerrado: en Guayaquil eran las 19:00 del 31 de agosto. **Las cinco primeras horas UTC de cada día 1 pertenecen al mes anterior.** Es exactamente el fallo que P7 existe para prevenir, visto desde dentro. La prevención automatizada es una prueba de propiedad —doce meses en tres zonas horarias, una de ellas sin DST— y la del dato de prueba es una convención (`12:00Z`), porque una regla de `audit:forbidden` daría falsos positivos y se desactivaría en una semana.

**`migrate:verify` paró el `down.sql` el primer día.** No se puede soltar una función mientras un trigger vivo la use, y los triggers caen con sus tablas, que se borran **después** del bloque manual. No se registró como incidencia porque su prevención ya existía y funcionó.

**La siembra del test de rendimiento chocó contra su propia garantía**, ejecutando como dueño de la tabla: el trigger `physical_count_line_solo_en_borrador` no distingue roles. Hay que sembrar en `BORRADOR` y confirmar al final — el mismo orden que el repositorio se ve obligado a seguir.

**Nadie puede leer `audit_log`, ni siquiera el dueño de la tabla.** Se quiso comprobar que `period.reopened` guarda su motivo y no se pudo: `FORCE ROW LEVEL SECURITY` sin política de `SELECT` para ningún rol, que es lo que SEGURIDAD.md §10 pide. Los eventos de P0 a P7 se escriben y **su contenido no está verificado por ninguna prueba**. Queda con nombre para **P11**.

### Lo que el guardián 3 enseña

Valorar en **cero** lo que nadie contó rompe **3 pruebas de 659**. Sigue en verde la diferencia por línea, el cierre, los permisos, las cinco de confidencialidad — y, sobre todo, **la cobertura, que sigue diciendo 50 %**. El indicador que existe para avisar de que un conteo parcial no se lee como uno completo **no detecta esto**. Y el número que cambia es plausible: `consumo_real` pasa de −3,00 a +17,00.

Tercera vez que aparece la misma forma de fallo: P5 con R7, P6 con el saldo, P7 con la cobertura. **Un invariante agregado que se cumple tapando un desglose que no.**

### Pendiente

- **La tabla de unidades vendidas**, que P8 necesita para `venta_neta_mes` y con ella el food cost real completo
- El estado del período **en el consolidado de P9**: puede estar sumando meses cerrados con meses abiertos, y tiene que decirlo
- **Leer `audit_log`** — P11
- D4 (`LNK`) sigue en 🔴, y sigue sin bloquear nada

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
