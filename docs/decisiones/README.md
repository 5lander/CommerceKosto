# ADRs — Registros de decisión de arquitectura

Numerados e **inmutables**. Una decisión que cambia no se edita: se escribe un ADR nuevo que supersede al anterior y se marca el viejo como reemplazado.

Plantilla en `docs/plantillas/ADR.md`.

## Índice

| # | Decisión | Estado | Paquete |
|---|---|---|---|
| [ADR-001](ADR-001-versiones-del-stack.md) | Versiones del stack y fechas de fin de soporte (cierra D2) | ✅ aceptado | P0 |
| [ADR-002](ADR-002-orm-prisma-frente-a-drizzle.md) | ORM: Prisma 7.10.0 frente a Drizzle para RLS multi-tenant (cierra D12) | ✅ aceptado | P0 |
| [ADR-003](ADR-003-aritmetica-decimal-con-decimal-js.md) | Aritmética decimal con `decimal.js` y su excepción a la regla de capa | ✅ aceptado | P0 |
| [ADR-004](ADR-004-migraciones-reversibles.md) | Migraciones reversibles con `down.sql` verificado en bases reales | ✅ aceptado | P0 |
| [ADR-005](ADR-005-hooks-con-core-hookspath.md) | Hooks de git con `core.hooksPath` en vez de husky | ✅ aceptado | P0 |
| [ADR-006](ADR-006-las-tres-barreras-del-aislamiento.md) | Las tres barreras del aislamiento multi-tenant, las cuatro condiciones de D12 y las decisiones de sesión | ✅ aceptado | P1 |
| [ADR-007](ADR-007-propagacion-de-recetas-por-copia.md) | Propagación de recetas por copia, no por herencia | ✅ aceptado | P4 |
| [ADR-008](ADR-008-las-tres-decisiones-que-el-spec-no-escribe.md) | Las tres decisiones de costeo que el SPEC no escribe: el empaque, la precedencia de la cascada y el combo | ✅ aceptado | P5 |

## ADRs esperados por el plan

> La numeración es por **orden de creación**, no por tema. P0 consumió del 001 al 005 —dos de ellos, el del ORM y el de la aritmética, eran decisiones que había que tomar para escribir la primera línea de código—, así que lo que sigue se renumeró respecto de la previsión inicial.

- **ADR-009** — Libro de inventario append-only frente a saldo mutable (P6)
- **ADR-010** — Costo real de lote frente a costo estándar: dónde vive la varianza de producción (P6). Ojo: **la mitad de esta decisión ya está tomada en ADR-008** —la cascada es costo estándar y R10 sigue entera—; lo que queda es qué hacer con la diferencia contra el lote real
