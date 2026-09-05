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
| [ADR-009](ADR-009-el-signo-el-costo-y-el-interruptor-de-stock.md) | El signo del movimiento, el importe del lote y la confidencialidad del saldo frente a `BODEGA` | ✅ aceptado | P6 |
| [ADR-010](ADR-010-el-mes-el-corte-y-lo-que-no-se-conto.md) | De quién es el período, dónde vive la frontera del mes, y qué significa exactamente no haber contado un ítem | ✅ aceptado | P7 |
| [ADR-011](ADR-011-el-consumo-teorico-y-lo-que-R7-destapo.md) | El consumo teórico, el rendimiento por lote, y el fallo de P6 que la conciliación R7 sacó a la luz | ✅ aceptado | P8 |

## ADRs esperados por el plan

> La numeración es por **orden de creación**, no por tema. P0 consumió del 001 al 005 —dos de ellos, el del ORM y el de la aritmética, eran decisiones que había que tomar para escribir la primera línea de código—, así que lo que sigue se renumeró respecto de la previsión inicial.

> **Los dos ADR que el plan preveía para P6 salieron como uno solo, y merece explicarse.**
>
> El primero iba a ser «libro append-only frente a saldo mutable». Al escribirlo quedó claro que **no es una decisión**: R3 lo manda, CLAUDE.md §5 lo repite, y no hay alternativa que evaluar. Lo que sí había que decidir eran cosas que ninguno de los dos documentos nombra —si la cantidad lleva signo, si se guarda el total o el unitario, de qué tipo es una corrección— y esas son las que ADR-009 registra.
>
> El segundo iba a ser «costo real frente a costo estándar». Es la **decisión 4** de ADR-009, y se escribió ahí porque no se entiende sola: solo tiene sentido junto a la precedencia contraria que ADR-008 fijó para el motor de costeo, y separarlas habría dejado dos documentos que se contradicen en apariencia.

- *(ninguno pendiente hasta P7)*
