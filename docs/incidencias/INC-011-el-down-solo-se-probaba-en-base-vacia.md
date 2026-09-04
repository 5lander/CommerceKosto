# INC-011 — El `down.sql` funcionaba en `migrate:verify` y fallaba en la base real

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-04 |
| **Paquete** | P1 |
| **Área** | base de datos |
| **Tiempo perdido** | ~45 min |
| **Recurrencias** | 1 |

## Síntoma

`npm run migrate:verify` en verde, con sus cuatro pasos:

```
[migrate:verify] 2/4  escalera: ida y vuelta entera
  OK  el down deshace exactamente lo que hizo el up
```

Y sobre la base de desarrollo, el mismo `down.sql`:

```
psql:<stdin>:84: ERROR:  update or delete on table "audit_event_type" violates
RESTRICT setting of foreign key constraint "audit_log_event_type_fkey" on table "audit_log"
DETAIL:  Key is referenced from table "audit_log".
```

## Contexto

El `down.sql` de P1 borraba los quince tipos de evento que la migración había sembrado en `audit_event_type` — una tabla de P0 que **sobrevive** al down de P1. La simetría parecía impecable: lo que el up inserta, el down borra.

## Causa raíz

Dos causas encadenadas, y la segunda es la que importa.

**1. `migrate:verify` trabaja sobre bases LIMPIAS.** Sus cuatro pasos crean bases vacías, aplican la escalera y comparan volcados de esquema. En una base vacía **ninguna fila referencia nada**, así que un `DELETE` sobre un catálogo referenciado siempre pasa. La comprobación era correcta y estaba midiendo el caso que nunca falla.

En la base de desarrollo había eventos de login registrados —de las pruebas de integración— apuntando a esos tipos. La clave foránea de `audit_log` es `ON DELETE RESTRICT` **a propósito**: borrar el tipo de un evento ya escrito dejaría la fila de auditoría sin significado.

**2. La guarda `NOT EXISTS` tampoco servía, y por una razón que vale para todo el proyecto.** El segundo intento fue borrar solo lo que nadie usa:

```sql
DELETE FROM "audit_event_type"
WHERE "code" IN (...)
  AND NOT EXISTS (SELECT 1 FROM "audit_log" WHERE "event_type" = "audit_event_type"."code");
```

Falló **igual**. `costeo_migrator` no tiene política de `SELECT` sobre `audit_log` —solo de `INSERT`—, y con `FORCE ROW LEVEL SECURITY` la subconsulta ve **cero filas siempre**. El `NOT EXISTS` era cierto siempre. La clave foránea, que la evalúa el motor y **no pasa por RLS**, sí veía las filas.

> **Una guarda `NOT EXISTS` vale lo que valga el acceso de lectura del rol que la ejecuta. Bajo RLS, «no hay filas» y «no puedo verlas» son la misma respuesta.**

## Solución

**El `down` ya no borra esas filas.** Un catálogo que sostiene evidencia de auditoría es tan append-only como la evidencia: quedan quince filas de datos de referencia sin usar, que no molestan a nadie, y el rastro intacto.

El up cierra el círculo con `ON CONFLICT ("code") DO NOTHING`, para que `up → down → up` funcione **con datos dentro** y no solo en vacío.

## Qué NO era

- **No era un fallo de `migrate:verify`.** Sus cuatro pasos hacen lo que dicen; lo que faltaba era un quinto caso que ninguno cubre.
- **No se arregla dando `SELECT` al migrator sobre `audit_log`.** SEGURIDAD.md §10 reserva la lectura del log al back office, y ampliar el acceso para que funcione una migración de vuelta es el atajo que este proyecto no toma.
- **No es específico de `audit_event_type`.** Cualquier catálogo sembrado por una migración y referenciado por datos que esa migración no controla tiene el mismo problema.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **Sí, y se hizo: `audit:migrations` M10.** Un `down.sql` no puede borrar filas de una tabla que no elimina en el mismo archivo. Si el down suelta la tabla, sus filas se van con ella; si no la suelta, pueden estar referenciadas.
- [x] ¿Se comprobó que M10 mide algo? **Sí, y no medía nada al principio**: el patrón se escribió con un carácter de retroceso en lugar de la secuencia `\b`. Se detectó con la prueba del guardián y cuenta como recurrencia de **INC-007**.
- [ ] ¿Es una regla que debería estar en `CLAUDE.md`? No: es un detalle de migraciones. Vive en M10 y en el propio `down.sql`, con el porqué al lado.
- [ ] ¿Es una decisión que merece un ADR? No. ADR-004 ya cubre el mecanismo de migraciones reversibles; esto es una restricción sobre cómo escribirlas.

### Dónde va a volver a pasar

Todo paquete que siembre filas en un catálogo de un paquete anterior:

| Paquete | Catálogo | Riesgo |
|---|---|---|
| **P2** | `unit`, `unit_conversion` | Los referenciarán `item` y `purchase_article` |
| **P6** | `movement_type` | Lo referenciará `inventory_movement`, que es append-only |
| **P8** | `audit_event_type` | Otra tanda de eventos, mismo caso exacto |

## Referencias

- PostgreSQL — «Row Security Policies»: las comprobaciones de integridad referencial se ejecutan **con privilegios elevados** y no están sujetas a RLS. Consultado el 2026-09-04
- `tools/audit/migrations.mjs` — comprobación M10
- `apps/api/prisma/migrations/20260904023411_p1_iam/down.sql`
