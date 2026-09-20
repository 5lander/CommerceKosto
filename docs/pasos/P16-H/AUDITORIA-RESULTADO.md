# P16-H — Resultado de la auditoría

**Alcance del diff:** `apps/api/prisma/` (1 migración + esquema), `apps/api/src/modules/{imports,
inventory}/`, `apps/api/src/shared/domain/identity/`, dos suites de integración, `docs/SPEC.md`,
`docs/apis/app-cliente.md`, `docs/sistema/guardas-de-dominio.md`, `docs/incidencias/INC-029`,
`docs/pasos/P16-H/`, `ESTADO.md` y `CHANGELOG`. **Ni una línea de `apps/web`.**

| Sección | Resultado | Evidencia |
|---|---|---|
| A · Arquitectura | ✅ | `imports` decide y delega; **no escribe ni una fila del libro**, igual que al importar. El caso de uso que escribe vive en `inventory`, que es quien tiene las reglas del libro. `audit:arch` sin violaciones |
| B · Código | ✅ | `audit:types`, `audit:lint`, `audit:complexity` y `audit:duplication` (`Found 0 clones`) en verde. El `id` de la importación deja de ser `string`: `ImportJobId`, porque ahora viaja al libro y llega por una ruta (CLAUDE.md §3). `exigirLibroEscribibleEnCada` **quita** una duplicación en vez de añadirla: el lote y la anulación comparten la guarda por mes y ubicación |
| C · Seguridad | ✅ | `import.write` —el mismo que escribir—, que `BODEGA` no tiene: 🔴 con **403 y `code`**. Una importación de otra company da **404**, no 403: no se distingue de una inventada (CLAUDE.md §4.4). La respuesta no lleva saldo ni cantidades, solo un recuento de filas (§4.3) |
| D · Base de datos | ✅ | `audit:migrations` **22/22** · `migrate:verify` 4/4 · índice **parcial** `(company_id, import_job_id) WHERE import_job_id IS NOT NULL`: la inmensa mayoría del libro tiene `NULL` ahí · FK `ON DELETE RESTRICT` · la semilla del catálogo **no se borra** en el down (M10/INC-011) y su CHECK se queda con ella |
| E · Reglas de negocio | ✅ | **R3**: se deshace escribiendo, en UNA transacción; ninguna fila se borra ni se edita. **Mes cerrado**: la fila contraria conserva la fecha del original, así que la misma guarda que para una corrección suelta lo detiene con 409 |
| F · Rendimiento | ✅ | La lectura de lo que trajo la importación es UNA consulta por el índice nuevo; los ítems, UNA lectura del catálogo para todo el lote. La guarda del período se pide una vez por **mes y ubicación distintos**, no una por fila |
| G · Pruebas | ✅ | 7 casos nuevos de integración (el 🔴 del criterio de aceptación entre ellos) + 1 en `inventario.spec.ts` por INC-029 |
| H · Documentación | ✅ | SPEC §10.1 con la regla —y dicho que §24 la hereda—, `docs/apis/app-cliente.md` con la ruta y sus códigos, sección nueva en `guardas-de-dominio.md` (M11), INC-029 y `CONSTRUCCION.md` |
| I · Duplicación / YAGNI | ✅ | Ni listado de importaciones, ni endpoint de subida, ni pantalla: la superficie nueva es **una ruta** |

### Lo que la auditoría destapó, y no estaba en el plan

**INC-029.** La prueba del criterio de aceptación preguntó por el dinero además de por el saldo, y
salió que una compra corregida **se contaba dos veces** en `compras_del_mes` desde P6 — la cifra que
entra en el food cost real (R7). Arreglado en las tres agregaciones de dinero, con dos 🔴 nuevas y
la cabecera de `correccion.ts` corregida: lo que se cancela solo es la cantidad, no el importe.

**Un `soloActivos` al revés.** La anulación pedía solo los ítems activos para resolver sus unidades:
una importación cuyo insumo se hubiera archivado después no se habría podido deshacer. Se vio
leyendo la firma, no fallando.

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 578 archivos
✔ no dependency violations found (395 modules, 1779 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 22 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
      Tests  19 passed | 540 skipped (559)     (cabeceras de seguridad)
      Tests  905 passed (905)                  (unitarias)
      Tests  554 passed | 5 skipped (559)      (integracion)
ℹ tests 49                                     (apps/web, node --test)
```

**`npm run audit` — exit 0.** `migrate:verify` 4/4 aparte, con la 20.ª migración.
