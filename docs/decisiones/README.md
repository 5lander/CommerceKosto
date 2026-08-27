# ADRs — Registros de decisión de arquitectura

Numerados e **inmutables**. Una decisión que cambia no se edita: se escribe un ADR nuevo que supersede al anterior y se marca el viejo como reemplazado.

Plantilla en `docs/plantillas/ADR.md`.

## Índice

| # | Decisión | Estado | Paquete |
|---|---|---|---|
| — | *(el primero es el de versiones del stack, en P0)* | — | P0 |

## ADRs esperados por el plan

- **ADR-001** — Versiones del stack y fechas de fin de soporte (P0, **obligatorio para cerrar el paquete**). Debe registrar las seis verificaciones de `CLAUDE.md` §1, con la fecha en que se consultó cada fuente
- **ADR-002** — Elección de ORM: Prisma frente a Drizzle para RLS multi-tenant (P1, decisión D12). Debe registrar las condiciones que sostienen la elección y qué la revertiría
- **ADR-003** — Estrategia de aislamiento: las tres barreras, roles de base de datos y comportamiento bajo PgBouncer (P1)
- **ADR-004** — Propagación de recetas por copia frente a herencia (P4)
- **ADR-005** — Libro de inventario append-only frente a saldo mutable (P6)
- **ADR-006** — Costo estándar frente a costo de último lote para preparaciones (P6)
