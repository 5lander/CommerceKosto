# ADR-004: Migraciones reversibles con `down.sql` verificado en bases reales

| Campo | Valor |
|---|---|
| Estado | ✅ aceptado |
| Fecha | 2026-08-27 |
| Paquete | P0 |
| Decisores | Usuario / Claude Code |

## Contexto

`CLAUDE.md` §5 exige «migraciones versionadas y reversibles por CI», y `AUDITORIA.md` D1 lo comprueba en cada paquete. **Prisma Migrate no genera migraciones de bajada.** Su postura oficial es que se revierte restaurando un respaldo.

Eso no sirve aquí, por una razón concreta: el libro de inventario es *append-only*, así que restaurar un respaldo para deshacer un cambio de esquema **destruye movimientos reales** registrados entre el respaldo y el fallo. La reversión tiene que ser del esquema, no de los datos.

## Opciones consideradas

| Opción | A favor | En contra |
|---|---|---|
| Sin `down`, restaurar respaldo | Es la vía oficial de Prisma | Pierde los datos escritos después del respaldo |
| `down.sql` escrito a mano | Control total | Nadie garantiza que deshaga lo que el `up` hizo, y se descubre el día que hace falta |
| **`down.sql` generado con `migrate diff` y verificado contra bases reales** | Reproducible, y la verificación no depende de que alguien lo lea | Hay que mantener el mecanismo |

## Decisión

**Cada migración lleva su `down.sql`, generado con `prisma migrate diff` ANTES de crear la de subida, y `npm run migrate:verify` demuestra que revierte.**

### El mecanismo

- `npm run migrate:new` calcula el `down.sql` con `migrate diff` apuntando **del esquema nuevo al estado de `prisma/migrations`** — no al estado de la base local, que varía entre máquinas.
- **Para la primera migración se usa `--to-empty` y no `--to-migrations`**: sin `migration_lock.toml` todavía, `--to-migrations` falla (INC-004).
- Se aplica con `psql --single-transaction -v ON_ERROR_STOP=1`. Como `psql` no está en el PATH en Windows, el script cae a `docker compose exec -T db psql` (INC-002).
- Las políticas RLS y el resto del SQL manual van en bloques `-- MANUAL: BEGIN/END` al final del `up`, y `-- MANUAL-REVERSE: BEGIN/END` al principio del `down`. `audit:migrations` verifica la simetría.

### El `down.sql` borra su propia fila de `_prisma_migrations`

Se aparta de la receta oficial a propósito: `prisma migrate resolve --rolled-back` **solo acepta migraciones fallidas**, y aquí se revierten migraciones que tuvieron éxito. Efecto colateral bueno: el `down.sql` queda autocontenido y atómico. `audit:migrations` M9 lo exige.

### La escalera de `migrate:verify`

Cuatro pasos, sobre bases reales creadas y destruidas dentro de la propia corrida:

| # | Qué compara | Qué demuestra |
|---|---|---|
| 1 | Aplica todas las migraciones | Que el `up` funciona partiendo de cero |
| 2 | Base limpia **vs.** base tras revertirlo todo | Que el `down` deshace de verdad, y no «casi» |
| 3 | Ida **vs.** `up → down → up` | Que revertir y volver a aplicar no deja residuo |
| 4 | `migrate diff --exit-code` contra `schema.prisma` | Que no hay deriva entre el esquema y las migraciones |

La comparación es sobre `pg_dump --schema-only`, que **sí** incluye `ENABLE`/`FORCE ROW LEVEL SECURITY`, `CREATE POLICY`, triggers y GRANTs. Se complementa con aserciones de catálogo (`pg_class.relrowsecurity`, ACLs, `numeric(24,12)`) que no dependen del formato del volcado.

Dos detalles de implementación que costaron tiempo y conviene no redescubrir:

- **`pg_dump` 18 emite una línea `\restrict` con un nonce aleatorio** en cada ejecución. Se normaliza antes de comparar; si no, dos volcados del mismo esquema nunca coinciden.
- **`grants.sql` necesita superusuario** para `CREATE EXTENSION`, así que `migrate-verify` lo aplica como `postgres`, igual que hace `initdb` en el contenedor.

## Consecuencias

- Se gana: revertir un despliegue fallido sin tocar los datos, y una verificación que no depende de que nadie lea el `down.sql`.
- Se sacrifica: `migrate:verify` crea y destruye bases, así que tarda. **Por eso no está dentro de `npm run audit`**: corre en CI, donde es barato, y a mano antes de un despliegue. Meterlo en el pre-commit lo volvería insoportable, y un check insoportable acaba desactivado.
- **Qué lo revertiría:** que Prisma genere migraciones de bajada de forma oficial. Entonces `migrate-new.mjs` sobra — pero la escalera de verificación se queda, porque comprueba algo distinto de lo que genera.
