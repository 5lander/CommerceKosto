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

## Cómo se mantiene

Al añadir una migración con `CHECK` o `RAISE EXCEPTION`:

1. Añade su sección aquí, con una fila por restricción y su categoría.
2. Por cada 🔴, escribe la guarda de dominio **y** la prueba de que devuelve 4xx.
3. `npm run audit:migrations` (M11) falla mientras falte la sección.

**Si dudas entre 🔴 y ⚪, es 🔴.** El coste de una guarda de más son tres líneas; el de una de menos es un 500 en producción que nadie sabe explicar.
