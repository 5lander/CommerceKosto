# P3 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-09-04 | Claude Code | `P3: Precios de referencia con vigencia` |

```
AUDITORÍA P3

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30
D. Base de datos     ✅ D1-D13
E. Reglas de negocio ✅ R5 y R13 ACTIVAS · R10 modelada · E8, E9 y E20 probados
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 408 pruebas en verde
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

npm run audit        exit=0, doce checks · 27 reglas sobre 136 archivos
Pruebas              277 unitarias (base APAGADA) + 131 de integración
```

---

## Los tres criterios de aceptación

| Criterio | Dónde se prueba | Qué se comprueba |
|---|---|---|
| **E8** — cambiar el precio hoy no altera el costo de un mes anterior | `vigencia.spec.ts` (dominio, sin base) + `precios.spec.ts` (extremo a extremo) | Se confirma un precio de enero, se lee el costo de febrero, se confirma uno de marzo, y el costo de febrero **es el mismo byte a byte** |
| **E9** — ningún precio pasa a vigente sin confirmación | `precios.spec.ts` | Un precio sugerido existe, se ve en el historial y el costo devuelve 404. En cuanto se confirma, aparece. Un rechazado no cuenta |
| **E20 / R13** — sin IVA recuperable el costo sube el IVA exacto | `cadena-de-costo.spec.ts` + `precios.spec.ts` | El cociente entre los dos costos es **1.15, ni un dígito más** |

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `modules/pricing/domain/` no importa nada de fuera del dominio compartido. 133 módulos, 455 dependencias, cero violaciones |
| A2 | ✅ | Los seis casos de uso no importan NestJS ni Prisma |
| A3 | ✅ | La cadena de costo y la vigencia son dominio puro y se prueban con la base apagada |
| A4 | ✅ | Objeto de parámetros por constructor |
| **A5** | ✅ | **`pricing` lee el catálogo por sus puertos, nunca por sus tablas.** El primer intento consultaba `tx.item` a mano y `tablas-de-catalogo-solo-en-catalog` lo paró; se resolvió exportando `LeerItem` desde `catalog` |
| A6 | ✅ | 277 unitarias con PostgreSQL apagado |

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B1–B7 | ✅ | Lint y prohibiciones en verde |
| B8 | ✅ | `ReferencePriceId` como tipo marcado. Los decimales viajan como **cadena** en todo el puerto |
| B9 | ✅ | Errores tipados; `ItemSinPrecioError` sale como 404 porque «todavía no hay precio» es una respuesta legítima, no un fallo |
| B12 | ✅ | 0 clones |

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1–C3 | ✅ | `company_id` en `reference_price`; RLS `ENABLE` + `FORCE` en las tres tablas nuevas |
| C4–C6 | ✅ | Todo por `TenantTransaction`. La prueba que reescribe un precio usa **la capa real**, no un cliente crudo |
| C8 | ✅ | Esquemas `.strict()`; ninguno acepta `companyId` |
| C13 | ✅ | **Sugerir y confirmar son dos permisos.** `GERENTE_LOCAL` sugiere y recibe 403 al confirmar |
| C24 | ✅ | **`BODEGA` no tiene ni lectura de precios** (CLAUDE.md §4.3): con el precio y la cantidad se despeja la receta |
| C26 | ✅ | `audit:deps` en verde. P3 no añadió dependencias |

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | `migrate:verify` en verde con sus cuatro pasos |
| D3 | ✅ | Clave foránea **compuesta** contra `purchase_article(id, item_id)`: el artículo de un precio tiene que ser del mismo ítem |
| D4 | ✅ | `CHECK` para el precio positivo, el IVA como fracción, la coherencia de la confirmación y los ocho ratios de los ajustes |
| D7 | ✅ | El índice de CLAUDE.md §5: `(company_id, item_id, valid_from DESC)`. Igualdad antes que rango, descendente porque «vigente» es «el más reciente que ya empezó» |
| D8 | ✅ | Sin `DELETE` sobre precios: un precio es historia |
| D9 | ✅ | `audit:migrations` con sus 10 comprobaciones, M10 incluida |
| D13 | ✅ | La resolución de un precio es una sola sentencia con su condición en el `WHERE` |

**`EXPLAIN ANALYZE`.** La consulta del camino crítico —el precio vigente de un ítem— usa el índice `(company_id, item_id, valid_from DESC)` sobre decenas de filas por ítem. El presupuesto de CLAUDE.md §5 habla de costeo e inventario con volumen realista y **empieza a medirse en P5**; medir contra veinte filas es lo que ese mismo párrafo prohíbe.

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | 408 en verde |
| G2 | ✅ | 277 unitarias con la base apagada, incluida **la cadena de costo entera** |
| G5 | ✅ | Sin sabotaje nuevo: las dos reglas que P3 ejercitó —la del catálogo y `sin-set-local-a-mano`— **se dispararon de verdad durante la construcción**, que es la prueba del guardián ocurriendo sola |
| G7 | ✅ | Cero datos reales |

### Dos pruebas que casi no prueban nada

Merecen quedar escritas porque las dos son la misma trampa:

**«Un precio confirmado no se puede reescribir»** pasaba lanzando el `UPDATE` sin tenant: RLS filtraba, la sentencia afectaba a cero filas, y `UPDATE 0` es un éxito. El trigger nunca se disparaba. Ahora la escritura va por `TenantTransaction`, la fila es visible, y lo que la protege es el trigger.

**Y la afirmación tampoco podía ser sobre el mensaje**: el texto del trigger llega envuelto por Prisma, y atarse a esa envoltura ataría la prueba a cómo el ORM formatee sus errores. Se comprueba el **importe guardado**, que es la propiedad que importa.

---

## H. Documentación

| # | Resultado | Evidencia |
|---|---|---|
| H1 | ✅ | `CONSTRUCCION.md` y este documento |
| H2 | — | P3 no necesitó ADR. La decisión que más lo merecía —dónde vive la tasa de IVA de compra— está razonada en `CONSTRUCCION.md` y en el propio esquema, y está **marcada para confirmación del usuario** |
| H3 | ✅ | Sin incidencias nuevas: los dos tropiezos —`migrate dev` interactivo y la prueba que no tocaba nada— se resolvieron en menos de veinte minutos cada uno y su prevención quedó en el código, no en una ficha |
| H4–H7 | ✅ | Modelo de datos, API, CHANGELOG y ESTADO |

---

## Veredicto

**P3 cierra.** R5 está activa y hecha cumplir en cuatro capas independientes; R13 está probada con el cociente exacto; la cadena de costo de SPEC §12 existe como dominio puro y **P5 la puede usar tal cual**.

**Una decisión que el usuario debería confirmar:** la tasa de IVA de compra se modeló **en el precio**, no en la company. El SPEC nombra `iva_compra` en la fórmula pero no dice dónde vive. Se eligió el superconjunto —si la intención era una sola tasa, este modelo la expresa; al revés no se puede sin migrar cada precio— por un motivo concreto: en Ecuador el alimento sin procesar es 0 % y el detergente 15 %, y una única tasa estaría equivocada para uno de los dos.
