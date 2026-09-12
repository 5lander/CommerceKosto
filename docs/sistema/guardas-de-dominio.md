# Guardas de dominio — qué restricción de la base tiene su explicación, y dónde

> **Para qué existe este documento.** CLAUDE.md §5 quiere las reglas **en la base**: `NOT NULL`, `CHECK`, `UNIQUE`, triggers. Eso es lo que garantiza. Pero una restricción que solo vive en la base tiene un problema: cuando alguien la viola desde la API, el error del driver —`23514` o `P0001`— sube sin traducir, el filtro no lo reconoce como `ErrorDeDominio` y sale como **`INTERNAL_ERROR 500`**. Un 500 dispara alertas de operación, cuenta como caída en cualquier métrica de disponibilidad, y no le dice al usuario qué corregir.
>
> **La base garantiza; el dominio explica.** Este documento dice, por migración, cuál de sus restricciones es alcanzable desde una petición bien formada y dónde está su guarda.

**Nació de un fallo real, que apareció dos veces el mismo día:** `docs/incidencias/INC-012`.

**Lo verifica `audit:migrations` M11**, que falla si una migración añade un `CHECK` o un `RAISE EXCEPTION` y no tiene su sección aquí. M11 no comprueba que la guarda exista ni que sea correcta —eso no es automatizable—; comprueba que **alguien se hizo la pregunta**.

---

## Las tres categorías

Cada restricción cae en una de estas, y la etiqueta es lo que importa:

| Categoría | Qué significa | Qué exige |
|---|---|---|
| 🔴 **Alcanzable** | Una petición válida en forma, con datos que un usuario escribiría, la viola | Guarda de dominio con mensaje, y una prueba de que sale 4xx |
| 🟡 **Filtrada por esquema** | El esquema Zod del endpoint la hace imposible antes de llegar a la base | Nada más. El esquema **es** la guarda |
| ⚪ **Estructural** | Ninguna ruta de la API puede violarla: la escribe el propio repositorio | Nada. La base es defensa en profundidad contra un bug interno o un `psql` a mano |

---

## `20260827081537_p0_audit_log`

| Restricción | | Guarda |
|---|---|---|
| `audit_log_detail_es_objeto` | ⚪ | El detalle lo construye `PrismaAuditLogRepository`, nunca un cuerpo de petición |
| `audit_log_at_no_es_futuro` | ⚪ | La fecha la pone el repositorio con el reloj del sistema |
| `audit_log_user_agent_acotado` | ⚪ | El repositorio trunca antes de escribir |
| `audit_log_actor_coherente` | ⚪ | El tipo de actor lo fija cada caso de uso, no el cliente |

**Ninguna es alcanzable, y por una razón de diseño:** `audit_log` no tiene endpoint de escritura. Se escribe desde dentro. Sus `CHECK` protegen contra un bug del propio repositorio, que es exactamente para lo que sirve la defensa en profundidad.

El trigger `audit_log_no_se_edita` (`RAISE EXCEPTION`) es ⚪ por construcción: la app no tiene `GRANT UPDATE` sobre la tabla, así que el trigger es la segunda de tres capas y solo se alcanza con un rol que no es el de la aplicación.

---

## `20260904023411_p1_iam`

| Restricción | | Guarda |
|---|---|---|
| `company_name_no_vacio` | 🟡 | `z.string().min(1)` en el esquema de alta |
| `company_max_locations_positivo` | ⚪ | Es del plan (D5); no hay endpoint que lo escriba |
| `location_name_no_vacio` | 🟡 | Esquema de `POST /ubicaciones` |
| `app_user_email_en_minusculas` | ⚪ | El caso de uso normaliza a minúsculas antes de escribir |
| `app_user_email_con_forma` | 🟡 | `z.email()` en el esquema de invitación |
| `app_user_credencial_coherente` | ⚪ | Estados que el flujo de invitación/activación fija; el cliente no los toca |
| `app_user_invitacion_coherente` | ⚪ | Ídem |
| `user_role_has_location_coherente` | 🔴 | **`AsignarRol`**: un `GERENTE_LOCAL` o `BODEGA` sin ubicación se rechaza con error de dominio **antes** de tocar la base. Probado en `autenticacion-y-autorizacion.spec.ts` → «GERENTE_LOCAL sin ubicacion se rechaza antes de tocar la base» |
| `session_vigencia_coherente` | ⚪ | Las fechas las calcula `politica-de-sesion.ts` |
| `session_user_agent_acotado` | ⚪ | El registro de sesiones trunca |
| `login_attempt_email_en_minusculas` | ⚪ | Normalizado en el caso de uso |

---

## `20260904162756_p2_catalogo`

| Restricción | | Guarda |
|---|---|---|
| `unit_code_en_minusculas`, `unit_factor_positivo` | ⚪ | El catálogo de unidades es semilla de migración; no hay endpoint que lo escriba |
| `item_group_name_no_vacio`, `item_name_no_vacio`, `purchase_article_name_no_vacio` | 🟡 | `z.string().min(1)` en sus esquemas |
| `item_yield_es_fraccion` | 🔴 | **`problemaDeItem`** en `catalog/domain/item.ts`: el rendimiento va entre 0 y 1, con el mensaje que explica que dividir por él **encarece** |
| `item_keeps_stock_solo_en_producido` | 🔴 | **`problemaDeItem`**: `llevaStock` solo tiene sentido en un `PRODUCIDO` |
| `purchase_article_presentacion_positiva` | 🔴 | **Dos capas, y el guardián de P16-B lo enseñó:** `problemaDeConversion` → `presentacion_no_positiva` desde P2, y `decimalPositivo` en el esquema desde P16-B. Estaba marcada 🟡 «esquema» y el esquema aceptaba `"0"`; no llegó a dar 500 porque el dominio la paraba. Solo con las dos quitadas sale el `23514`. **Prueba:** `test/integracion/catalogo.spec.ts` («una presentación de cero») y `catalog/domain/conversion.spec.ts` («presentación cero») |
| `purchase_article_factor_positivo` | 🔴 | **`problemaDeConversion`** en `catalog/domain/conversion.ts`, que además distingue los tres casos: derivable, exigido y sobrante |
| **clave foránea** `item_unit_of_use_fkey` · `purchase_article_presentation_unit_fkey` | 🔴 | **`exigirUnidad`** en `catalog/domain/catalogo-de-unidades.ts`. No es un `CHECK`, pero falla igual de opaco: `"l"` está bien formado —la regex de `unidadDeUso` lo acepta— y no existe, así que llegaba al `INSERT` y salía como **500**. El mensaje enumera las diez válidas. El lote la tenía desde P14b; **el alta suelta de ítem, desde P16-A2**. `GET /catalogo/unidades` es la otra mitad: que el usuario no llegue a escribirla. **Prueba:** `test/integracion/catalogo.spec.ts` («la unidad tiene que EXISTIR») y `catalog/domain/catalogo-de-unidades.spec.ts` |
| **índices únicos** `item_company_id_name_key` · `purchase_article_company_id_name_key` | 🔴 | El repositorio traduce el `P2002` a la unión del puerto (`nombre_en_uso`, `articulos_en_uso`) y el caso de uso lo convierte en **409** con el nombre dentro. Tres escrituras lo hacían salir como 500 hasta P16-A2: `actualizarItem`, el lote de artículos al reimportarse, y la carrera de los dos lotes. **El lote compara los nombres sin distinguir mayúsculas ni espacios de sobra** (`clavePorNombre`), que es más estricto que el índice —byte a byte—, y el mensaje del 409 lo dice para no afirmar algo falso. **Prueba:** `test/integracion/catalogo.spec.ts` (renombrar a un nombre ocupado, y que el de otra company no choca), `test/integracion/importacion.spec.ts` («reimportar ARTÍCULOS es 409, no 500») y `shared/infrastructure/persistence/rescate-de-choque.spec.ts` (las tres ramas de la carrera, con la base apagada) |

---

## `20260904171128_p3_precios`

| Restricción | | Guarda |
|---|---|---|
| `company_settings_ratios_son_fracciones` | 🔴 | **`problemaDeAjustes`**: «un IVA se escribe 0.15, no 15» |
| `company_settings_umbrales_ordenados` | 🔴 | **`problemaDeAjustes`**: objetivo ≤ verde ≤ máximo, o el semáforo no puede pintar los tres colores |
| `company_settings_dias_positivos` | 🔴 | **`problemaDeAjustes`** |
| `reference_price_positivo` | 🔴 | **Cuarta recurrencia de INC-012 (P16-B).** Marcada 🟡 «esquema del cuerpo», y el esquema era un `decimal` con signo: `precio: "0"` y `"-1"` salían como **500**. Ahora `decimalPositivo` en el esquema y **`SugerirPrecio`** → `PrecioNoPositivoError` en la aplicación; el lote de precios lo explica por fila (`problemasDelLoteDePrecios`). **Prueba:** `test/integracion/precios.spec.ts` («un precio de cero o negativo es 400») y `pricing/domain/lote.spec.ts` («un precio de cero se rechaza con su fila») |
| `reference_price_iva_es_fraccion` | 🟡 | Esquema |
| `reference_price_confirmacion_coherente` | ⚪ | Autor y fecha los pone `resolver`, no el cliente |
| `reference_price_nota_acotada` | 🟡 | `z.string().max(...)` |
| **trigger** «un precio no se modifica» | ⚪ | La app no tiene forma de emitir ese `UPDATE`: el repositorio solo cambia el estado |
| **trigger** «de un sugerido solo cambia el estado» | ⚪ | Ídem |
| **trigger** «un precio de ítem comprado necesita artículo» | 🔴 | **`SugerirPrecio.exigirArticuloCoherente`** — **añadida en P5, tras INC-012**. Antes daba 500 |
| **trigger** «una preparación producida no lleva artículo» | 🔴 | **`SugerirPrecio.exigirArticuloCoherente`** — ídem |

---

## `20260904174016_p4_recetas`

| Restricción | | Guarda |
|---|---|---|
| `product_name_no_vacio`, `product_category_acotada`, `recipe_note_acotada` | 🟡 | Esquemas |
| `product_location_pvp_positivo` | 🔴 | **Cuarta recurrencia de INC-012 (P16-B).** `pvp: "0"` pasaba el esquema y salía como **500**. Ahora `decimalPositivo` y **`exigirPositivos`** en `ConfigurarProductoEnUbicacion`. **Prueba:** `test/integracion/productos.spec.ts` («PVP "0" es 400») |
| `product_location_rendimiento_positivo` | 🔴 | Ídem con `rendimientoPorciones: "0"`. **Prueba:** `test/integracion/productos.spec.ts` («rendimiento por lote "0" es 400») |
| `product_location_activo_tiene_pvp` | 🔴 | **`ConfigurarProductoEnUbicacion`** — **añadida en P5, tras INC-012**. Antes daba 500: «un producto activo necesita PVP; sin él se podría vender sin saber a cuánto» |
| `combo_component_cantidad_positiva` | 🔴 | Desde P16-B hay ruta interactiva (`PUT /productos/:id/componentes`): `decimalPositivo` en el esquema y **`problemaDeComponentes`** en `recipes/domain/componentes-de-combo.ts`. **Prueba:** `test/integracion/productos.spec.ts` («cantidad "0" es 400») y `componentes-de-combo.spec.ts` |
| `combo_component_no_se_contiene` | 🔴 | Era ⚪ porque no había endpoint (deuda de P4); P16-B lo abre. **`problemaDeComponentes`**: «un combo no puede ser componente de sí mismo». **Prueba:** `test/integracion/productos.spec.ts` («el propio combo es 400») |
| `recipe_un_solo_destino` | ⚪ | El destino es una **unión** en el tipo (`DestinoDeReceta`): «ninguno» y «los dos» no compilan |
| `recipe_line_cantidad_no_negativa` | 🟡 | Esquema |
| `recipe_line_orden_no_negativo` | ⚪ | El orden lo asigna el repositorio |
| **trigger** `recipe_no_se_edita` | ⚪ | El repositorio no emite `UPDATE` sobre `recipe`: guardar crea versión nueva |

---

## `20260904190131_p5_costeo`

**No añade ninguna restricción ni trigger**, y por eso M11 la exime. Añade una columna anulable con su clave foránea compuesta, un índice y una fila de permiso.

La columna `product.packaging_item_id` no necesita guarda: `AsignarEmpaque` ya comprueba que el ítem exista en la company y la clave foránea compuesta contra `item(id, company_id)` es la garantía de que no cruza tenants. **Desde P16-B (D-16.112) ese rechazo es 400 `ENTRADA_INVALIDA`** —`EmpaqueNoEncontradoError`, «ese ítem de empaque no existe en tu company»— y no el 404 de producto que daba: la ruta existía, lo que fallaba era una referencia del cuerpo. **Prueba:** `test/integracion/productos.spec.ts` («un ítem de empaque que no existe es 400»).

---

## `20260904203551_p6_inventario`

Es la migración con más restricciones del proyecto hasta ahora, y no por gusto: el libro de inventario es **append-only**, así que una fila mal escrita no se puede arreglar después. Lo que la base no rechace en el momento se queda para siempre.

| Restricción | | Guarda |
|---|---|---|
| `inventory_movement_type_direccion_valida` | ⚪ | El catálogo lo siembra esta migración; la aplicación no tiene `INSERT` sobre él |
| `inventory_movement_cantidad_no_nula` | 🔴 | **`conSignoDelTipo`** → `CantidadNulaError`. «El libro registra hechos, y *no pasó nada* no es uno» |
| `inventory_movement_signo_segun_direccion` | 🔴 | **`conSignoDelTipo`** → `SignoIncoherenteError`. Es la que más se va a tocar: quien registra una merma escribe «2,5 kg», no «−2,5 kg» |
| `inventory_movement_importe_no_negativo` | 🔴 | **Cuarta recurrencia de INC-012 (P16-B).** La fila decía «el importe entra como decimal no negativo» y el DTO lo declaraba **con signo**: una `MERMA` con `costoTotal: "-5"` salía como **500** (la `COMPRA` no: desde P16-A1 `desglosarCompra` lanza `CompraConImporteInvalidoError` ante un bruto negativo). Ahora `decimalNoNegativo`. **Prueba:** `test/integracion/inventario.spec.ts` («un importe negativo es 400») |
| `inventory_movement_importe_obligatorio` | 🟡 | Esquema en `COMPRA` (el DTO lo exige); calculado por el dominio en `PRODUCCION` |
| `inventory_movement_transferencia_agrupada` | ⚪ | Solo `RegistrarTransferencia` emite esos dos tipos, y siempre con su cabecera |
| `inventory_movement_produccion_agrupada` | ⚪ | Solo `RegistrarProduccion` emite `PRODUCCION`, y siempre con su lote |
| `inventory_movement_articulo_solo_en_compra` | ⚪ | Solo `RegistrarCompra` rellena el artículo |
| `inventory_movement_fecha_no_futura` | 🔴 | **`exigirFechaPasada`** → `FechaFuturaError`, con un minuto de holgura de reloj |
| `inventory_movement_no_se_corrige_a_si_mismo` | ⚪ | El `id` lo genera la base **después** de fijar la referencia: no hay forma de apuntarse a uno mismo |
| `inventory_movement_note_acotada` | 🟡 | Esquema |
| `inventory_transfer_origen_distinto_de_destino` | 🔴 | **`construirTransferencia`** → `TransferenciaSinDestinoError` |
| `inventory_transfer_fecha_no_futura` | 🔴 | **`exigirFechaPasada`** |
| `inventory_transfer_note_acotada` | 🟡 | Esquema |
| `inventory_production_cantidad_positiva` | 🔴 | **`exigirMagnitud`** → `CantidadNulaError` / `SignoIncoherenteError` |
| `inventory_production_costos_no_negativos` | 🟡 | Esquema en el costo estándar; derivados los otros dos |
| `inventory_production_fecha_no_futura` | 🔴 | **`exigirFechaPasada`** |
| `inventory_production_note_acotada` | 🟡 | Esquema |
| **triggers** `*_sin_mutacion` y `*_sin_truncado` | ⚪ | Ver abajo |

### Por qué los triggers de append-only son ⚪ y no 🔴

Es la clasificación que más costó, porque `ESTADO.md` dejó escrito que P6 era «el candidato claro» a repetir INC-012 precisamente por esto. La conclusión, tras mirarlo:

**Ninguna ruta de la API puede producir un `UPDATE` o un `DELETE` sobre el libro.** No hay endpoint que edite ni borre un movimiento — no por olvido, sino porque R3 dice que no debe haberlo. Un error se corrige con `POST /inventario/movimientos/:id/correccion`, que **inserta** una fila.

Y lo que sostiene que siga siendo así no es la disciplina de nadie: es `audit:forbidden`. Las reglas `append-only-cliente-inventory_movement` y `append-only-sql-inventory_movement` rompen el build si alguien escribe `inventoryMovement.update(...)` o un `UPDATE inventory_movement` en cualquier archivo del repositorio, migraciones incluidas. **Una guarda de runtime protegería contra un código que no compila.**

Lo que sí es 🔴 en ese camino es otra cosa, y tiene su guarda: **corregir dos veces el mismo movimiento**. Ahí no hay `CHECK` sino el índice único de `reverses_movement_id`, que habría subido como `23505` → 500. Lo detiene `CorregirMovimiento` con `MovimientoYaCorregidoError`, y encadenar correcciones lo detiene `corregir()` con `CorreccionDeCorreccionError`.

---

## `20260904223303_p7_periodos_y_conteo`

**Es la migración que el README de incidencias tenía anotada como reaparición probable de INC-012**, y con razón: por primera vez desde P5 hay `RAISE EXCEPTION` en triggers que una petición corriente **sí** alcanza. Tres de los cuatro 🔴 de aquí son triggers, no `CHECK`.

| Restricción | | Guarda |
|---|---|---|
| `period_status_codigo_conocido` | ⚪ | El catálogo lo siembra esta migración; la aplicación no tiene `INSERT` sobre él |
| `physical_count_status_codigo_conocido` | ⚪ | Ídem |
| `period_mes_valido` | 🟡 | Esquema: `z.number().int().min(1).max(12)`. El dominio lo repite en `exigirMesValido` para quien no entre por HTTP |
| `period_anio_valido` | 🟡 | Ídem, con el rango 2000–2100 |
| `period_rango_coherente` | ⚪ | Los dos instantes los calcula `CalendarioDePeriodos`; nadie los escribe |
| `period_cierre_coherente` | ⚪ | El repositorio escribe fecha y autor en la misma sentencia |
| `period_cerrado_tiene_autor` | ⚪ | Ídem |
| `period_reapertura_coherente` | ⚪ | Ídem |
| `period_reapertura_exige_cierre` | ⚪ | `exigirReabrible` ya rechaza reabrir lo que no está cerrado |
| `physical_count_confirmacion_coherente` | ⚪ | Los escribe `ConfirmarConteo` juntos |
| `physical_count_confirmado_tiene_fecha` | ⚪ | Ídem |
| `physical_count_confirmado_marca_periodo` | ⚪ | Ídem |
| `physical_count_periodo_confirmado_es_el_suyo` | ⚪ | La copia la pone el repositorio desde la propia fila |
| `physical_count_valores_congelados_juntos` | ⚪ | Los tres salen de una sola llamada a `conciliar()` |
| `physical_count_confirmado_tiene_valores` | ⚪ | Ídem |
| `physical_count_note_acotada` | 🟡 | Esquema |
| `physical_count_line_cantidad_no_negativa` | 🔴 | **`exigirLineasValidas`** → `CantidadDeConteoNegativaError`. El esquema acepta el signo **a propósito**, para que el mensaje sea «si no había nada, la cantidad es cero» y no «debe ser positivo» |
| `physical_count_line_congelados_juntos` | ⚪ | Los congela `ConfirmarConteo` a la vez |
| `physical_count_line_costo_no_negativo` | ⚪ | El costo lo trae `pricing`, no el cliente |
| **único** `physical_count_confirmed_period_id_key` | 🔴 | **`ConfirmarConteo`** → `ConteoDelPeriodoYaConfirmadoError`. Sin él sería un `23505` → 500, exactamente como el de corregir dos veces en P6 |
| **único** `physical_count_line_count_id_item_id_key` | 🔴 | **`exigirLineasValidas`** → `ItemRepetidoEnConteoError` |
| **trigger** `inventory_movement_respeta_periodo_cerrado` | 🔴 | **`ExigirPeriodoAbierto`** → `PeriodoCerradoError`. Ver abajo |
| **trigger** `physical_count_confirmado_no_se_edita` | 🔴 | **`exigirBorrador`** → `ConteoYaConfirmadoError` |
| **trigger** `physical_count_line_solo_en_borrador` | 🔴 | **`exigirBorrador`**, comprobado sobre la cabecera antes de tocar las líneas |

### El trigger del período cerrado es 🔴 justo por lo contrario que los de P6

En P6 los triggers de append-only quedaron ⚪ porque **ninguna ruta de la API podía alcanzarlos**: no existe endpoint que edite un movimiento, y lo sostiene `audit:forbidden` y no la disciplina de nadie.

Aquí pasa lo opuesto. El trigger se dispara ante un `INSERT` perfectamente normal —una compra con fecha del mes pasado— hecho por un usuario que hace su trabajo. Es la ruta **más** transitada del sistema, no una excepción.

Y hay una segunda razón para que exista además de la guarda: **la guarda vive en cinco sitios y el trigger en uno.** Las cinco escrituras del libro llaman a `ExigirPeriodoAbierto`; la sexta que alguien escriba mañana podría no hacerlo, y el fallo sería silencioso —un movimiento dentro de un mes ya informado— en vez de ruidoso. La aplicación explica; la base garantiza.

**Alcanza también a la corrección**, y conviene saberlo antes de encontrárselo: una corrección conserva la fecha del movimiento que anula (R3), así que corregir dentro de un mes sellado se detiene igual. Eso es lo que «cerrado es de solo lectura» significa, y la salida es reabrir el mes, que solo puede el `OWNER` y queda en `audit_log`.

---

## `20260904235107_p8_ventas_y_costos_fijos`

Dos tablas y un catálogo. **Ninguna restricción nueva es un trigger**, y los dos 🔴 son índices únicos: es la vía por la que INC-012 se cuela cuando ya no quedan `CHECK` alcanzables, porque un `23505` sube igual de sin traducir que un `23514`.

| Restricción | | Guarda |
|---|---|---|
| `product_sales_unidades_no_negativas` | 🟡 | Esquema: las unidades entran como magnitud sin signo |
| `product_sales_unidades_enteras` | 🟡 | Esquema: `/^\d+$/`. El dominio las modela como `Count`, que es entero por construcción |
| `fixed_cost_classification_codigo_conocido` | ⚪ | El catálogo lo siembra esta migración; la aplicación no tiene `INSERT` sobre él |
| `fixed_cost_concepto_no_vacio` · `_acotado` | 🟡 | `z.string().trim().min(1).max(200)` |
| `fixed_cost_importe_no_negativo` | 🟡 | Esquema |
| **único** `product_sales(period_id, product_id)` | 🔴 | **`exigirVentasValidas`** → `ProductoRepetidoEnVentasError` |
| **único** `fixed_cost(period_id, concept)` | 🔴 | **`exigirCostosValidos`** → `ConceptoRepetidoError`. Compara **normalizado** —sin espacios de sobra y sin distinguir mayúsculas—, que es más estricto que el índice: «Arriendo» y «arriendo » son el mismo gasto, y la base los dejaría pasar |

### Lo que la base **no** comprueba aquí

Escribir ventas o costos en un **período cerrado** se rechaza, y no hay `CHECK` que lo haga: la restricción cruzaría dos tablas. Lo detiene `exigirAbierto` en el caso de uso, con el mismo `PeriodoCerradoError` de P7.

**A diferencia del libro, aquí no hay trigger de respaldo.** El vínculo con el período es una clave foránea y un `CHECK` no puede seguirla. Si algún día hay una segunda ruta de escritura a estas dos tablas, la guarda es lo único que las protege — y conviene saberlo antes de escribirla.

---

## `20260907180439_p10_importaciones`

Una tabla de rastro y su catálogo. **Ninguna restricción es 🔴, y no es un descuido: hoy `import_job` tiene un único escritor y no es la API.** Lo escribe el CLI `npm run importar`, que valida el archivo entero —cabecera, tipo y las 149 filas— antes de abrir una transacción. Un `23514` desde esa ruta no le llega a nadie por HTTP: le llega al operador, en su terminal, con la fila y la columna delante.

| Restricción | | Guarda |
|---|---|---|
| `import_job_status_codigo_conocido` | ⚪ | El catálogo lo siembra esta migración; la aplicación no tiene `INSERT` sobre él (`REVOKE` en el bloque de privilegios) |
| `import_job_tipo_conocido` | 🟡 | El CLI resuelve `--tipo` contra `DESCRIPTORES` y falla antes de construir nada. La base repite la lista por defensa en profundidad |
| `import_job_nombre_no_vacio` · `_acotado` | 🟡 | El nombre lo pone el sistema de archivos al leerlo, y se trunca al construir el trabajo |
| `import_job_clave_no_vacia` | ⚪ | La clave es un UUID generado por el sistema (SEGURIDAD.md §5.3), nunca el nombre original |
| `import_job_tamano_positivo` | 🟡 | El lector rechaza el archivo vacío antes: `esTextoPlano` falla con una muestra de cero bytes, y el error es `TipoDeArchivoNoAdmitidoError` |
| `import_job_filas_no_negativas` | ⚪ | El recuento sale de `.length` de lo escrito |
| `import_job_confirmada_es_coherente` | ⚪ | Lo escribe `marcarConfirmada`, que pone los tres campos a la vez o ninguno |
| `import_job_analizada_tiene_analisis` | ⚪ | El repositorio guarda el análisis antes de poder confirmarlo; el estado no avanza sin él |

### El día que exista la pantalla de importación, tres de estas cambian de color

Es lo que hay que saber antes de escribir ese endpoint, no después. Con una subida por HTTP, `import_job_tipo_conocido` y las dos del nombre pasan a **🔴**: un tipo inventado y un nombre de archivo vacío son cosas que un cliente puede mandar, y sin guarda saldrían como `INTERNAL_ERROR 500`.

Y la forma de escribirla ya está decidida por **INC-008**: esas validaciones son control de entrada y van **en el campo del esquema Zod, nunca en el refinamiento del objeto**. Un refinamiento no corre si otro campo falló antes, así que un `company_id` mal formado desactivaría la comprobación del tipo sin que nada avise. Se prueban **acompañadas de otro error**, no en aislamiento.

### Lo que la base **no** comprueba aquí

El `analysis` es `jsonb` y la base no mira dentro. Es deliberado: es una **caché de un análisis**, no una fuente de verdad — si se pierde, se vuelve a subir el archivo. Validarlo con un esquema en la base sería fijar en SQL una estructura que vive en `domain/analisis.ts` y que cambia con los descriptores.

Tampoco comprueba que lo escrito coincida con lo analizado. **No puede**: las filas importadas van a `item`, `reference_price`, `product`, `recipe` e `inventory_movement`, y ninguna clave foránea las une a su importación. Lo que lo sostiene es el orden del CLI —validar todo, después escribir— y `written_rows`, que permite cuadrar el recuento a posteriori.

---

## `20260908171210_p11_backoffice`

| Restricción | | Guarda |
|---|---|---|
| `plan_codigo_conocido` | ⚪ | `plan` es catálogo sembrado en la migración. La app cliente tiene `SELECT` y nada más; el back office ni siquiera eso |
| `plan_limites_positivos` | ⚪ | Igual: no hay ruta que escriba un plan |
| `backoffice_user_estado_conocido` | ⚪ | Los operadores se crean con `npm run operador:backoffice`, que fija el estado. No hay endpoint de alta |
| `backoffice_user_email_con_forma` | ⚪ | Mismo script, mismo motivo. El correo se valida antes con Zod |
| `backoffice_session_caduca_despues_de_nacer` | ⚪ | Las dos fechas las pone el repositorio de sesiones |
| `backoffice_access_log_accion_conocida` | ⚪ | La acción la fija el caso de uso, jamás el cuerpo de la petición |
| `backoffice_access_log_at_no_es_futuro` | ⚪ | La fecha es `DEFAULT now()` de la base |
| **`backoffice_access_log_motivo_con_sustancia`** | 🔴 | **`exigirMotivoSuficiente`** en `backoffice/domain/motivo.ts`, con `MotivoInsuficienteError` → 400 |

**La única 🔴 es la que de verdad escribe una persona**, y es además la razón de ser de la tabla. El motivo llega en una cabecera de cada petición cross-tenant y lo teclea el operador: veinte caracteres es una regla que se incumple **escribiendo**, no programando.

Sale como 400 con el mensaje explicando cuántos caracteres faltan, no como 500. Y se comprueba **en el campo del esquema y también en el dominio**: el esquema rechaza la forma, el dominio rechaza el contenido, y ninguno de los dos es un refinamiento de objeto (INC-008).

**Nota sobre el `RAISE EXCEPTION` del `DO $$` de la migración:** no es una guarda de dominio, es una **guarda de despliegue**. Comprueba que el rol `costeo_backoffice` existe antes de conceder privilegios sobre él, y su destinatario es quien migra, no quien usa la API. Falla en alto a propósito: la alternativa —saltarse los `GRANT` en silencio— dejaría el back office sin acceso y se descubriría en producción.

---

## `20260910012847_p16a1_iva_de_compra`

El IVA de compra en dos niveles (D-16.9): la tarifa es del artículo o del grupo, la recuperabilidad de la company, y el libro persiste los cuatro importes de cada `COMPRA` (D-16.10). **Nunca se asume una tarifa**: sin ninguna, la compra sale como 400 `ENTRADA_INVALIDA` con `TarifaDeIvaDesconocidaError`, que dice dónde ponerla.

| Restricción | | Guarda |
|---|---|---|
| `purchase_article_iva_tarifa_es_fraccion` | 🔴 | Esquema **en el campo** (`fraccion`: `0`, `0.xx` o `1`, nunca `15`) **y** `exigirTarifaValida` en `shared/domain/iva/tarifa.ts` → `TarifaDeIvaInvalidaError` con «un IVA se escribe 0.15, no 15». Alcanzable por `POST /catalogo/articulos`, `PUT /catalogo/articulos/:id` y el CSV `ARTICULOS` |
| `item_group_iva_tarifa_es_fraccion` | 🔴 | Las mismas dos guardas, por `POST /catalogo/grupos` y `PUT /catalogo/grupos/:id` |
| `inventory_movement_desglose_coherente` | ⚪ | Los cuatro campos los escribe **solo** el repositorio a partir de `DesgloseDeCompra`, que construye `desglosarCompra` (`inventory/domain/compra.ts`) únicamente para una `COMPRA`; la corrección copia el desglose del original entero. Ninguna ruta acepta los campos sueltos. **Lo que este CHECK no cubre:** una `COMPRA` nueva sin desglose, porque «sin desglose» es también el estado legítimo de las anteriores a P16-A1 y la base no distingue vieja de nueva. Esa garantía (D-16.25) es de aplicación: `exigirDesgloseEnCompra` → `CompraSinDesgloseError` (400), en `comoFila`, la única función del repositorio por la que entra toda fila del libro; solo exime la corrección de una compra vieja. El SQL a mano (siembras, scripts) queda fuera — ADR-024, decisión 4 |
| `inventory_movement_desglose_en_rango` | 🔴 | `desglosarCompra` → `Money.fromDecimalString` rechaza un bruto negativo con `CompraConImporteInvalidoError`; la tarifa ya pasó por `fraccion` en el cuerpo o por el CHECK del artículo/grupo |

**Las guardas de dominio que no tienen CHECK detrás**, y por qué: `motivoDeTarifaInvalida` (`shared/domain/iva/tarifa.ts`) es la misma regla de fracción como **motivo con fila** para los tres lotes (`catalog`, `inventory`, `pricing`; D-16.44), y `exigirTarifaValida` la lanza como última línea en los casos de uso; `tarifaDePreparacion` / `motivoDeIvaEnPreparacion` (`pricing/domain/preparacion.ts`) rechazan un IVA de compra distinto de cero en una preparación (D-16.51, `PreparacionConIvaError`, 400): no hay CHECK porque `reference_price` no sabe el tipo del ítem, y ponerlo exigiría un trigger que lea `item` para una regla que el dominio ya explica.

**Lo que cambia de color en la migración de P6.** `inventory_movement_importe_no_negativo` sigue 🟡 para `MERMA`/`AJUSTE`, y en `COMPRA` el neto lo calcula el dominio a partir de un bruto que la guarda de arriba ya comprobó.

---

## `20260910042649_p16a1_correo_y_limite_de_tasa`

La cola de correo, el token de restablecimiento y los golpes del límite de tasa (ADR-025, ADR-026). **Ninguna restricción es alcanzable con datos que teclee un cliente**: las tres tablas las escribe el sistema —el repositorio dentro de su transacción, las dos funciones `SECURITY DEFINER` o, más adelante, el despachador—, y lo único que llega de fuera es un correo que ya pasó por `z.email()` en el campo.

| Restricción | | Guarda |
|---|---|---|
| `email_outbox_destinatario_con_forma` | 🟡 | El destinatario es el correo de la invitación (`CUERPO_DE_INVITACION.email`, `z.email().max(254)` **en el campo**) o el de un usuario que ya existe. La base repite la forma por defensa en profundidad |
| `email_outbox_plantilla_conocida` | ⚪ | La plantilla es el discriminante del tipo cerrado `ContenidoDeCorreo` (`shared/application/correo/correo-a-encolar.ts`): `INVITACION` y `RESTABLECIMIENTO` con enlace, `BLOQUEO` (el aviso del login) sin datos; ninguna ruta la recibe como texto |
| `email_outbox_estado_conocido` | ⚪ | `escribirEnOutbox` escribe `PENDIENTE` siempre; los otros dos estados los escribe el despachador (etapa siguiente) desde una constante |
| `email_outbox_intentos_no_negativos` | ⚪ | Nace en `0` por `DEFAULT`; solo el despachador lo incrementa |
| `email_outbox_enviado_con_fecha` | ⚪ | La API nunca escribe `ENVIADO` ni `sent_at`. El despachador pone los dos en la misma sentencia |
| `password_reset_token_caduca_despues_de_nacer` | ⚪ | `expires_at` lo calcula `SolicitarRestablecimiento` como `ahora + HORAS_DE_RESTABLECIMIENTO` (entero ≥ 1 en el esquema de entorno); `created_at` es `DEFAULT now()`. La aplicación no tiene privilegios sobre la tabla |
| `rate_limit_hit_kind_conocido` | ⚪ | El `kind` lo fija el código del limitador (etapa posterior) desde la lista cerrada de D-16.50; jamás una petición |

**El `RAISE EXCEPTION` del `DO $$` es una guarda de despliegue, no de dominio**, igual que la de P11: comprueba que `costeo_despachador` existe antes de concederle privilegios. Su destinatario es quien migra. Sin ella, los `GRANT` fallarían… o peor, se saltarían, y los correos se quedarían `PENDIENTE` sin un solo error en ningún log.

**Las guardas de dominio de este bloque que no tienen `CHECK` detrás**, y por qué: `TokenDeRestablecimientoInvalidoError` (`iam/domain/errores.ts`, 400) cubre token vacío, inexistente, usado y caducado con **un solo mensaje** — es la asimetría deliberada de `AceptarInvitacion` aplicada al restablecimiento: quien prueba tokens no distingue «no existe» de «ya se usó». No hay `CHECK` porque «usado» y «caducado» son estados legítimos de la fila; los decide `password_reset_consume` con `used_at IS NULL AND expires_at > p_ahora`. Y `ContrasenaDebilError` protege la contraseña nueva como en la activación.

---

## `20260910202336_p16a2_csrf`

El token anti-CSRF de la sesión (U4, ADR-021). La columna `csrf_token` la escribe **solo** el servidor, con `GeneradorDeTokens.generar()`, en el momento de abrir la sesión; **ninguna ruta acepta un `csrf_token` de entrada** —lo que llega de fuera es la cabecera `X-CSRF-Token`, que se compara y se descarta, nunca se guarda—. Las dos restricciones son por tanto ⚪ y están para que un `UPDATE` a mano o una migración futura no dejen una cadena vacía, que el comparador leería como «sin token» en un sitio y como «token» en otro.

| Restricción | | Guarda |
|---|---|---|
| `session_csrf_acotado` | ⚪ | El único escritor es `abrirSesion` en `iam/infrastructure/prisma-autenticacion.repositorio.ts`, con el token que produce `GeneradorDeTokensCriptografico` (32 bytes en `base64url` = 43 caracteres). No hay endpoint que reciba el valor |
| `backoffice_session_csrf_acotado` | ⚪ | Lo mismo en el otro proceso: `IniciarSesionDeOperador` genera el token y `abrirSesion` (`backoffice/infrastructure/prisma-backoffice.repositorio.ts`) lo escribe |

**Lo que la base NO comprueba aquí, y quién sí.** Que la sesión *tenga* token no es un `CHECK` —`NULL` es legítimo para las sesiones abiertas antes de esta migración—, y por eso la regla vive en el dominio: `ValidarSesion` trata una sesión sin `csrf_token` como inválida y lanza `SesionInvalidaError('sin_csrf')` → **401**, que manda al usuario a entrar de nuevo. Y que la cabecera coincida lo comprueba `CsrfGuard` → `CsrfInvalidoError` → **403 `CSRF_INVALIDO`**, nunca un 500: las dos son guardas de aplicación con prueba de integración, en `autenticacion-y-autorizacion.spec.ts`.

---

## `20260912191330_p16b_versiones_y_ajustes`

La concurrencia optimista del producto y del ítem (D-16.100, ADR-023), y la retirada de
`company_settings.iva_compra` (D-16.109).

| Restricción | | Guarda |
|---|---|---|
| `product_version_positiva` | ⚪ | La columna solo la escribe el repositorio de `recipes`, y siempre como `version + 1` en la misma sentencia que comprueba la esperada. Ninguna ruta recibe un valor para guardarlo: la `version` del cuerpo se **compara**, no se escribe. Un cero solo lo pondría SQL a mano |
| `item_version_positiva` | ⚪ | Igual, en el repositorio de `catalog` (`actualizarItem`) |
| `company_settings_ratios_son_fracciones` (recreada sin `iva_compra`) | 🔴 | **`problemaDeAjustes`**, igual que antes: «un IVA se escribe 0.15, no 15». La recreación no cambia la guarda; cambia que ya no nombra la columna retirada. Prueba: `precios.spec.ts` |

**Lo que la version NO es: una restricción.** Que la versión del cuerpo coincida con la de la fila
no lo comprueba ningún `CHECK` —no puede: son dos momentos distintos—, sino el `WHERE version = …`
de la escritura. Cero filas es la respuesta de la base, y la traduce el repositorio releyendo:
si la fila no existe, **404**; si existe con otra versión, `ConflictoDeVersionError` → **409
`CONFLICTO_DE_VERSION`**. Nunca sube un error de base sin traducir.

---

## Los tipos del borde — tres guardas sin `CHECK` detrás *(P16-A2)*

**Esta sección rompe el molde del documento a propósito.** Todas las de arriba parten de una restricción de la base; estas tres no tienen ninguna. Y aun así son exactamente el mismo fallo, que es lo que las trae aquí: **una regla que se hace cumplir y no se explica sale como `INTERNAL_ERROR 500`**. Lo único que cambia es quién la hace cumplir — allí un `CHECK`, aquí el constructor de un tipo de dominio.

Las tres clases extendían `Error` a secas, así que `errorResponseFor` no las reconocía como `ErrorDeDominio` y las trataba como fallo inesperado: 500, mensaje genérico, alerta de operación y cero información para quien había escrito mal un dato suyo. Ahora extienden `ErrorDeDominio` con `codigo = 'ENTRADA_INVALIDA'` → **400**.

| Guarda | | Qué la dispara y qué dice ahora |
|---|---|---|
| `IdentificadorInvalidoError` (`shared/domain/identity/identificadores.ts`) | 🔴 | Un `:id` de ruta o un `?itemId=` que no es un UUID. Alcanzable desde 16 `@Param` y 5 `@Query` que no pasan por `ParseUUIDPipe` ni por esquema: `GET /costeo/:productId`, `GET /precios?itemId=`, `PUT /catalogo/items/:id`… El mensaje nombra el tipo esperado y da un UUID de ejemplo |
| `UnidadDeUsoInvalidaError` (`shared/domain/unidad/unidad-de-uso.ts`) | 🔴 | `POST /catalogo/items` con `unidadDeUso: "KG"`, `"Litro"` o `"unid de medida"` — las tres cosas que un humano escribe la primera vez. El mensaje dice la forma (minúsculas, sin espacios ni acentos) y tres ejemplos. **No enumera el catálogo**: este error es de FORMA y se lanza sin leer nada; de la existencia se encarga `exigirUnidad`, que sí lo ha leído |
| `ValorDecimalInvalidoError` (`shared/domain/decimal/nucleo.ts`) | 🔴 | Un decimal con coma, con exponente, con separador de miles… **o con más de 30 decimales**. Este último caso es nuevo: antes llegaba hasta el constructor de `Money` y saltaba con `EscalaExcedidaError`. El mensaje dice el límite y que hay que redondear antes de enviar |

**`EscalaExcedidaError` NO se convirtió, y esa es la decisión que sostiene el resto.** Se planteó pasarlo también a 400 y se descartó: ese error no es del borde, es el techo de escala saltando **a mitad de un cálculo**, o sea un bug del motor. Un 400 le diría al usuario que arregle algo que no es suyo y —peor— el filtro dejaría de escribir la traza en el log, que es lo único con lo que se diagnostica. Lo que se hizo es **cerrarle la puerta de entrada**: `desdeCadena` cuenta los decimales de la cadena y rechaza antes, con el error de entrada. Después de eso, si `EscalaExcedidaError` salta, es de casa y el 500 es la respuesta honesta.

**Lo que estos mensajes obligaron a añadir:** `valorParaMensaje` (`shared/domain/errors/valor-en-mensaje.ts`). Los tres citan el valor que el usuario escribió, y desde que salen como 400 ese valor **vuelve al cliente**: se recorta a 60 caracteres —para que el cuerpo del error no sea el eco de la petición— y se le quitan los caracteres de control, porque los parámetros de ruta no pasan por `EsquemaPipe` y un salto de línea dentro de un mensaje parte en dos la línea del log.

**Probadas por HTTP** en `apps/api/test/integracion/frontera-http.spec.ts`, que es donde se ve lo único que importa: `{ status: 400, code: 'ENTRADA_INVALIDA' }` sobre la respuesta cruda.

---

## Cómo se mantiene

Al añadir una migración con `CHECK` o `RAISE EXCEPTION`:

1. Añade su sección aquí, con una fila por restricción y su categoría.
2. Por cada 🔴, escribe la guarda de dominio **y** la prueba de que devuelve 4xx.
3. **Y nombra esa prueba en la fila** —el archivo, y entre paréntesis el caso—, no solo la guarda. Una guarda sin prueba funciona hoy y vuelve al 500 en el próximo refactor sin que ningún check se entere: es la tercera recurrencia de **INC-012**, y se detectó leyendo, no fallando. Las filas anteriores a P16-A2 todavía no la citan; se completan a medida que se tocan.
4. `npm run audit:migrations` (M11) falla mientras falte la sección.

**Una clave foránea o un índice único también son 🔴**, aunque M11 no pueda vigilarlos: no hay dónde poner el `-- GUARDA:` de un `CHECK` y su error —`P2002`, violación de clave foránea— sube igual de opaco. Por esa grieta entró la tercera recurrencia de INC-012.

Y si la regla **no** vive en la base sino en el constructor de un tipo de dominio, va a «Los tipos del borde»: M11 no la vigila —no hay migración que mirar— pero el fallo que produce es el mismo 500 sin explicación.

**Si dudas entre 🔴 y ⚪, es 🔴.** El coste de una guarda de más son tres líneas; el de una de menos es un 500 en producción que nadie sabe explicar.
