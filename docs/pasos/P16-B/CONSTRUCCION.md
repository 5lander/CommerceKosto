# P16-B — Documento de construcción

**Paquete:** P16-B — API · pricing + recipes/products + costing + concurrencia optimista · **Inicio:** 2026-09-12 · **Estado:** ✅ auditado (`npm run audit` exit 0) · commit de cierre del paquete

> Tercer paquete de código de la pasada P16 → P20 (`docs/pasos/P16/PLAN.md`, sección P16-B). Las
> decisiones cerradas están en `ESTADO.md` → «Pasada P16 → P20»; las de este paquete son
> D-16.100…D-16.120, abajo y en la misma sección (las seis últimas salieron de la construcción). Se construye sin agentes: el usuario desactivó
> ultracode en esta sesión.

---

## Resumen

Lo que las pantallas 4 a 16 necesitan del backend y todavía no existe, más la regla que impide que
dos personas se pisen editando lo mismo:

1. **Concurrencia optimista** (D-16.11): `product.version` e `item.version`; toda escritura sobre
   el agregado exige la versión leída y responde con la nueva; si otro escribió antes, **409
   `CONFLICTO_DE_VERSION`**. ADR-023.
2. **Lecturas de precios**: la bandeja de pendientes, qué precio está vigente, y el costo de todos
   los ítems a una fecha.
3. **Lecturas de productos y recetas**: la ficha, sus ubicaciones, la carta de una ubicación, los
   componentes de un combo (lectura y escritura), las versiones de una receta y el historial de
   propagaciones.
4. **Costeo**: el semáforo lo decide la API, el desglose por línea sale en la respuesta y el PVP
   se puede simular sin guardarlo.
5. **Arreglos**: los importes cero que pasan el esquema y chocan con un `CHECK`, el error del
   empaque, las cinco consultas sin esquema que P16-A2 dejó anotadas, y la retirada de
   `company_settings.iva_compra` que D-16.43 prometió para este paquete.

## Objetivo del paquete

Criterio de aceptación: las rutas de la sección P16-B del plan construidas y documentadas; la 🔴
«dos escrituras con la misma versión → la segunda recibe 409 y el estado es el de la primera» en
verde para cada escritura protegida; una migración reversible con `migrate:verify` 4/4;
`npm run audit` en verde; `npm run bench` ejecutado sin empeorar ninguno de los cuatro números.

---

## Plan aprobado (Fase PLAN, modo autónomo)

### Lo que la lectura del código cambió respecto del plan

| Hallazgo | Consecuencia |
|---|---|
| `recipes` no puede escribir la tabla `item` (`catalog` es fuente única, CLAUDE.md §2, regla `tablas-de-catalogo-solo-en-catalog`), y la receta de una subpreparación es del ítem | La receta no se protege con `item.version` ni con `product.version`: se protege con la **última versión creada** de ese destino en esa ubicación — D-16.101 |
| Con `product.version`, editar la receta del local A haría fallar a quien edita la del local B (la deuda de D-16.20) | El mismo testigo por (destino, ubicación) quita esa deuda de las recetas; queda solo en `product_location` |
| `CUERPO_DE_SUGERENCIA.precio` admite `"0"` y `"-1"`; `CUERPO_DE_UBICACION` admite `pvp: "0"` y `rendimientoPorciones: "0"`; los tres `CHECK` son `> 0` y `guardas-de-dominio.md` los da por 🟡 «esquema» | Posible cuarta recurrencia de INC-012: se comprueba con una prueba que llegue por HTTP **antes** de arreglarlo — D-16.110 |
| `AsignarEmpaque` responde «producto no encontrado» cuando lo que no existe es el **ítem** de empaque | Error propio, 400 — D-16.112 |
| `ListarVersionesDeReceta` existe y no tiene ruta; `ubicacionesDe`, `productosEnUbicacion` y `componentesDeCombos` existen en el repositorio | Se cablean; no se reescriben |
| El dominio del costeo ya calcula `lineas` (costo y participación) alineadas con las líneas de la receta, y la presentación las descarta | El desglose sale uniéndolas por posición en la aplicación |
| El semáforo por bandas ya existe, privado, en `analytics/domain/resumen.ts` | Se muda a `shared/domain/indicadores/semaforo.ts` y lo usan los dos — D-16.105 |
| Todos los roles con `costing.read` tienen `recipe.read` | El desglose por línea no amplía lo que nadie ve; se ata igual a `recipe.read` — D-16.106 |
| Las cinco consultas con `@Query` crudo que P16-A2 dejó como deuda están en `catalog`, `pricing` y `recipes`, que este paquete toca | Se cierran aquí — D-16.111 |

### Decisiones de este paquete

| # | Decisión | Razón |
|---|---|---|
| **D-16.100** | `product.version` e `item.version`: `integer NOT NULL DEFAULT 1` con `CHECK (version >= 1)`. **Toda escritura del agregado** exige `version` en el cuerpo y la sube en la misma sentencia (`UPDATE … SET version = version + 1 WHERE id = … AND company_id = … AND version = …`); cero filas → se relee para distinguir 404 de 409. Agregado producto = maestro (empaque) + `product_location` + `combo_component`; agregado ítem = `PUT /catalogo/items/:id`. Las escrituras protegidas responden **200 `{ version }`** en vez de 204, para que el formulario siga sin releer | D-16.11, D-16.13. La versión es del agregado porque el formulario de la ficha los edita juntos |
| **D-16.101** | **La receta se protege con `basadaEn`**: el id de la **última versión creada** de ese destino en esa ubicación (cualquier estado, `VOID` incluida), o `null` si no hay ninguna. `PUT /recetas` lo exige; si al guardar la última ya no es esa, 409 `CONFLICTO_DE_VERSION`. La comprobación y la inserción van en una transacción bajo `pg_advisory_xact_lock(hashtext('receta'), hashtext(destino‖ubicación))`, el patrón de D-16.62. `GET /recetas` y `GET /recetas/versiones` publican `ultimaVersionId` | Una versión nueva es una fila nueva: el testigo natural es «sobre cuál edité», no un contador. Sirve igual para producto y para subpreparación sin que `recipes` escriba en `item`, y es por ubicación, así que no hereda la deuda de D-16.20 |
| **D-16.102** | Las cargas en lote **no exigen** versión pero **sí la suben** (los combos de `GuardarRecetasEnLote` suben la del combo; las recetas del lote cambian solas la última versión creada) | Un formulario abierto antes de una importación tiene que enterarse |
| **D-16.103** | Artículos y grupos (`PUT` de P16-A1) **no llevan versión** | D-16.13 la limitó a período, producto e ítem. Señal: el primer cambio perdido en uno de los dos |
| **D-16.104** | `CONFLICTO_DE_VERSION` es un código nuevo (409). El cuerpo no trae la versión actual: el mensaje pide recargar, porque lo que el cliente necesita es el estado entero, no el número | Con el número dentro, lo fácil es reenviar con él y pisar lo del otro |
| **D-16.105** | El semáforo por bandas (`VERDE` · `AMBAR` · `ROJO` · `SIN_DATO`) se muda a `shared/domain/indicadores/semaforo.ts`; `analytics` y `costing` lo usan. `GET /costeo` y `GET /costeo/:id` publican `semaforoFoodCost` por producto con los umbrales de la company; `SIN_DATO` cuando no hay venta. La pantalla de costeo deja de decidir el color | D-16.3; INC-020 fue un semáforo decidido en el cliente |
| **D-16.106** | `costos.lineas` (ítem, nombre, cantidad, base, estado, costo, participación) sale **solo si la sesión tiene `recipe.read`**; si no, `null` | Defensa en profundidad: hoy todo rol con `costing.read` tiene `recipe.read`, y un rol futuro que no la tuviera recibiría la receta con cantidades |
| **D-16.107** | `GET /costeo/:productId?pvp=` recalcula **solo el lado de venta** con la misma `ladoDeVenta` y el semáforo con el food cost resultante; no escribe nada; la respuesta lleva `pvpSimulado` | U6, simulador. Una sola fórmula de venta (decisión 16 de P5) |
| **D-16.108** | `GET /precios/pendientes` une nombres en aplicación (ítem y presentación, por los puertos de `catalog`, como D-16.83), trae el `precioVigente` del ítem para comparar, pagina por cursor (`id`, límite 1..200, 50 por defecto) | La bandeja decide «subió de X a Y»; sin el vigente al lado, cada fila es un número suelto |
| **D-16.109** | **Se retira `company_settings.iva_compra`** (D-16.43): la columna se suelta, el `CHECK` de fracciones y la función `sembrar_ajustes_de_company` se recrean sin ella, y `PUT /ajustes` deja de aceptarla (`.strict()` la rechaza). El `down` la devuelve con `0.15`, que era la semilla de D3, y lo dice | Una columna que nadie lee y un formulario que la pide son un sitio donde alguien volverá a leerla |
| **D-16.110** | Precio, PVP y rendimiento por lote **cero o negativos se rechazan con 400** en el esquema y en el dominio. Si la prueba confirma que hoy salen como 500, es la cuarta recurrencia de INC-012 y las tres filas de `guardas-de-dominio.md` pasan de 🟡 a 🔴 con su prueba citada (D-16.99) | La base rechaza y el dominio no explicaba |
| **D-16.111** | Las cinco consultas crudas (`GET /catalogo/articulos?itemId`, `GET /catalogo/items?incluirInactivos`, `GET /precios?itemId`, `GET /precios/costo/:itemId?fecha`, `GET /recetas/propagacion/previsualizacion`) pasan a `EsquemaPipe` con esquema `.strict()`. `fecha=basura` deja de ser un 404 mentiroso | Deuda anotada por P16-A2 |
| **D-16.112** | Un ítem de empaque inexistente es **400 `ENTRADA_INVALIDA`** «ese ítem de empaque no existe en tu company», no 404 de producto | La ruta existe; lo que falla es una referencia del cuerpo |
| **D-16.113** | `GET /productos/:id/ubicaciones` **filtra por alcance**: `GERENTE_LOCAL` ve solo las suyas. `GET /productos/ubicaciones?locationId` exige la ubicación en alcance | CLAUDE.md §4.4 |
| **D-16.114** | `PUT /productos/:id/componentes` **reemplaza** la lista entera (borra y escribe en una transacción, con la versión del combo): destino `COMBO`, componentes `SIMPLE` de la company, sin repetir, sin el propio combo, cantidad > 0, como mucho 50. `combo_component_no_se_contiene` pasa de ⚪ a 🔴 | La tabla de P4 tiene por fin ruta de escritura interactiva |
| **D-16.115** | *(construcción)* `reference_price(company_id, status)` → `(company_id, status, id)`, dentro de la migración del paquete | El `EXPLAIN` de la bandeja: con el índice de P3 recorría la clave primaria filtrando |
| **D-16.116** | *(construcción)* Las 🔴 de carrera bloquean la fila desde otra conexión y esperan en `pg_locks`; no usan `Promise.all` | Con `Promise.all` un leer-comparar-escribir pasaba igual (G10) |
| **D-16.117** | *(construcción)* `npm run bench` compila la API antes de medir | Medía el `dist` que hubiera en disco: INC-007, caso 12 |
| **D-16.118** | *(construcción)* `GET /recetas` pasa a `{ vigente, ultimaVersionId }` | El editor necesita el testigo; ningún cliente la consumía |
| **D-16.119** | *(construcción)* La presentación `"0"` no es recurrencia de INC-012; su fila pasa a 🔴 con las dos capas | G7 la dejó en verde: el dominio la paraba desde P2 |
| **D-16.120** | *(construcción)* `lineas: null` se prueba con una unitaria de la presentación | Ningún rol llega hoy a esa rama por HTTP |

### Lo que se construye, por capa

**Migración** `p16b_versiones_y_ajustes`: `product.version`, `item.version` (con `CHECK`); suelta
`company_settings.iva_compra` y recrea `company_settings_ratios_son_fracciones` y
`sembrar_ajustes_de_company()` sin ella. Sección en `guardas-de-dominio.md`.

**Dominio:** `shared/domain/indicadores/semaforo.ts` (+ spec) · `shared/domain/errors/conflicto-de-version.ts` ·
`recipes/domain/componentes-de-combo.ts` (validación pura + spec) · `pricing/domain` positivo del
precio · `analytics/domain/resumen.ts` usa el semáforo compartido.

**Aplicación:** `pricing`: `PreciosPendientes`, `CostosAUnaFecha`, `vigente` en el historial;
`SugerirPrecio` rechaza importe no positivo; ajustes sin `ivaCompra` · `recipes`:
`LeerProducto`, `UbicacionesDeProducto`, `CartaDeUbicacion` (productos en una ubicación con
nombre), `LeerComponentes`, `ReemplazarComponentes`, `ListarPropagaciones`; `ConfigurarProductoEnUbicacion`,
`AsignarEmpaque` y `GuardarReceta` con versión/testigo · `catalog`: `ActualizarItem` con versión ·
`costing`: semáforo, líneas y simulador.

**Infraestructura:** repositorios con la escritura condicionada y la relectura; controladores y
DTO; `error.filter.ts` con el código nuevo; `apps/web/src/app/costeo/page.tsx` usa
`semaforoFoodCost`.

**Pruebas 🔴:** por cada escritura protegida, dos escrituras con la misma versión → 200 y 409, y la
base con lo de la primera; receta: dos guardados sobre el mismo `basadaEn` → 201 y 409, y editar la
receta del local A no bloquea la del local B; un lote sube la versión; los cero → 400 (antes 500);
componentes de combo (feliz, combo dentro de combo, el propio combo, repetido, de otra company →
400/404); BODEGA sobre respuesta cruda en las rutas nuevas; `GERENTE_LOCAL` no ve ubicaciones
ajenas del producto; semáforo en los tres bordes; simulador sin escritura; `lineas` nulas sin
`recipe.read` (unitaria de la presentación); `PUT /ajustes` con `ivaCompra` → 400.

**Documentación:** ADR-023, `docs/apis/app-cliente.md`, `modelo-datos.md`, `guardas-de-dominio.md`,
`FUNCIONAMIENTO.md`, CHANGELOG, ESTADO, este archivo y `AUDITORIA-RESULTADO.md`.

---

## Qué se construyó

### Concurrencia optimista (D-16.100…D-16.104, ADR-023)

| Pieza | Dónde |
|---|---|
| `product.version`, `item.version` (`integer NOT NULL DEFAULT 1`, `CHECK >= 1`) | migración `20260912191330_p16b_versiones_y_ajustes` |
| `escribirConVersion`: `updateMany` con la versión en el `WHERE`, `version: { increment: 1 }` en `data`; cero filas → relectura en la misma transacción → `no_encontrado` o `conflicto_de_version` | `shared/infrastructure/persistence/escritura-versionada.ts` |
| `DesenlaceVersionado` (unión del puerto) · `ConflictoDeVersionError('producto' \| 'ítem' \| 'receta')` · código `CONFLICTO_DE_VERSION` → 409 en el `Record` exhaustivo del filtro | `shared/application/concurrencia.ts` · `shared/domain/errors/` · `error.filter.ts` |
| `subirVersionDeProducto` en las tres escrituras del agregado: configuración por ubicación (la versión **primero**, luego el `upsert`), empaque (la versión y el cambio en la misma sentencia) y componentes (versión, `deleteMany`, `createMany`) | `prisma-recetas.repositorio.ts` |
| `actualizarItem` con la versión | `prisma-catalogo.repositorio.ts` · `ActualizarItem` |
| **Receta:** `basadaEn` obligatorio; `bloquearDestino` con `pg_advisory_xact_lock(hashtext('receta'), hashtext(destino@ubicación))`; `ultimaVersion` = la última **creada** (`created_at DESC, id DESC`); testigo `comprobar` / `sobrescribir` | `prisma-recetas.repositorio.ts` · `GuardarReceta` · propagación y reversión con `sobrescribir` |
| El lote de recetas toma los candados **en orden de clave** y sube la versión de los combos que escribe (D-16.102) | `guardarRecetasEnLote` |
| Las cuatro escrituras con `version` responden **200 `{ version }`**; `PUT /recetas` sigue en 201 `{ id }` | controladores de ítems, productos, empaque y componentes |
| `GET /recetas` pasa a `{ vigente, ultimaVersionId }` | `LeerReceta` → `RecetaParaEditar` |

### Lecturas de precios

| Ruta | Caso de uso | Notas |
|---|---|---|
| `GET /precios?itemId=` | `HistorialDePrecios` | Cada fila gana `vigente`, decidido por `precioVigenteA` —la misma función del costeo— y no por la pantalla |
| `GET /precios/pendientes?limite&despuesDe` | `PreciosPendientes` (nuevo, `pendientes.ts`) | Cuatro lecturas en `Promise.all`: sugeridos por cursor, ítems y artículos por los puertos de `catalog` (D-16.83), confirmados hasta ahora; `precioVigente` al lado |
| `GET /precios/costos?fecha` | `CostosDeItems` (ya existía, sin ruta) | `comoCostosAUnaFecha` en `pricing/infrastructure/http/presentacion.ts`; `sinPrecio` aparte |
| `LecturasDePrecios` | — | Las tres lecturas en una dependencia: el controlador ya iba con tres (CLAUDE.md §3) |

### Productos, recetas y combos

| Ruta | Caso de uso | Notas |
|---|---|---|
| `GET /productos/:id` | `LeerProducto` | Con `version` |
| `GET /productos/:id/ubicaciones` | `UbicacionesDeProducto` | Filtrado por alcance (D-16.113) |
| `GET /productos/ubicaciones?locationId` | `ProductosDeUbicacion` | La carta con nombre; **registrada antes que `:id`** o Express leería «ubicaciones» como un id |
| `GET/PUT /productos/:id/componentes` | `LeerComponentes` · `ReemplazarComponentes` | `problemaDeComponentes` en `recipes/domain/componentes-de-combo.ts`, dominio puro: destino `COMBO`, componentes `SIMPLE` de la company, sin repetir, sin sí mismo, cantidad > 0, máximo 50 (D-16.114) |
| `GET /recetas/versiones` | `ListarVersionesDeReceta` (existía sin ruta) | Con `ultimaVersionId` |
| `GET /recetas/propagacion?productId` | `ListarPropagaciones` | `recipe.propagate`; 50 como mucho |
| `PUT /productos/:id/empaque` | `AsignarEmpaque` | Ítem de empaque inexistente → `EmpaqueNoEncontradoError`, 400 (D-16.112) |

Tres controladores nuevos (`fichas-de-producto`, `componentes`, `historial-de-recetas`) por el límite
de tres dependencias de constructor, el mismo motivo por el que P5 separó `EmpaqueController`.

### Costeo

| Pieza | Notas |
|---|---|
| `semaforoPorBandas` en `shared/domain/indicadores/semaforo.ts` (+ spec) | Se muda de `analytics/domain/resumen.ts`; los bordes, del lado bueno, como desde P8 (D-16.105) |
| `CosteoDelProducto.semaforoFoodCost` · `lineas: LineaDelDesglose[]` | Las líneas que el dominio ya calculaba se unen por posición con las de la receta |
| `comoProducto(producto, conLineas)` · `puedeVerLaReceta(sesion)` | `lineas: null` sin `recipe.read` (D-16.106) |
| `GET /costeo/:productId?pvp=` | `simular` con `ladoDeVenta`, la misma función del costeo real; nada se escribe (D-16.107) |
| `apps/web/src/app/costeo/page.tsx` | Pinta `semaforoFoodCost`; se borran los umbrales y la comparación del navegador, y `menorOIgual` de `lib/decimales.ts` con ellos |

### Arreglos

| Qué | Cómo |
|---|---|
| **Cuarta recurrencia de INC-012** (D-16.110): precio, PVP y rendimiento por lote `"0"`, e importe negativo de merma → 500 | `decimales-del-borde.ts` (vocabulario único) + guardas de dominio donde faltaban (`PrecioNoPositivoError`, `exigirPositivos`, la fila del lote de precios) + regla `regex-de-numero-solo-en-el-vocabulario` |
| Las cinco consultas con `@Query` crudo (D-16.111) | `CONSULTA_DE_ITEMS`, `CONSULTA_DE_ARTICULOS`, `CONSULTA_DE_HISTORIAL`, `CONSULTA_DE_FECHA`, `CONSULTA_DE_PREVISUALIZACION`, todas `.strict()` |
| `company_settings.iva_compra` (D-16.109) | Columna, `CHECK` y semilla fuera; `problemaDeAjustes` con siete fracciones; `PUT /ajustes` la rechaza |
| `eventos-de-usuario.ts` | El detalle admite `number` y `boolean`: el evento `product.updated` lleva la versión |

### Tooling

| Qué | Por qué |
|---|---|
| **`scripts/bench.mjs` compila la API antes de medir** | Medía el `dist` que hubiera en disco: INC-007, caso 12 |
| `test/soporte/bloqueos.ts` (`esperarBloqueadas`) | Las carreras de concurrencia se hacen deterministas bloqueando la fila desde otra conexión |
| Regla `regex-de-numero-solo-en-el-vocabulario` en `core.rules.mjs` | INC-012, cuarta recurrencia |

---

## Consultas del camino crítico

Medidas con `EXPLAIN (ANALYZE, BUFFERS)` sobre `costeo_bench` —el volumen del bench: 200 productos,
700 ítems, 14.000 líneas de receta, 219.000 movimientos—, **como `costeo_app` y con el tenant
fijado**, que es como corren (RLS incluida: el `One-Time Filter: current_company()` de cada plan). El
volumen no trae precios sugeridos ni propagaciones: se sembraron 3.000 y 400 con el migrador, y para
la bandeja se midió además un historial largo (120.500 confirmados junto a los 3.000 sugeridos).

| Consulta | Plan | Tiempo |
|---|---|---|
| **Bandeja de sugeridos por cursor** (`GET /precios/pendientes`) con el índice de P3 `(company_id, status)` | `Index Scan using reference_price_pkey`, `Filter: company_id AND status` | 0,112 ms |
| La misma, con el índice de P16-B **`(company_id, status, id)`** | `Index Scan using reference_price_company_id_status_id_idx`, **las tres condiciones en `Index Cond`** | 0,176 ms |
| Última versión creada de un destino (`PUT /recetas`, bajo el candado) | `Index Scan using recipe_company_id_product_id_location_id_valid_from_idx` → `top-N heapsort` sobre las 34 versiones del destino | 0,091 ms |
| Propagaciones de un producto, 50 | `Index Scan using recipe_propagation_company_id_product_id_propagated_at_idx`, sin `Sort` | 0,076 ms |
| `UPDATE product … WHERE id AND company_id AND version` | `Seq Scan on product` (200 filas: con esa tabla el planificador prefiere recorrerla a abrir la PK) | 0,424 ms |

**El índice cambió por el primer plan, y no por el tiempo.** Los dos tiempos de la bandeja son
submilisegundo, y el de P3 incluso más rápido en esta distribución: los sugeridos son de los primeros
`id` que recorre la PK. Pero lo que ese plan cuesta **depende de dónde caigan los sugeridos en el orden
de `id`**: con pendientes antiguos entre miles de precios más nuevos —de la misma company o de otras—,
recorre y descarta todo lo de en medio. Con `(company_id, status, id)` lee la página y nada más, sea cual
sea la distribución. **Sustituye** al índice de P3 en vez de sumarse: la lectura por estado de la carga
del costeo (la consulta 9 de `CONSULTAS-MAS-CARAS.md`, `company_id AND status AND valid_from <=`) usa el
mismo prefijo. Va dentro de la migración del paquete —una por paquete—, que se revirtió en la base de
desarrollo, se amplió y se volvió a aplicar antes del commit.

**El candado de la receta no aparece en el bench como coste:** «guardar una receta» mide **83,7 ms**
de p95 (límite 150) con el candado y la lectura de la última versión dentro.

---

## Pruebas

**Unitarias:** **889** en verde, 65 archivos, con la base apagada (eran 870 al cerrar P16-A2; +19).

| Archivo | Qué comprueba |
|---|---|
| `shared/domain/indicadores/semaforo.spec.ts` *(nuevo, 6)* | Los tres colores, `SIN_DATO` con `null`, y **los dos bordes**: exactamente en el umbral verde es verde y exactamente en el máximo es ámbar |
| `recipes/domain/componentes-de-combo.spec.ts` *(nuevo, 9)* | Cada motivo de `problemaDeComponentes`, y que una lista vacía es válida (un combo que se vacía) |
| `costing/infrastructure/http/presentacion.spec.ts` *(nuevo, 3)* | Con permiso de receta salen las líneas; **sin él, `null` y ni el nombre ni una `"cantidad"` en la serialización cruda**; la carta aplica la misma decisión a todos sus productos |
| `pricing/domain/lote.spec.ts` *(+1)* | Un precio `0.00` en un lote se rechaza con su fila, en vez del 500 que tumbaba la importación |

**Integración:** **520 casos, 515 en verde y 5 saltadas con motivo** (INC-016), 33 archivos (eran 460 + 5 en 32). Suites nuevas o ampliadas:

| Suite | Casos (antes → ahora) | 🔴 del paquete |
|---|---|---|
| `productos.spec.ts` *(nueva)* | 0 → 21 declaraciones `it` | Configuración por ubicación y empaque: dos escrituras con la misma versión → 200 y 409, la base con la primera · **cinco escrituras paradas sobre la fila bloqueada → una 200 y cuatro 409** · la versión es del agregado (el empaque deja obsoleto el formulario de ubicación) · inexistente → 404, no 409 · **el lote sube la versión del combo** · PVP y rendimiento `"0"` → 400 · componentes: versión vieja → 409 y la lista no cambia · BODEGA sin PVP en la respuesta cruda de la carta |
| `recetas.spec.ts` | 15 → 26 | Dos guardados sobre la misma versión → 201 y 409, una sola versión en la base · **cinco guardados esperando a la vez → uno crea y cuatro 409** · encadenar no da conflicto · el testigo es por ubicación · una propagación deja obsoleto el formulario del destino · `basadaEn` obligatorio |
| `catalogo.spec.ts` | 35 → 41 | Ítem: dos escrituras con la misma versión → 409 con `{code, message}` y nada más · versión obligatoria · inexistente → 404 · `incluirInactivos=si` → 400 · parámetro de más → 400 · presentación `"0"` → 400 |
| `precios.spec.ts` | 13 → 20 | Precio `"0"` y `"-1"` → 400 · `vigente` marca uno · la bandeja trae nombres y el vigente, no los confirmados · la bandeja pagina por cursor · costos a una fecha con `sinPrecio` aparte · `fecha=basura` → 400 · `PUT /ajustes` con `ivaCompra` → 400 y `GET` sin ella |
| `costeo.spec.ts` | 12 → 17 | Semáforo ROJO de CC-001 con los umbrales de la company · `lineas` alineadas con la receta · simulador VERDE / ÁMBAR / ROJO con PVP 3.00 / 2.10 / 1.00 **sin escribir nada** · `pvp=0` → 400 |
| `inventario.spec.ts` | 34 → 35 | Importe negativo en `COMPRA` y en `MERMA` → 400 |
| `inventario`, `analitica`, `consolidado` | sin casos nuevos | Actualizadas a 200 `{version}` y `basadaEn`; el consolidado **lee** la versión, porque activa el mismo producto en dos ubicaciones |

### Guardianes (INC-007): cada 🔴 se vio fallar rompiendo su mecanismo

Doce sabotajes, cada uno aplicado por un script que muta el código, corre solo la prueba afectada,
guarda la salida y **restaura** (el `git diff --stat` de `src/` idéntico antes y después). Las salidas
completas están resumidas en `AUDITORIA-RESULTADO.md`.

| # | Sabotaje | Prueba | Resultado |
|---|---|---|---|
| G1 | Quitar la versión del `WHERE` de `actualizarItem` | catálogo, dos escrituras | `expected 200 to be 409` |
| G2 | Quitar la versión del `WHERE` de `subirVersionDeProducto` | productos, 4 pruebas de versión | `expected 200 to be 409` ×4 |
| G3 | Desactivar la comprobación de `basadaEn` | recetas, dos guardados + propagación | `expected 201 to be 409` ×2 |
| G4 | PVP y rendimiento a `decimalNoNegativo` + quitar `exigirPositivos` | productos, ceros | `expected 500 to be 400` ×2 |
| G5 | Precio a `decimalConSigno` + desactivar `PrecioNoPositivoError` | precios, cero o negativo | `expected [500, 500] to deeply equal [400, 400]` |
| G6 | El lote no sube la versión del combo | productos, lote | `expected 1 to be 2` |
| G7 | Presentación a `decimalConSigno` **solo** | catálogo, presentación cero | **siguió en verde** → se buscó por qué: `problemaDeConversion` (P2) |
| G7′ | Presentación a `decimalConSigno` + desactivar `presentacion_no_positiva` | ídem | `expected 500 to be 400` |
| G8 | `costoTotal` a `decimalConSigno` | inventario, importe negativo | `expected [400, 500] to deeply equal [400, 400]` (la `COMPRA` la para `desglosarCompra`) |
| G9 | Quitar `bloquearDestino` de `guardarVersion` | recetas, cinco a la vez | `expected [201, 201, 201, 201, 201] to deeply equal [201, 409, 409, 409, 409]` |
| G10 | Leer-comparar-escribir en vez del `WHERE` (primera versión de la prueba, con `Promise.all`) | productos, diez a la vez | **siguió en verde** → la prueba no medía la carrera |
| G10′ | El mismo sabotaje, con la prueba rehecha sobre la fila bloqueada | productos, cinco paradas | `expected [200, 200, 200, 200, 200] to deeply equal [200, 409, 409, 409, 409]` |

Y el de la regla nueva de `audit:forbidden`, `regex-de-numero-solo-en-el-vocabulario`: con
`export const colada = z.string().regex(/^\d+$/u);` en `recetas.dto.ts` →
`FALLO — 1 infraccion(es)`; revertido → `OK`.

---

## Problemas encontrados y cómo se resolvieron

1. **La cuarta recurrencia de INC-012 se confirmó antes de arreglarla.** El plan la marcó como
   «posible». Se escribieron las peticiones por HTTP con los ceros y las cuatro devolvieron 500; solo
   entonces se tocó el esquema. La ficha de INC-012 cuenta por qué costó verlo: diez expresiones en seis DTO
   que no decían si admitían cero ni signo.

2. **Una quinta «recurrencia» no lo era.** La presentación `"0"` de un artículo tenía el mismo defecto
   de esquema, y la prueba se tituló «cuarta recurrencia». El guardián G7 la dejó en verde: el dominio
   la paraba desde P2. Se retituló antes del commit y la fila de `guardas-de-dominio.md` dice las dos
   capas.

3. **«Diez a la vez» no era una carrera.** La primera 🔴 de concurrencia del producto mandaba diez
   peticiones con `Promise.all`, y un leer-comparar-escribir la pasaba igual (G10). En local la
   transacción de tres sentencias no se solapa. Se rehízo con un bloqueo de fila desde otra conexión y
   una espera en `pg_locks` (`test/soporte/bloqueos.ts`); la de recetas se rehízo igual, bloqueando la
   fila de `product` con la que choca la clave foránea de `recipe`. Las dos fallan ahora siempre, no por
   azar. Queda en INC-007 (caso 12, sin subir el contador por esto: lo cazó el guardián).

4. **El bench medía un `dist` de dos días antes.** `npm run bench` reventó con `Cannot read properties
   of undefined (reading 'toFixed')`. La causa no estaba en el código medido: `bench.mjs` lanza
   `apps/api/dist/bench.js` y nadie lo compilaba; el archivo era del 2026-09-10 y no tenía ni una línea
   de P16-B. Se arregló en el script (compila siempre, antes de crear la base) y es **INC-007, caso 12**:
   los números de bench de P16-A1 y P16-A2 dependían de cuándo se hubiera compilado por última vez.

5. **`GET /recetas` cambió de forma.** Devolver `ultimaVersionId` exigía envolver la receta. Se
   comprobó que `apps/web` no la consume (ninguna pantalla la usa todavía) y el cambio va dicho en
   `app-cliente.md`.

6. **`app-cliente.md` documentaba mal la previsualización de la propagación**: decía `locationId` y el
   parámetro siempre fue `origen`. Se corrigió al pasarla a esquema.

7. **`migrate:new` generó un `down` que no se podía aplicar** (`ADD COLUMN iva_compra … NOT NULL` sin
   `DEFAULT` sobre una tabla con filas) y un `up` que habría soltado entero el `CHECK` de fracciones al
   soltar la columna, dejando seis ratios sin restricción. Los dos bloques se escribieron a mano; el
   `down` se probó sobre la base sembrada (INC-011).

8. **El índice de la bandeja salió del `EXPLAIN`, no del plan.** Ver «Consultas del camino crítico». Se
   generó como migración aparte, se vio que contradecía la cabecera de la del paquete («un paquete lleva
   una») y se plegó en ella: `migrate:down` en desarrollo, ampliación, `migrate:deploy`.

9. **`complexity` y `duplication` forzaron dos extracciones**: `presupuestoDeGuardarReceta` en el bench
   (la función de presupuestos pasaba de 40 líneas) y `registrarCambioDeProducto` (el evento
   `product.updated` quedaba repetido en tres casos de uso).

---

## Deuda y pendientes

| Qué | Por qué se deja | Señal / dónde |
|---|---|---|
| **El 409 espurio entre sucursales** en `PUT /productos/:id/ubicaciones` | Deuda aceptada por el usuario (D-16.20); la receta ya no la hereda | El primer 409 sin otra persona editando el mismo local → versión por `(product, location)`. ADR-023 |
| **Artículos y grupos sin versión** | D-16.13 la limitó a período, producto e ítem (D-16.103) | El primer cambio perdido en uno de los dos |
| **El consolidado sigue en 919,4 ms contra 800** | No lo toca este paquete y no empeora (944,0 en P16-A2) | Decisión abierta del usuario en `ESTADO.md` |
| **El bench no corre en `npm run audit` ni en CI** | Siembra 220.000 movimientos; decisión abierta del usuario | `ESTADO.md` |
| **`period.version`** | Es de P16-C (la rejilla de ventas) | P16-C |
| **Los `@Param` siguen sin `ParseUUIDPipe`**: 22 en `apps/api/src` (18 al cerrar P16-A2 por el mismo `grep`; +4 de las rutas nuevas de este paquete) | Dan 400 —el constructor del identificador lo rechaza—, pero **dentro del manejador**, con guards y pipes ya pasados. P16-A2 lo mandó «a P16-B/C, que ya los abre», y **P16-B no lo hizo**: se dice aquí en vez de dejarlo caer | P16-C, junto a los controladores de inventario y usuarios que abre |
| **Filas 🔴 de `guardas-de-dominio.md` anteriores a P16-A2 sin prueba citada** | Se completan a medida que se tocan; este paquete completó siete | D-16.99 |

---

## Cómo probar manualmente lo construido

Con la pila local levantada y una sesión de `ADMIN` (cookie + `X-CSRF-Token` de `GET /auth/sesion`):

```
# Concurrencia: dos pestañas con la misma ficha
GET  /productos/<id>                         -> { ..., "version": 4 }
PUT  /productos/<id>/ubicaciones  {..., "version": 4}   -> 200 { "version": 5 }
PUT  /productos/<id>/ubicaciones  {..., "version": 4}   -> 409 { "code": "CONFLICTO_DE_VERSION", "message": ... }

# Receta: editar sobre la última creada
GET  /recetas?productId=<id>&locationId=<loc>            -> { "vigente": {...}, "ultimaVersionId": "A" }
PUT  /recetas  { "basadaEn": "A", ... }                  -> 201 { "id": "B" }
PUT  /recetas  { "basadaEn": "A", ... }                  -> 409 CONFLICTO_DE_VERSION

# Los ceros
POST /precios  { ..., "precio": "0" }                    -> 400 ENTRADA_INVALIDA
PUT  /productos/<id>/ubicaciones { ..., "pvp": "0" }     -> 400 ENTRADA_INVALIDA

# Lecturas
GET  /precios/pendientes?limite=1                        -> { "pendientes": [...], "siguiente": "..." }
GET  /precios/costos?fecha=2026-03-01T12:00:00.000Z      -> { "costos": [...], "sinPrecio": [...] }
GET  /costeo/<id>?locationId=<loc>&pvp=3.00              -> semaforoFoodCost y pvpSimulado, nada escrito
```

En la pantalla de costeo (`/costeo`), el color de cada plato sale ahora de `semaforoFoodCost`: cambiar
los umbrales en `PUT /ajustes` lo cambia sin tocar el navegador.

---

## Incidencias registradas en este paquete

| Incidencia | Qué |
|---|---|
| **INC-012 → 4 recurrencias** | Cuatro `CHECK` marcados 🟡 «lo filtra el esquema» que el esquema no filtraba. Prevención automatizada: vocabulario único de decimales + regla `regex-de-numero-solo-en-el-vocabulario` con guardián |
| **INC-007 → 12 recurrencias** | Caso 12: `npm run bench` medía el `dist` que hubiera en disco. Prevención: el script compila antes de medir. En la misma ficha, sin sumar al contador, las dos 🔴 que el guardián cazó afirmando más de lo que medían |
