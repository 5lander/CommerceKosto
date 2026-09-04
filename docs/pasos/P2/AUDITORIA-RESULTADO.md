# P2 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-09-04 | Claude Code | `P2: Catálogo · ítems · artículos · unidades` |

```
AUDITORÍA P2

A. Arquitectura      ✅ A1-A6   · A5 aplica por primera vez
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30
D. Base de datos     ✅ D1-D13
E. Reglas de negocio ✅ E1-E23  · R1 activa; R4 preparada
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 371 pruebas en verde
H. Documentación     ✅ H1-H14
I. Optimización      ✅ I1-I10

npm run audit        exit=0, doce checks · 27 reglas de contenido sobre 119 archivos
Pruebas              253 unitarias (base APAGADA) + 118 de integración
```

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `modules/catalog/domain/` no importa nada de fuera de sí mismo y del dominio compartido. 117 módulos, 385 dependencias, cero violaciones |
| A2 | ✅ | Los siete casos de uso de `catalog` no importan NestJS ni Prisma; se construyen con `useFactory` |
| A3 | ✅ | Las dos reglas del paquete —conversión y validez del ítem— están en `domain` y se prueban sin base |
| A4 | ✅ | Objeto de parámetros por constructor; `DependenciasDeCatalogoNest` es lo único que conoce los tokens |
| **A5** | ✅ **aplica por primera vez** | «Ningún módulo que no sea `catalog` crea ítems, artículos o unidades», por **dos** vías: `catalogo-solo-lo-escribe-catalog` en `audit:arch` y `tablas-de-catalogo-solo-en-catalog` en `audit:forbidden`. Las dos con prueba del guardián |
| A6 | ✅ | 253 unitarias con PostgreSQL apagado, incluidas las 26 del catálogo |

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B1–B7 | ✅ | `audit:lint` y `audit:forbidden` en verde. Cero `any`, cero `as unknown as` |
| B8 | ✅ | `ItemId`, `PurchaseArticleId`, `ItemGroupId` como tipos marcados, validados al construir. `Ratio` y `Quantity` para todo lo decimal |
| B9 | ✅ | Errores tipados; el código `CONFLICTO` volvió al `Record` exhaustivo porque P2 le dio consumidor |
| B10 | ✅ | Aquí los mensajes **sí** salen: quien captura un ítem ya está autenticado y dentro de su company. Callar solo tiene sentido cuando el que pregunta puede no ser quien dice ser |
| B11 | ✅ | Sin código comentado |
| B12 | ✅ | `audit:duplication`: 0 clones |

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1–C3 | ✅ | `company_id` en las tres tablas de negocio; RLS `ENABLE` + `FORCE` en las ocho, con política. M6, lista de exentas vacía |
| C4–C6 | ✅ | Todo pasa por `TenantTransaction`. `catalogo.spec.ts` comprueba que el ADMIN de otra company no ve estos ítems |
| C8 | ✅ | Ningún esquema acepta `companyId`; todos `.strict()` |
| C24 | ✅ | `GERENTE_LOCAL` lee el catálogo (lo necesita para contar inventario) y recibe 403 al escribirlo |
| C26 | ✅ | `audit:deps` en verde, sin avisos nuevos: P2 no añadió ninguna dependencia |
| C30 | ✅ | **El catálogo de unidades es de solo lectura para la aplicación**, verificado con un `UPDATE` que falla. Una company no puede declarar que su kilo pesa 900 gramos |

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | `migrate:verify` en verde con sus cuatro pasos, incluido el de deriva: ni el índice de expresión ni los bloques manuales la producen |
| D2–D4 | ✅ | 3FN, enums en tabla de catálogo, `CHECK` en la base para cada regla del dominio |
| D5–D6 | ✅ | UUID v7, `timestamptz`, `numeric(24,12)` en los tres decimales del paquete |
| D7 | ✅ | Índices compuestos que empiezan por `company_id`. Ver la tabla de `modelo-datos.md` |
| D8 | ✅ | **Sin borrado**: la aplicación no tiene `DELETE` sobre `item`, `purchase_article` ni `item_group`, y hay una prueba que lo intenta |
| D9 | ✅ | `audit:migrations`, 10 comprobaciones. **M10 se afinó** para leer claves foráneas |
| D10–D11 | ✅ | Sin `SELECT *`, sin N+1 |
| D12 | ✅ | El factor de conversión se calcula una vez y se guarda: el motor de costeo de P5 no tendrá que leer el catálogo de unidades |
| D13 | ✅ | Transacciones cortas |

**`EXPLAIN ANALYZE`.** Las consultas de P2 son listados por `company_id` con `ORDER BY name`, sobre catálogos de cientos de filas. El presupuesto de CLAUDE.md §5 habla de costeo e inventario y **empieza a medirse en P5**, con volumen sintético realista: medir contra veinte filas es lo que ese mismo párrafo prohíbe.

El único índice sin consulta hoy es `item_name_similitud`, y está justificado arriba y en `CONSTRUCCION.md`.

---

## E. Reglas de negocio

| # | Resultado | Evidencia |
|---|---|---|
| E1 (R1) | ✅ | Aislamiento verificado también sobre las tablas nuevas |
| **R4 (base AP/EP)** | ✅ **preparada** | No se calcula todavía —eso es P5—, pero el rendimiento ya está modelado con su techo de 1 y su significado escrito. `costo_neto_uso = costo_bruto_uso / rendimiento` no puede dar un ítem más barato que su precio de compra |
| E22 | ✅ | Sin punto flotante: todo decimal entra por cadena, y hay una prueba que rechaza un `number` en el cuerpo HTTP |
| Resto | — **aún no aplica** | R2, R3 desde P6; R5 desde P3; R6, R14 desde P5 |

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | 371 en verde: 253 unitarias + 118 de integración |
| G2 | ✅ | Las 253 unitarias con la base apagada, incluido el criterio de aceptación de P2 |
| G5 | ✅ | **Prueba del guardián**: tres sabotajes con su salida capturada |
| G7 | ✅ | Cero datos reales; sufijo aleatorio por corrida |

### La prueba del guardián — tres sabotajes

| # | Defensa | Sabotaje | Salida |
|---|---|---|---|
| 1 | `tablas-de-catalogo-solo-en-catalog` | `iam` escribe en `item` | `evidencia/guardian-catalogo-fuente-unica.txt` |
| 2 | `catalogo-solo-lo-escribe-catalog` | `iam` importa la infraestructura de `catalog` | `evidencia/guardian-arch-catalogo.txt` |
| 3 | `sin-migracion-commiteada-modificada` **sin excepciones** | Se toca la migración de P0 | `evidencia/guardian-migracion-commiteada.txt` |
| 4 | `audit:migrations` M10 **afinada** | Se restaura el borrado que causó INC-011 | `evidencia/guardian-migrations-m10-afinada.txt` |

El nº 3 es el que cierra una deuda: la excepción `enmiendasAutorizadas` está **vacía** y la regla sigue midiendo.

---

## H. Documentación

| # | Resultado | Evidencia |
|---|---|---|
| H1 | ✅ | `CONSTRUCCION.md` y este documento |
| H2 | — | P2 no necesitó ADR: ninguna decisión suya reabre una anterior. Las dos que podrían haberlo merecido —el catálogo global de unidades y la ausencia de `unit_conversion`— están razonadas en `CONSTRUCCION.md` y en el propio esquema, que es donde alguien las va a leer |
| H3 | ✅ | Sin incidencias nuevas: nada costó más de veinte minutos ni apuntó al lugar equivocado |
| H4 | ✅ | `modelo-datos.md` con el diagrama de las ocho tablas |
| H5 | ✅ | `docs/apis/app-cliente.md` con la superficie de catálogo |
| H6–H7 | ✅ | `CHANGELOG.md` y `ESTADO.md` |

---

## Veredicto

**P2 cierra.** El criterio de aceptación se cumple en sus tres partes, y la que más importa —«una conversión inválida se rechaza en el dominio»— se prueba con la base apagada.

**Una desviación del plan, consciente:** no existe la tabla `unit_conversion` que los entregables listaban. El razonamiento está en `CONSTRUCCION.md`: entre unidades de la misma dimensión sus filas serían derivables, y entre dimensiones distintas la conversión no es universal sino del ítem, que es donde está. Si el usuario prefiere la tabla, es una migración y un puerto; nada de lo escrito se pierde.
