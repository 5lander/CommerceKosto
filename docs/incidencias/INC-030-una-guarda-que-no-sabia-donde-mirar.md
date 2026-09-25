# INC-030 — Tres guardas que dejaban de encontrar la tabla que vigilan

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-20 |
| **Paquete** | P16-G2 (lo destapó el simulacro de D-16.198) |
| **Área** | base de datos · seguridad |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | 0 |

> **`relation "physical_count" does not exist`** — sobre una base donde `physical_count` existe, con
> datos, y donde la consulta de al lado la acababa de leer.

## Síntoma

Durante la restauración de un solo tenant (D-16.198):

```
psql:<stdin>:649: ERROR:  relation "physical_count" does not exist
LINE 1: SELECT c."status" FROM "physical_count" c WHERE c."id" = conteo
CONTEXT: PL/pgSQL function public.rechazar_linea_de_conteo_confirmado() line 8
```

## Causa raíz

La función no fijaba su `search_path`, así que resolvía el nombre con **el del llamante**. Y quien
la llamaba era una fila de un volcado de `pg_dump --data-only`, que abre así:

```sql
SELECT pg_catalog.set_config('search_path', '', false);
```

Los `INSERT` del propio volcado llevan el esquema delante (`INSERT INTO public.physical_count_line`)
y no lo notan. El trigger que salta al insertarlos, no.

Tres funciones del proyecto estaban igual, las tres guardas que leen **otra** tabla:

| Función | Lee |
|---|---|
| `rechazar_linea_de_conteo_confirmado` | `physical_count` |
| `rechazar_edicion_de_conteo_confirmado` | `physical_count` |
| `rechazar_movimiento_en_periodo_cerrado` | `period` |

Las otras nueve —`auth_lookup`, `session_lookup`, `invitation_lookup`, `password_reset_*`,
`rechazar_mutacion`…— sí lo fijaban. No era un criterio: eran tres omisiones.

## Por qué no es solo robustez

**Una guarda que resuelve el nombre de su tabla con el `search_path` de quien escribe mira donde le
digan.** Un esquema por delante con una `physical_count` vacía la desactiva sin tocarla. Hoy
`costeo_app` no puede crear esquemas, así que no había agujero abierto — pero la defensa no se apoya
en eso, se apoya en que la función sepa dónde mira. En una `SECURITY DEFINER` —las cinco de este
proyecto lo son— esto deja de ser una rareza y es el vector clásico de escalada.

## Solución

`20260920002554_p16g2_search_path_de_las_guardas`: un `ALTER FUNCTION … SET search_path =
pg_catalog, public` por cada una. El cuerpo no cambia ni una línea.

## Prevención

- [x] **`audit:migrations` M12**: una migración que crea una función y no le fija el `search_path`
  —ni ahí ni en ninguna migración posterior— falla el build. Se comprobó que el check no es
  decorativo: quitando la migración del arreglo, vuelve a saltar.
- [x] El simulacro de restauración por tenant corre con la base real y es quien lo encontró.

## Referencias

- `apps/api/prisma/migrations/20260920002554_p16g2_search_path_de_las_guardas/`
- `tools/audit/migrations.mjs` → `comprobarSearchPathDeFunciones`
- `docs/runbooks/respaldos-y-restauracion.md` · D-16.198
