# P16-D — Resultado de auditoría

**Paquete:** P16-D — el costeo marca «sin receta» · **Fecha:** 2026-09-14

**Alcance del diff:** `costing` (dominio, caso de uso, DTO, presentación y sus pruebas),
`test/integracion/costeo.spec.ts`, la pantalla de costeo y su texto, SPEC §14,
`docs/apis/app-cliente.md`, `FUNCIONAMIENTO.md`, `ESTADO.md`, `CHANGELOG` y estos dos documentos.

### A. Arquitectura

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| A1–A6 | Capas | ✅ | `sinRecetaActiva` vive en `domain` y no importa nada nuevo; `audit:arch` en verde |
| A7 | Motor probable sin base | ✅ | `costeo-de-producto.spec.ts` corre en `unit` |

### B. Código

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| B1–B3 | Tipos, lint, prohibidos | ✅ | `audit:types`, `audit:lint`, `audit:forbidden` |
| B4–B6 | Complejidad | ✅ | `audit:complexity`; la fila de costeo se partió en `Fila` + `CeldasDeCosto` para no pasar de 40 líneas |

### C. Seguridad

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| C-§4.3 | BODEGA | ✅ sin cambio | `GET /costeo` sigue siendo 403 para `BODEGA` (prueba existente sobre respuesta cruda). `sinReceta` dice si hay receta, no qué lleva, y no sale a quien no lee el costeo |

### D. Base de datos

**— No aplica.** Sin migraciones ni consultas nuevas: la marca se calcula sobre lo que `LeerCarta` ya trae.

### E. Reglas de negocio

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| R4, R6, R7 | Ningún número cambia | ✅ | Casos conocidos CC-001…CC-009 en verde sin tocar; la conciliación R7 de integración, en verde. La marca no entra en ninguna fórmula |

### F. Frontend

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| F2 | Estados | ✅ | «Sin receta» es un estado de la fila con su qué hacer (dos frases, D11) |
| F-captura | Verificado | ✅ | Dueña en bodega y gerente en local, 1280 y 360 px, sin desbordes |

### G. Pruebas

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| G1 | En verde | ✅ | Salida abajo |
| G2 | Guardianes | ✅ | Cinco mutaciones, cinco rojos, restauradas con el diff idéntico (`CONSTRUCCION.md`) |

### H. Documentación

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| H1 | CONSTRUCCION | ✅ | |
| H2 | API | ✅ | `app-cliente.md`, `GET /costeo`: `sinReceta` y el `SIN_DATO` |
| H3 | FUNCIONAMIENTO | ✅ | «Cómo se alimenta el motor» |
| H6 | ADR | — no aplica | Decisión de producto del usuario (duda #12), registrada en SPEC §14 y en `ESTADO.md` (D-16.146); no hay alternativa técnica que evaluar más allá de las cuatro de `CONSTRUCCION.md` |
| H8 | CHANGELOG | ✅ | |

### I. Optimización

| # | Punto | Resultado | Evidencia |
|---|---|---|---|
| I8 | Bench | — no aplica | Un `some` sobre las líneas que el motor ya recorre; ninguna consulta |
| I9 | Bundle | ✅ | `medir-bundle` abajo |

### Salida de `npm run audit`

```
audit:forbidden  OK — 47 reglas sobre 505 archivos
✔ no dependency violations found (391 modules, 1754 dependencies cruised)
audit:arch  OK — reglas de capa respetadas y guardian verificado
Found 0 clones.
audit:migrations  OK — 18 migracion(es) reversibles y con RLS
audit:deps  OK — sin vulnerabilidades altas fuera de las 4 aceptadas y documentadas
 Test Files  2 passed | 31 skipped (33)
      Tests  19 passed | 527 skipped (546)
 Test Files  67 passed (67)
      Tests  894 passed (894)
 Test Files  33 passed (33)
      Tests  541 passed | 5 skipped (546)
audit:tests  OK — unitarias (sin base) e integracion en verde
audit exit=0
```

**894 unitarias (+3) y 541 de integración (+5)** frente al armazón. El contador de `audit:forbidden` pasa de
504 a **505**: el +1 es `costing/domain/costeo-de-producto.spec.ts`. `audit:arch`, de 390 a 391 módulos
por el mismo archivo.

`medir-bundle`: piso **126,9 KiB**, mayor `/inventario` **142,6 KiB**; `/costeo` 141,5 (antes 141,4).
