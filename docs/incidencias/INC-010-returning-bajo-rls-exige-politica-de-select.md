# INC-010 — `new row violates row-level security policy` en un INSERT que la política SÍ permite

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-04 |
| **Paquete** | P1 |
| **Área** | base de datos |
| **Tiempo perdido** | ~30 min |
| **Recurrencias** | 1 |

## Síntoma

Insertar un evento de auditoría con el rol de la aplicación falla:

```
Invalid `tx.auditLog.create()` invocation
Database error. Code: `42501`.
Message: `new row violates row-level security policy for table "audit_log"`
```

Y la política de INSERT **permite exactamente esa fila**:

```sql
CREATE POLICY "audit_log_app_inserta_sistema" ON "audit_log"
  FOR INSERT TO costeo_app
  WITH CHECK ("company_id" IS NULL);   -- y la fila tiene company_id NULL
```

El mismo `INSERT` escrito a mano en `psql`, con el mismo rol y el mismo tenant, funciona.

## Contexto

`PrismaAuditLogRepository.record()`, escrito en P0 y **nunca ejercitado contra la base** hasta que P1 le puso una prueba de integración. Es decir: el repositorio de auditoría de P0 no funcionó nunca, y nada lo detectó, porque en P0 no existía ninguna prueba que lo llamara de verdad.

## Causa raíz

**`create()` de Prisma emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` exige que la fila pase también la política de `SELECT`.**

La de `audit_log` es, a propósito:

```sql
CREATE POLICY "audit_log_app_no_lee" ON "audit_log"
  FOR SELECT TO costeo_app USING (false);
```

SEGURIDAD.md §10: la aplicación cliente **escribe el log y no lo lee**; consultarlo es del back office. Así que la inserción entra y el `RETURNING` la rechaza.

Lo que hace difícil el diagnóstico es el mensaje: dice `new row violates row-level security policy`, que señala a la política de **INSERT** — que es justo la que sí lo permitía. El `psql` a mano funciona porque nadie escribe `RETURNING` a mano.

## Solución

`createMany` en vez de `create`:

```diff
- await tx.auditLog.create({ data: this.fila(event) });
+ await tx.auditLog.createMany({ data: [this.fila(event)] });
```

`createMany` inserta sin `RETURNING` y devuelve el número de filas. No hace falta relajar ninguna política, que es el punto: **la política es correcta y la que estaba mal era la forma de escribir.**

## Qué NO era

- **No era la política de INSERT**, aunque el mensaje la señale. Se comprobó ejecutando el mismo `INSERT` a mano: pasa.
- **No era el `WITH CHECK` del tenant.** El caso que fallaba era el de un evento de sistema, con `company_id` NULL, que ninguna política de tenant toca.
- **No se arregla dando `SELECT` a la aplicación sobre `audit_log`.** Sería relajar la confidencialidad del log para acomodar un detalle del ORM: exactamente al revés.
- **No es exclusivo de `audit_log`.** Cualquier tabla con política de SELECT restrictiva y escritura por Prisma tiene el mismo problema.

## Prevención

- [x] ¿Se puede convertir en una prueba automatizada? **Sí, y es la que lo encontró.** La lección real es más amplia: **un repositorio sin prueba de integración no está verificado**, por evidente que parezca su código. `record()` llevaba un paquete entero escrito y roto.
- [ ] ¿Se puede convertir en una verificación de `npm run audit`? No de forma fiable: `audit:forbidden` no puede saber qué política de SELECT tiene cada tabla. Lo cubre la prueba.
- [x] ¿Es una regla que debería estar en `CLAUDE.md`? Se registra aquí y en `docs/sistema/modelo-datos.md`, junto a la política. Es un detalle de PostgreSQL + ORM, no de diseño.
- [ ] ¿Es una decisión que merece un ADR? No.

### Dónde va a volver a pasar

Toda tabla cuya política de `SELECT` sea más estrecha que la de `INSERT`. Ya se ven dos:

| Paquete | Tabla | Por qué |
|---|---|---|
| **P6** | `inventory_movement` | Append-only, y `BODEGA` no puede leer el consumo teórico (CLAUDE.md §4.3) |
| **P11** | `cross_tenant_access_log` | Se escribe desde el back office y no se lee desde la app cliente |

**Regla práctica:** si una tabla tiene política de `SELECT` restrictiva, se escribe con `createMany`, no con `create`.

## Referencias

- PostgreSQL — «Row Security Policies»: las filas devueltas por `RETURNING` pasan por la política de `SELECT`. Consultado el 2026-09-04
