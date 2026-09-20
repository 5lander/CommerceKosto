# P16-G2 — El simulacro con libro y mes cerrado, y las cuatro cosas que encontró

> **Decisión del usuario D-16.198**: «Repite el simulacro de restauración por tenant sobre un tenant
> **con libro y con al menos un período CERRADO**. Si `inventory_movement_respeta_periodo_cerrado`
> rechaza la reinserción, el script resuelve el orden **sin puentear RLS ni el trigger**. El runbook
> no dice "probado" hasta que este simulacro pase. Evidencia en `CONSTRUCCION.md`.»

## 1 · Por qué este simulacro y no el de P16-G

El de P16-G restauró `ensayo-b` **sin libro**: catálogo, productos, recetas. Cuadró a la primera y
dejó la impresión de que el procedimiento estaba probado. No lo estaba para el caso que importa:
**un cliente real tiene meses cerrados**, y un mes cerrado arrastra un conteo confirmado, un libro
con fechas viejas y dos guardianes que existen justamente para impedir que eso se toque.

La diferencia entre los dos simulacros es la diferencia entre «probado» y «probado con lo que el
cliente tiene».

## 2 · Cómo se sembró

Por el flujo real, no con `INSERT` a mano (`scratchpad/sembrar-libro.mjs`):

1. tres `COMPRA` por `POST /inventario/movimientos` — dos en agosto en Local Centro, una en
   septiembre en Bodega Norte;
2. `POST /conteos` de agosto → `PUT /conteos/:id/lineas` → `POST /conteos/:id/confirmacion` →
   `POST /conteos/:id/cierre-de-periodo`.

Resultado: agosto **CERRADO**, saldo de 15 kg en Local Centro, un conteo confirmado con su línea.
Después, `npm run respaldo` y `npm run restaurar` a la auxiliar.

## 3 · El simulacro

```
1. retrato de ensayo-b EN LA COPIA        (lo que tiene que volver)
2. catástrofe: se borra el tenant entero de la base de trabajo
   — como superusuario, con SET LOCAL session_replication_role = replica —
3. npm run restaurar:tenant -- --company=<ensayo-b>
4. retrato de ensayo-b y de ensayo, y diff contra el paso 1
```

**El apagado de triggers del paso 2 es el desastre, no el procedimiento.** En un incidente real las
filas ya no están; aquí hay que quitarlas de alguna forma, y se hace con el interruptor de sesión
—local a su transacción, sin `ALTER TABLE` que pueda quedarse a medias— precisamente para no tocar
ningún guardián. **La restauración del paso 3 corre con todo puesto**: RLS, los append-only y el
trigger del mes cerrado.

### Resultado (2026-09-20)

```
[restaurar-tenant] en costeo_restaurado: 24 filas suyas en 22 tablas
[restaurar-tenant]   app_user: 3 · location: 2 · user_role: 3 · item_group: 1 · item: 2
[restaurar-tenant]   purchase_article: 1 · reference_price: 2 · product: 1 · product_location: 1
[restaurar-tenant]   recipe: 1 · recipe_line: 1 · period: 1 · physical_count_line: 1
[restaurar-tenant]   physical_count: 1 · inventory_movement: 3
[restaurar-tenant] meses cerrados: 1, los mismos que en la copia
[restaurar-tenant] listo — los recuentos cuadran tabla por tabla

=== ¿cuadra ensayo-b?   IGUAL      (agosto CERRADO, saldo 15.000000000000)
=== ¿se movio ensayo?   INTACTO
```

## 4 · Las cuatro cosas que encontró

Ninguna se vio leyendo el código. Las cuatro las dijo PostgreSQL.

| # | Lo que dijo | Qué era, y qué se hizo |
|---|---|---|
| 1 | `La tabla inventory_transfer es append-only: DELETE rechazado` | La **catástrofe** apagaba tres triggers por nombre y faltaba uno. Una lista de guardianes escrita a mano envejece: ahora se usa `SET LOCAL session_replication_role = replica`, que los apaga todos para esa transacción y solo para ella |
| 2 | `relation "period" does not exist` | `pg_dump --data-only` abre cada volcado con `set_config('search_path', '', false)`. Sus `INSERT` van cualificados y no lo notan; el SQL escrito a mano que va entre dos volcados, sí. Todo nombre va con `public.` delante |
| 3 | `permission denied to create temporary tables` | El recierre de períodos usaba una tabla temporal, y `costeo_app` **no tiene privilegio `TEMP`** — mínimo privilegio haciendo su trabajo. La lista de períodos a recerrar vive ahora en un parámetro de la transacción (`set_config(..., true)`), igual que `app.company_id`. **La barrera no se baja para que el script funcione: el script se amolda** |
| 4 | `relation "physical_count" does not exist`, desde dentro de un trigger | **INC-030**: tres funciones de guarda no fijaban su `search_path` y resolvían el nombre de la tabla que vigilan con el del llamante. Migración `p16g2_search_path_de_las_guardas` + check **M12** en `audit:migrations` |

## 5 · Los dos guardianes, resueltos por orden

| Guardián | Por qué estorba | Cómo se le pasa por delante |
|---|---|---|
| `inventory_movement_respeta_periodo_cerrado` | El libro que vuelve es de meses cerrados | Los períodos entran, se **reabren**, entra el libro y se **vuelven a cerrar**, todo en la misma transacción. Sus `CHECK` admiten el estado intermedio (`period_cerrado_tiene_autor` solo habla de los CERRADO) |
| `physical_count_line_solo_en_borrador` | Un mes cerrado trae su conteo CONFIRMADO, y sus líneas no se pueden escribir | **Las líneas van antes que su conteo.** El guardián se ejecuta, no encuentra conteo todavía y deja pasar; que cada línea acabe teniendo el suyo lo comprueba la clave foránea al COMMIT |

El segundo **es una decisión del usuario**, tomada con su contra a la vista: se hizo diferible la
clave foránea `physical_count_line_count_id_company_id_fkey`
(`p16g2_fk_diferible_del_conteo`, `DEFERRABLE INITIALLY IMMEDIATE`) y la restauración es la única que
la difiere. Las dos alternativas se descartaron: aflojar los tres `CHECK` bicondicionales del conteo
más una excepción en su trigger *(debilita dos invariantes para todos)*, y aceptar el hueco *(un
cliente con más de un mes de uso no se podría restaurar solo, que es justo para lo que existe
D-16.195)*.

**El contra, dicho donde se paga** —en `scripts/lib/tenant.mjs` y en el runbook—: durante esa
ventana el guardián de la línea pasa *en vacío*. Fuera de ella nada cambia; la clave es
`INITIALLY IMMEDIATE` y la aplicación no difiere nunca, así que una línea huérfana escrita por la
API sigue fallando en el acto.

## 6 · Lo que se añadió para que no vuelva a pasar

| | |
|---|---|
| **M12** en `audit:migrations` | Una migración que crea una función sin fijar su `search_path` —ni ahí ni en ninguna posterior— rompe el build. **Probado que no es decorativo**: quitando la migración del arreglo, vuelve a saltar; poniéndola, verde |
| **`exigirLosMesesCerrados`** | `comparar` cuenta filas y no vería un período restaurado como ABIERTO. Ahora se compara el número de meses CERRADOS entre copia y destino, y falla si no coincide. El recierre depende de un parámetro de transacción: **este contador es lo único que avisaría si un día deja de poblarse** |
| **Runbook** | La tabla de ensayos distingue «sin libro» (2026-09-17) de «con libro y mes cerrado» (2026-09-20), y dice que el segundo es el que hace que el procedimiento esté probado para un cliente real. Incluye cómo repetirlo |

## 7 · La señal del respaldo nocturno

No es una tarea, es un umbral escrito: **cuando la verificación nocturna pase de 20 minutos** en el
VPS —se mide en `/var/log/costeo-respaldo.log`—, pasa a semanal o a otra máquina que restaure la
copia remota. El volcado sigue siendo diario en los dos casos: lo que se espacia es la comprobación.
El porqué del número está en el runbook.

## 8 · Y una recurrencia de INC-007, la catorce

La regex de M12 se escribió desde un generador donde `\b` es el carácter de **retroceso** (0x08).
`sin-caracteres-de-control` la paró antes del commit, señalando archivo, línea y columna. Se anota
en INC-007 como caso 14: lo único nuevo que aporta es que **la prevención del caso 8 aguanta**.
