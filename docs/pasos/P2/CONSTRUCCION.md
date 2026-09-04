# P2 — Documento de construcción

## Resumen

| Campo | Valor |
|---|---|
| Paquete | P2 — Catálogo: ítems, artículos de compra, unidades |
| Fecha inicio / fin | 2026-09-04 |
| Commit final | `P2: Catálogo · ítems · artículos · unidades` |
| Secciones del SPEC implementadas | §5 (ítems, artículos y preparaciones), §12 parcialmente (el factor de conversión) |
| Estado | ✅ completado |

## Objetivo del paquete

**La fuente única de verdad del proyecto.** Al terminar P2, tres marcas de harina son tres artículos y un solo ítem; en las recetas aparece solo el ítem; y ningún otro módulo puede escribir en las tablas del catálogo aunque quiera.

**Criterio de aceptación:** tres artículos de distinta marca apuntan al mismo ítem y en la pantalla de recetas aparece solo el ítem · ningún otro módulo escribe en las tablas de catálogo, verificado por `dependency-cruiser` · una conversión inválida (kg → unidades sin factor) se rechaza **en el dominio**.

---

## Qué se construyó

### Esquema — 8 tablas

| Tabla | Tenant | Nota |
|---|---|---|
| `unit` | **ninguno, global** | Un kilogramo pesa lo mismo en todas las companies |
| `unit_dimension` | catálogo | MASA · VOLUMEN · CONTEO |
| `item_type` | catálogo | COMPRADO · PRODUCIDO |
| `item_status` | catálogo | ACTIVE · INACTIVE |
| `price_confidence` | catálogo | FACTURA · ESTIMADO — el tipo `SUP` del Excel |
| `item_group` | `company_id` | Cada comercio agrupa como quiere |
| `item` | `company_id` | Lo único que ve quien arma una receta |
| `purchase_article` | `company_id` | Lo único que ve quien registra una compra |

### Tres decisiones de esquema que merecen su párrafo

**El catálogo de unidades es GLOBAL y de solo lectura para la aplicación.** `factor_to_base` es una constante física, no una preferencia: un catálogo por tenant significaría que una company puede declarar que su kilo tiene 900 gramos, y ese error saldría como un costo plausible y equivocado. La aplicación no tiene ni `INSERT`. Hay una prueba que intenta el `UPDATE` y falla.

> **La contrapartida, dicha en voz alta:** no se pueden crear unidades propias («atado», «bandeja»). Se modelan como presentación del artículo de compra —«atado de 6 unid»—, que es donde de verdad viven. Si algún día hiciera falta de otra forma, sería una columna `company_id` nullable con política `company_id IS NULL OR company_id = current_company()`.

**No existe la tabla `unit_conversion` que el plan listaba**, y es una desviación consciente. Entre unidades de la misma dimensión el factor es el cociente de sus `factor_to_base`: una tabla guardaría filas derivables, que es la clase de dato que se desincroniza. Entre dimensiones distintas —«un huevo pesa 50 g»— la conversión no es universal sino **del ítem**, y por eso vive en `purchase_article.conversion_factor`. Una tabla de conversiones globales entre `unid` y `g` sería, literalmente, afirmar que todos los huevos pesan lo mismo.

**El índice de deduplicación es de EXPRESIÓN, no una columna generada.** Una columna `name_normalized` mantenida por la aplicación se desincroniza el día que alguien escriba por otra vía; una columna `GENERATED` de PostgreSQL no la sabe declarar Prisma y produciría deriva entre el esquema y las migraciones. `CREATE INDEX ... USING gin (lower("name") gin_trgm_ops)` no tiene ninguno de los dos problemas.

> Es **el único índice del proyecto sin consulta que lo use hoy**, y por tanto una excepción consciente a CLAUDE.md §5. Está en los entregables aprobados de P2 y su consumidor es P10; crearlo sobre una tabla con decenas de miles de filas ya cargadas es más caro que crearlo vacía.
>
> Sin plegado de acentos: «puree» y «puré» no se parecerían. `unaccent` no es `IMMUTABLE`, y envolverla para que lo parezca es una trampa conocida que rompe los volcados. P10 puede aplicar `unaccent` en la consulta — el índice trigrama es un prefiltro, no la respuesta.

### El dominio, que es donde está el criterio de aceptación

| Archivo | Qué decide | Pruebas |
|---|---|---|
| `conversion.ts` | Cuántas unidades de uso salen de un artículo. Deriva el factor si comparten dimensión; lo **exige** si no; y lo **rechaza** si es derivable | 14 |
| `item.ts` | Nombre, rendimiento entre 0 y 1, y el interruptor de stock solo en preparaciones | 12 |

**Por qué rechazar un factor explícito cuando es derivable**, en vez de ignorarlo o dejar que gane. Porque un saco de 2 kg con «factor 1500» escrito a mano produce un costo por gramo un 33 % más alto, y nada en la pantalla lo delata: el número es plausible. Lo que se puede calcular no se captura. Un dato capturado que contradice a la física es un error de captura, y se dice.

**Por qué el rendimiento no puede pasar de 1.** `costo_neto_uso = costo_bruto_uso / rendimiento` (SPEC §12): dividir por él **encarece** el ítem, porque es el costo de comprar producto que se pierde al limpiarlo. Un rendimiento de 1.2 haría el ítem más barato que su precio de compra —limpiar crearía materia— y el número saldría plausible. El techo está en el dominio **y** en un `CHECK`.

El cero **sí** se admite: SPEC §12 lo trata como guarda explícita (`rendimiento = 0 ? 0 : ...`), y es el caso de un ítem cuyo rendimiento todavía no se midió.

### La fuente única de verdad, hecha cumplir por dos vías

CLAUDE.md §2 dice que ningún otro módulo crea, edita ni borra ítems, artículos ni unidades. Hay **dos formas** de saltárselo y cada una se ve en un sitio distinto:

| Vía | Check | Qué impide |
|---|---|---|
| Importar la infraestructura de `catalog` | `audit:arch`, regla `catalogo-solo-lo-escribe-catalog` | La vía limpia, la que alguien tomaría sin mala intención |
| Escribir en las tablas desde otro repositorio | `audit:forbidden`, regla `tablas-de-catalogo-solo-en-catalog` | `dependency-cruiser` no ve un `tx.item.create()` dentro del repositorio de otro módulo: para él es un import de `shared/infrastructure/persistence`, que es legítimo |

Las dos tienen su prueba del guardián, con la salida capturada en `evidencia/`. Una sola dejaría la otra puerta abierta, y la abierta es siempre la que alguien encuentra.

### El módulo exporta lecturas, no el repositorio

`CatalogModule` exporta `ListarItems` y `ListarArticulos`, que es lo que P3, P4 y P6 van a necesitar: el precio de referencia lee ítems, la receta lee ítems, el inventario lee ítems. Ninguno escribe. Si algún día un módulo necesitara crear un ítem, eso es una conversación, no un `import`.

---

## Superficie de API

| Método | Ruta | Permiso | Respuesta |
|---|---|---|---|
| `GET` | `/catalogo/items?incluirInactivos=true` | `catalog.read` | 200 |
| `POST` | `/catalogo/items` | `catalog.create` | 201 · 400 · 409 |
| `PUT` | `/catalogo/items/:id` | `catalog.update` | 204 · 400 · 404 |
| `GET` | `/catalogo/articulos?itemId=…` | `catalog.read` | 200 |
| `POST` | `/catalogo/articulos` | `catalog.create` | 201 · 400 · 404 · 409 |
| `GET` | `/catalogo/grupos` | `catalog.read` | 200 |
| `POST` | `/catalogo/grupos` | `catalog.create` | 201 · 409 |

**`PUT` y no `PATCH`** en el ítem: el cuerpo trae el estado completo de lo editable. Un `PATCH` con campos opcionales haría que «no mandé el grupo» y «quiero quitarle el grupo» fueran la misma petición.

**El tipo y la unidad de uso no se pueden cambiar.** No es una omisión: cambiar la unidad de uso de un ítem que ya tiene recetas y movimientos convertiría cada cantidad histórica en otra magnitud sin tocarla —200 «g» pasarían a ser 200 «kg»— y el costo se multiplicaría por mil en silencio. Si hace falta, se crea un ítem nuevo y se archiva el viejo.

**No hay `DELETE`.** Un ítem se marca `INACTIVE`. El rol de la aplicación no tiene el privilegio, y hay una prueba que lo intenta.

**`catalog.read` lo tienen también `GERENTE_LOCAL` y `BODEGA`**, porque necesitan ver los ítems para contar inventario (P7). Un ítem no revela ninguna receta: lo que CLAUDE.md §4.3 protege son las líneas de receta y los derivados del consumo, que llegan en P4 y P6.

---

## Prueba manual

```bash
npm run db:up && npm run migrate:deploy && npm run migrate:verify
npm run test && npm run audit
```

```bash
# El ítem: lo que ve quien arma una receta
curl -s -X POST localhost:3000/catalogo/items -H 'Cookie: sesion=<token>' \
  -H 'content-type: application/json' \
  -d '{"nombre":"Harina de trigo","tipo":"COMPRADO","unidadDeUso":"g",
       "rendimiento":"1","grupoId":null,"confianzaDePrecio":"FACTURA","llevaStock":null}'
# 201 {"id":"..."}

# Tres marcas, un solo ítem. El factor NO se manda: lo calcula el dominio.
curl -s -X POST localhost:3000/catalogo/articulos -H 'Cookie: sesion=<token>' \
  -H 'content-type: application/json' \
  -d '{"itemId":"<item>","nombre":"Harina Ya 2kg","marca":"Ya","proveedor":null,
       "presentacion":"2","unidadDePresentacion":"kg","factorExplicito":null}'
# 201 — y el artículo queda con conversionFactor = 2000

# El criterio de aceptación: kg -> unidades sin factor
# (con un ítem cuya unidad de uso sea "unid")
# 400 ENTRADA_INVALIDA — "Hace falta decir cuántas unidades de uso salen de una
#                         unidad de compra: no hay forma de deducirlo."
```

---

## Lo que se descubrió por el camino

**M10 marcaba un borrado legítimo.** El `down.sql` de P2 retira las capacidades `catalog.*` de `permission`, a las que solo apunta `role_permission`, que se vacía en la sentencia de al lado. La primera versión de M10 marcaba **todo** borrado sobre una tabla que sobrevive, y eso habría empujado a abrir una lista de excepciones por migración — el patrón que INC-011 y `no-sql-interpolado` ya enseñaron que envejece mal.

Se afinó: ahora M10 **lee las claves foráneas de todas las migraciones** y solo marca cuando alguien que apunta a esa tabla no se vacía ni se suelta en el mismo archivo. Sigue cazando el caso original de INC-011 —`audit_log` referencia `audit_event_type` y es append-only, así que nunca puede vaciarse—, con la salida capturada en `evidencia/`.

Queda un límite conocido, escrito en la propia regla para que nadie lo confunda con una garantía: que el referenciante se vacíe en el mismo archivo se toma como afirmación del autor. Si los dos `DELETE` llevan `WHERE` que no casan, esto no lo ve.

**El código de dominio `CONFLICTO` volvió.** Se retiró en P1 porque nadie lo usaba —YAGNI— y P2 lo necesitó para el nombre repetido, que es 409 y no 400: la petición está bien formada, lo que choca es el estado que ya hay. El `Record` exhaustivo del filtro de errores obligó a mapearlo antes de compilar, que es exactamente para lo que está.

---

## Deuda

**Pagada en este paquete:** la excepción `enmiendasAutorizadas` de `sin-migracion-commiteada-modificada`. La enmienda de P0 ya viajó en el commit de P1, así que el archivo coincide con `HEAD` y la excepción no protegía nada; dejarla puesta sería una puerta abierta sin nadie detrás. La lista está vacía y la regla sigue midiendo — el guardián lo comprueba en `evidencia/guardian-migracion-commiteada.txt`.

**Pendiente:**

| Qué | Cuándo |
|---|---|
| Lista blanca de knip para `shared/domain/**` | P5, y P5 no cierra con ella puesta |
| Plegado de acentos en la deduplicación | P10, en la consulta |
| Unidades propias por company | Sin paquete; hoy se modelan como presentación del artículo |
| `LNK` (D4 🔴) | No bloquea: la ficha fija «no modelar nada para `LNK`», y si aparece al importar se rechaza la fila |
