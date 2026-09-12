# INC-012 — Un `CHECK` o un trigger sale como `INTERNAL_ERROR 500`

| Campo | Valor |
|---|---|
| **Síntoma** | Una petición con datos incoherentes devuelve **500 `INTERNAL_ERROR`** en vez de 400. En el log hay un `23514` (check_violation) o un `P0001` (raise de trigger) del driver de PostgreSQL |
| **Área** | arquitectura · base de datos |
| **Paquete** | P5 (las dos reglas eran de P3 y P4) |
| **Recurrencias** | **4** — dos en el paquete de origen, la tercera en **P16-A2** (la clave foránea de unidad y los índices únicos de nombre del catálogo) y la cuarta en **P16-B** (cuatro `CHECK` marcados «lo filtra el esquema» que el esquema no filtraba) |
| **Estado** | ✅ resuelto |

---

## Síntoma exacto

Dos peticiones perfectamente razonables desde el punto de vista del usuario:

```
PUT /productos/{id}/ubicaciones   { activo: true, pvp: null, ... }   -> 500
POST /precios                     { itemId: <COMPRADO>, purchaseArticleId: null } -> 500
```

El cuerpo de la respuesta es `{ "code": "INTERNAL_ERROR", "message": "..." }`, que es lo que el filtro de errores devuelve ante cualquier excepción que **no** sea un `ErrorDeDominio`.

## Qué estaba pasando

Las dos reglas existen y funcionan. Están en la base, que es donde CLAUDE.md §5 quiere que estén:

```sql
-- P4
ALTER TABLE "product_location"
  ADD CONSTRAINT "product_location_activo_tiene_pvp"
  CHECK ("activo" = false OR "pvp" IS NOT NULL);

-- P3
IF tipo = 'COMPRADO' AND NEW."purchase_article_id" IS NULL THEN
  RAISE EXCEPTION '...';
```

Lo que faltaba era la otra mitad de la regla de CLAUDE.md §3: **la base garantiza, el dominio explica.** Sin la guarda de dominio, el error del driver sube sin traducir, el filtro no lo reconoce como error de dominio y lo convierte en 500 — «un fallo del servidor» cuando lo que hay es un formulario a medio llenar.

**Y un 500 no es solo un código feo.** Dispara alertas de operación, se cuenta como caída en cualquier métrica de disponibilidad, y no le dice al usuario qué corregir.

## Por qué costó verlo

**Porque las pruebas de P3 y P4 nunca montaron esos casos.** Las dos reglas se probaron por el lado que funciona: un producto activo **con** PVP, un precio **con** artículo. El caso incoherente no se probó porque no era el criterio de aceptación de ningún paquete.

Los dos aparecieron el mismo día, al montar los bordes de **CC-009** —un producto sin PVP— y al poner un precio nuevo a un ítem ya existente en la prueba de E8. Es decir: los encontró un paquete posterior, escribiendo pruebas de otra cosa.

## Solución aplicada

Una guarda de dominio por regla, delante de la base, con el mensaje que el usuario necesita:

```ts
// ConfigurarProductoEnUbicacion
if (datos.activo && datos.pvp === null) {
  throw new RecetaInvalidaError(
    'Un producto activo necesita PVP: sin él se podría vender sin saber a cuánto, ' +
    'y su margen saldría indefinido.',
  );
}
```

```ts
// SugerirPrecio.exigirArticuloCoherente
if (item.tipo === 'COMPRADO' && datos.purchaseArticleId === null) { ... }
if (item.tipo === 'PRODUCIDO' && datos.purchaseArticleId !== null) { ... }
```

**La restricción de la base NO se toca.** Sigue siendo la garantía; la guarda es la explicación. Quitar el `CHECK` para «arreglar» el 500 sería exactamente el error inverso.

## Tercera recurrencia — P16-A2, y lo que obliga

El mismo fallo con **otras dos restricciones**, que no son ni un `CHECK` ni un trigger y por eso M11 no las vigilaba:

| Restricción | Petición razonable que daba 500 |
|---|---|
| clave foránea `item_unit_of_use_fkey` | `POST /catalogo/items` con `unidadDeUso: "l"` — bien formada y **inexistente**: el litro es `lt` |
| índices únicos `item_company_id_name_key` · `purchase_article_company_id_name_key` | renombrar un ítem a un nombre ocupado · **reimportar el mismo archivo de `ARTICULOS`** · la carrera entre la lectura de nombres de dos lotes |

Traducidas en P16-A2: **400** con las diez unidades válidas enumeradas, y **409** con el nombre que sobra dentro. La base sigue siendo la garantía; el dominio explica.

**Y con la tercera recurrencia, CLAUDE.md §8.3 obliga a hacer la prevención que no se hizo.** La revisión de la etapa la señaló con precisión: el 409 de reimportar `ARTICULOS` y el rescate de la carrera **no tenían ni una prueba**, ni unitaria ni de integración, pese a que `guardas-de-dominio.md` marca esos índices como 🔴 y su propia sección «Cómo se mantiene» exige, por cada 🔴, «la guarda de dominio **Y** la prueba de que devuelve 4xx». Una guarda sin prueba es media guarda: funciona hoy y vuelve al 500 en el próximo refactor sin que ningún check se entere — que es exactamente cómo empezó esta incidencia.

## Cuarta recurrencia — P16-B: la fila decía «esquema» y el esquema no filtraba

**Esta vez no faltaba la guarda: faltaba que la guarda declarada existiera.** Cuatro restricciones
estaban en `guardas-de-dominio.md` como 🟡 «filtrada por esquema», que según ese mismo documento
significa «nada más que hacer». Se probó por HTTP **antes** de tocar nada, y las cuatro salían 500:

| Petición | Restricción | Qué decía el esquema |
|---|---|---|
| `POST /precios` con `precio: "0"` o `"-1"` | `reference_price_positivo` | un `decimal` con signo |
| `PUT /productos/:id/ubicaciones` con `pvp: "0"` | `product_location_pvp_positivo` | un `decimal` sin signo, **cero incluido** |
| ídem con `rendimientoPorciones: "0"` | `product_location_rendimiento_positivo` | ídem |
| `POST /inventario/movimientos` MERMA con `costoTotal: "-5"` | `inventory_movement_importe_no_negativo` | un `decimal` **con signo**, mientras la fila afirmaba «no negativo» |

**Por qué costó verlo.** Seis DTO definían diez expresiones regulares propias, casi todas bajo el
nombre `decimal`, y el nombre no dice si admite cero ni signo: en `precios.dto.ts` llevaba signo, en
`recetas.dto.ts` no, y las dos se llamaban igual. Dos de ellas —`magnitud` en inventario y el importe
de analítica— decían «debe ser una cantidad positiva» encima de una regex que aceptaba `"0"`. Quien etiquetaba la fila miraba
que el campo *tuviera* esquema, no qué aceptaba.

**Una quinta candidata no lo era, y el guardián lo dijo.** `purchase_article_presentacion_positiva`
tenía el mismo defecto de esquema, pero `problemaDeConversion` la paraba desde P2: devolviendo el
esquema a la regex vieja la prueba seguía en 400. Solo con las dos capas quitadas sale el 500. La
prueba se había titulado «cuarta recurrencia» y se corrigió antes del commit: es la prevención de
**INC-007** funcionando, no una recurrencia de INC-007.

**Solución.** Guarda de dominio donde faltaba (`SugerirPrecio` → `PrecioNoPositivoError`,
`exigirPositivos` en `ConfigurarProductoEnUbicacion`, la fila del lote de precios) y el esquema
correcto en el borde. Las cuatro filas, más la presentación y los dos `CHECK` de componentes de
combo, pasan a 🔴 **con su prueba citada**, y cada prueba se verificó en rojo quitando su guarda.

### Lo que la cuarta recurrencia obliga a automatizar, y se automatizó

**Un vocabulario único de números en el borde:** `apps/api/src/shared/infrastructure/http/decimales-del-borde.ts`
con `decimalConSigno`, `decimalNoNegativo`, `decimalPositivo`, `fraccion` y `enteroNoNegativo`. Cada
esquema se llama como lo que acepta, así que etiquetar una fila 🟡 obliga a leer un nombre que ya lo
dice: `precio: decimalConSigno` junto a un `CHECK (precio > 0)` no se pasa por alto.

**Y una regla de `audit:forbidden` que impide volver atrás:** `regex-de-numero-solo-en-el-vocabulario`
falla ante cualquier `.regex(` dentro de un `*.dto.ts`. Su guardián se capturó en rojo con una regex
de prueba en `recetas.dto.ts` (ver `docs/pasos/P16-B/AUDITORIA-RESULTADO.md`).

**Lo que sigue sin automatizar.** Que la fila 🔴 cite un archivo de prueba que exista (propuesto en
la tercera recurrencia) sigue manual: la cuarta no entró por ahí, sino por una fila 🟡, y ningún
check puede decidir si un esquema filtra lo que un `CHECK` exige sin leer los dos.

## Prevención

**Automatizada — la que de verdad cierra el caso.** `audit:migrations` gana la comprobación **M11**: toda migración que añada un `CHECK` o una función de trigger que haga `RAISE EXCEPTION` tiene que declarar, en un comentario `-- GUARDA:` junto a la restricción, dónde está su guarda de dominio. Es una línea por restricción y falla el build si falta; no comprueba que la guarda sea correcta —eso no es automatizable— pero sí que alguien se hizo la pregunta.

**Manual, en la checklist.** `docs/AUDITORIA.md` gana **D14**: «toda restricción o trigger nuevo tiene su guarda de dominio, con mensaje, y una prueba que comprueba que sale como 4xx y no como 500».

**Lo añadido por la TERCERA recurrencia (P16-A2, corrección de la etapa «Lecturas»):**

1. **Las pruebas que faltaban, que son la prevención concreta de esta cara.** `test/integracion/importacion.spec.ts` reimporta el mismo `ARTICULOS` —409 `CONFLICTO` con el nombre dentro, y **cero filas escritas**—, y `shared/infrastructure/persistence/rescate-de-choque.spec.ts` cubre las tres ramas del rescate de la carrera con la base apagada, incluida la que relanza el error original cuando la relectura no encuentra nada. Las tres se verificaron **en rojo** desactivando la traducción: vuelven a enseñar el `P2002` crudo.
2. **La regla se extiende a lo que M11 no ve.** `docs/sistema/guardas-de-dominio.md` pide desde ahora que cada fila 🔴 **nombre el archivo de prueba** que comprueba su 4xx, y no solo la guarda. M11 solo puede exigir el `-- GUARDA:` de un `CHECK` o un `RAISE`; una clave foránea o un índice único no tienen dónde ponerlo, y esa es justo la grieta por la que entró esta tercera recurrencia.

**Lo que NO se hizo, y por qué se anota en vez de fingirlo:** automatizar «toda fila 🔴 cita una prueba que existe» exigiría reescribir las **45** filas 🔴 del documento, que es un paquete en sí mismo y no cabe en una corrección de revisión. Queda propuesto para P16-B; mientras tanto la regla es manual y las filas nuevas ya la cumplen.

## Dónde volverá a aparecer

**P6 es el candidato claro.** El libro de inventario es append-only en tres capas, dos de ellas triggers y `REVOKE`. Un `UPDATE` sobre `inventory_movement` tiene que salir como un error de dominio con un mensaje que diga «un error se corrige con un movimiento de signo contrario», no como un 500.

## Relacionadas

- **INC-007** — un check que pasa en verde sin medir nada. Es el mismo patrón visto desde el otro lado: aquí la regla **sí** medía, y lo que faltaba era la traducción de su fallo.
- **INC-010** — `RETURNING` bajo RLS. También un error del motor que llega al usuario sin traducir.
