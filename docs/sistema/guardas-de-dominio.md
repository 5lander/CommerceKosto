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
| `purchase_article_presentacion_positiva` | 🟡 | Esquema |
| `purchase_article_factor_positivo` | 🔴 | **`problemaDeConversion`** en `catalog/domain/conversion.ts`, que además distingue los tres casos: derivable, exigido y sobrante |

---

## `20260904171128_p3_precios`

| Restricción | | Guarda |
|---|---|---|
| `company_settings_ratios_son_fracciones` | 🔴 | **`problemaDeAjustes`**: «un IVA se escribe 0.15, no 15» |
| `company_settings_umbrales_ordenados` | 🔴 | **`problemaDeAjustes`**: objetivo ≤ verde ≤ máximo, o el semáforo no puede pintar los tres colores |
| `company_settings_dias_positivos` | 🔴 | **`problemaDeAjustes`** |
| `reference_price_positivo` | 🟡 | Esquema del cuerpo |
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
| `product_location_pvp_positivo` | 🟡 | Esquema |
| `product_location_rendimiento_positivo` | 🟡 | Esquema |
| `product_location_activo_tiene_pvp` | 🔴 | **`ConfigurarProductoEnUbicacion`** — **añadida en P5, tras INC-012**. Antes daba 500: «un producto activo necesita PVP; sin él se podría vender sin saber a cuánto» |
| `combo_component_cantidad_positiva` | 🟡 | Esquema |
| `combo_component_no_se_contiene` | ⚪ | No hay endpoint de componentes de combo todavía (deuda anotada en P4) |
| `recipe_un_solo_destino` | ⚪ | El destino es una **unión** en el tipo (`DestinoDeReceta`): «ninguno» y «los dos» no compilan |
| `recipe_line_cantidad_no_negativa` | 🟡 | Esquema |
| `recipe_line_orden_no_negativo` | ⚪ | El orden lo asigna el repositorio |
| **trigger** `recipe_no_se_edita` | ⚪ | El repositorio no emite `UPDATE` sobre `recipe`: guardar crea versión nueva |

---

## `20260904190131_p5_costeo`

**No añade ninguna restricción ni trigger**, y por eso M11 la exime. Añade una columna anulable con su clave foránea compuesta, un índice y una fila de permiso.

La columna `product.packaging_item_id` no necesita guarda: `AsignarEmpaque` ya comprueba que el ítem exista en la company —lo que da un 404 con mensaje en vez de un `23503` del driver— y la clave foránea compuesta contra `item(id, company_id)` es la garantía de que no cruza tenants.

---

## `20260904203551_p6_inventario`

Es la migración con más restricciones del proyecto hasta ahora, y no por gusto: el libro de inventario es **append-only**, así que una fila mal escrita no se puede arreglar después. Lo que la base no rechace en el momento se queda para siempre.

| Restricción | | Guarda |
|---|---|---|
| `inventory_movement_type_direccion_valida` | ⚪ | El catálogo lo siembra esta migración; la aplicación no tiene `INSERT` sobre él |
| `inventory_movement_cantidad_no_nula` | 🔴 | **`conSignoDelTipo`** → `CantidadNulaError`. «El libro registra hechos, y *no pasó nada* no es uno» |
| `inventory_movement_signo_segun_direccion` | 🔴 | **`conSignoDelTipo`** → `SignoIncoherenteError`. Es la que más se va a tocar: quien registra una merma escribe «2,5 kg», no «−2,5 kg» |
| `inventory_movement_importe_no_negativo` | 🟡 | Esquema: el importe entra como decimal no negativo |
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

## Cómo se mantiene

Al añadir una migración con `CHECK` o `RAISE EXCEPTION`:

1. Añade su sección aquí, con una fila por restricción y su categoría.
2. Por cada 🔴, escribe la guarda de dominio **y** la prueba de que devuelve 4xx.
3. `npm run audit:migrations` (M11) falla mientras falte la sección.

**Si dudas entre 🔴 y ⚪, es 🔴.** El coste de una guarda de más son tres líneas; el de una de menos es un 500 en producción que nadie sabe explicar.
