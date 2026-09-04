# P4 — Resultado de auditoría

| Fecha | Auditor | Commit auditado |
|---|---|---|
| 2026-09-04 | Claude Code | `P4: Recetas · productos · combos` |

```
AUDITORÍA P4

A. Arquitectura      ✅ A1-A6
B. Código            ✅ B1-B12
C. Seguridad         ✅ C1-C30  · E12 (confidencialidad frente a BODEGA) ACTIVA
D. Base de datos     ✅ D1-D13
E. Reglas de negocio ✅ R9 y R11 ACTIVAS · R4 modelada y probada · E14 y E18 probados
F. Frontend          — no aplica: el frontend llega en P12
G. Pruebas           ✅ G1-G7 · 444 pruebas en verde
H. Documentación     ✅ H1-H14 · ADR-007

npm run audit        exit=0, doce checks
Pruebas              298 unitarias (base APAGADA) + 146 de integración
```

---

## Los cuatro criterios de aceptación

| Criterio | Dónde | Qué se comprueba |
|---|---|---|
| **E14** — ciclo a dos niveles rechazado al guardar | `ciclos.spec.ts` (dominio) + `recetas.spec.ts` | Mayonesa lleva huevo; salsa lleva mayonesa; intentar que la mayonesa lleve salsa da **400** con el camino `mayonesa → salsa → mayonesa` en el mensaje |
| **propagar versiona** | `recetas.spec.ts` | Tras propagar, la ubicación destino tiene la receta del origen **y dos filas en `recipe`**, no una editada |
| **E18** — `GERENTE_LOCAL` no propaga | `recetas.spec.ts` | 403 `PERMISO_DENEGADO`. Y sí puede guardar la receta de su ubicación, y no la de otra |
| **revertir devuelve la anterior** | `recetas.spec.ts` | Norte tenía 999, se propaga 100, se revierte y vuelve a 999. Sobre una ubicación sin receta previa, queda `VOID` |

---

## A. Arquitectura

| # | Resultado | Evidencia |
|---|---|---|
| A1 | ✅ | `modules/recipes/domain/` no importa nada fuera del dominio compartido. 148 módulos, 530 dependencias, cero violaciones |
| A2 | ✅ | Los nueve casos de uso no importan NestJS ni Prisma |
| A3 | ✅ | Ciclos y base AP/EP son dominio puro, probados con la base apagada |
| A4 | ✅ | Objeto de parámetros por constructor en todos |
| A5 | ✅ | `recipes` lee ítems por `LeerItem`, el puerto de `catalog`. Cero accesos a sus tablas |
| A6 | ✅ | 298 unitarias con PostgreSQL apagado |

---

## B. Código

| # | Resultado | Evidencia |
|---|---|---|
| B4 | ✅ | Tres funciones se partieron por pasar de 40 líneas o de 3 parámetros; ninguna se relajó el límite |
| B8 | ✅ | `ProductId`, `RecipeId`, `RecipePropagationId` como tipos marcados |
| B9 | ✅ | **`CicloEnRecetaError` pasó de `Error` a `ErrorDeDominio`** al descubrirse que salía como 500 |
| B12 | ✅ | 0 clones |

---

## C. Seguridad

| # | Resultado | Evidencia |
|---|---|---|
| C1–C3 | ✅ | RLS `ENABLE` + `FORCE` en las 12 tablas nuevas, con política |
| C4–C6 | ✅ | Todo por `TenantTransaction` |
| C8 | ✅ | Esquemas `.strict()`. **Y los parámetros de consulta también pasan por esquema** desde este paquete |
| C24 | ✅ | Escalada horizontal probada: `GERENTE_LOCAL` guarda la receta de su ubicación y recibe 403 en otra |
| **E12** | ✅ **ACTIVA** | **`BODEGA` no ve recetas**, comprobado sobre la respuesta cruda: ni el estado 200, ni la cantidad `12345` en ningún punto del cuerpo |

**La política de `recipe_propagation_target` merece su línea.** Esa tabla no tiene `company_id` propio: cuelga de la propagación, que sí lo tiene, y su política se apoya en esa fila con un `EXISTS`. Una columna repetida sería un segundo sitio donde el tenant podría discrepar.

---

## D. Base de datos

| # | Resultado | Evidencia |
|---|---|---|
| D1 | ✅ | `migrate:verify` en verde con sus cuatro pasos |
| D3 | ✅ | Claves foráneas **compuestas** contra `product(id, company_id)` e `item(id, company_id)`: todo lo que una receta referencia es de la misma company |
| D4 | ✅ | `CHECK` para el destino único, el PVP del producto activo, el combo que no se contiene y la cantidad no negativa |
| D7 | ✅ | El índice de CLAUDE.md §5: `(company_id, product_id, location_id, valid_from DESC)` |
| D8 | ✅ | Sin `DELETE` sobre `recipe` ni `product`. Las líneas sí, porque pertenecen a la versión en construcción |
| D9 | ✅ | `audit:migrations`, 10 comprobaciones |
| D11 | ✅ | El grafo de subpreparaciones se trae **entero en una consulta**: pedirlo nodo a nodo sería un N+1 dentro de un recorrido en profundidad |

**`EXPLAIN ANALYZE`.** Las consultas de P4 son búsquedas por `(company_id, product_id, location_id)` con `ORDER BY valid_from DESC LIMIT 1`, servidas por el índice de §5. El presupuesto de 150 ms para guardar una receta se sostiene por construcción: una consulta del grafo, un recorrido lineal en memoria y dos inserciones. **La medición con volumen sintético realista es de P5**, como todo el presupuesto de rendimiento.

---

## E. Reglas de negocio

| # | Resultado | Evidencia |
|---|---|---|
| **R9** | ✅ **activa** | Ciclos rechazados al guardar, directos y a tres niveles, con el camino en el mensaje |
| **R11** | ✅ **activa** | Previsualización, permiso separado, registro y reversión por local. ADR-007 |
| **R4** | ✅ **modelada y probada** | Los dos casos con resultados **distintos y conocidos**: EP 0.50, AP 0.40 |
| R14 | ✅ modelada | El PVP incluye IVA y vive en `product_location`. El cálculo de venta neta es de P5 |
| E12 | ✅ | Confidencialidad frente a `BODEGA` sobre respuesta cruda |
| E18 | ✅ | `GERENTE_LOCAL` recibe 403 al propagar |

---

## G. Pruebas

| # | Resultado | Evidencia |
|---|---|---|
| G1 | ✅ | 444 en verde |
| G2 | ✅ | 298 unitarias con la base apagada |
| G5 | ✅ | Sin sabotaje nuevo: los dos hallazgos de P4 —el error que salía como 500 y los parámetros sin validar— **los encontraron las pruebas y el límite de parámetros durante la construcción** |
| G7 | ✅ | Cero datos reales |

### Dos pruebas que valen por lo que evitan

**La del rombo de 30 niveles.** Falla si alguien quita la memorización del recorrido: sin ella serían 2³⁰ visitas y el presupuesto de 150 ms se iría por el desagüe sin que nada más lo notara.

**La del rendimiento 1 en la base AP/EP.** Está marcada explícitamente como el caso **que no valida nada**: con rendimiento 1 el costo bruto y el neto coinciden, así que pasa cualquier implementación, incluida la invertida. Sirve para que nadie la use como prueba de R4.

---

## H. Documentación

| # | Resultado |
|---|---|
| H1 | `CONSTRUCCION.md` y este documento |
| H2 | **ADR-007** — propagación por copia frente a herencia, con lo que la copia cuesta dicho sin adornos |
| H3 | Sin incidencias nuevas: los dos tropiezos se resolvieron en minutos y su prevención quedó en el código |
| H4–H7 | Modelo de datos, API, CHANGELOG y ESTADO |

---

## Veredicto

**P4 cierra, y con él la corrida P0 → P4.**

R9 y R11 están activas y probadas; R4 está modelada con los dos casos dando números distintos y conocidos, que es lo que CLAUDE.md §7 marca en rojo. La confidencialidad frente a `BODEGA` —E12— pasa de patrón instalado a **regla activa**, comprobada sobre la respuesta cruda.

**Lo que P5 hereda listo:** la cadena de costo del insumo (P3), la línea de receta con su base (P4), la receta vigente a una fecha (P4) y el costo por unidad de uso a una fecha (P3). El motor de costeo puede ser dominio puro porque todo lo que necesita ya se le puede entregar resuelto.
