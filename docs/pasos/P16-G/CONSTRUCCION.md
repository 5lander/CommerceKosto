# P16-G — Restaurar un solo cliente, y el respaldo que no cabía en memoria

> **Decisión del usuario D-16.195**: «`respaldos-y-restauracion.md` gana el procedimiento de
> restauración POR TENANT (dump → base auxiliar → filas de una company → reinserción con RLS),
> documentado y probado sobre ensayo-b antes de la parada del piloto. La restauración completa queda
> para pérdida total».

## 1 · Por qué hacía falta

`npm run restaurar` deja el respaldo entero en una base auxiliar, y eso sirve para la pérdida total.
Pero **el caso probable no es ese**: es un cliente que borró lo suyo, o una importación que se comió
su catálogo. Restaurar la base completa para arreglarle el día a uno devolvería a **todos los demás**
al estado de ayer — un incidente mayor que el que se está arreglando.

## 2 · Lo que se construyó

| Archivo | Qué |
|---|---|
| `scripts/restaurar-tenant.mjs` | `npm run restaurar:tenant -- --company=<uuid>`: copia las filas de UNA company desde la auxiliar a producción, compara los recuentos tabla por tabla y avisa de los ajustes de costeo |
| `scripts/lib/tenant.mjs` | Las 22 tablas del tenant **en orden de claves foráneas**, lo que no vuelve y por qué, y el SQL que pregunta al catálogo qué tablas hay (el guardián) |
| `scripts/lib/pgdump.mjs` | `volcarTablaDelTenant`: `pg_dump --data-only --enable-row-security --column-inserts` con el tenant fijado por `PGOPTIONS` |
| `scripts/lib/psql.mjs`, `pgdump.mjs` | las invocaciones aceptan entorno extra (nativo y por `docker compose exec`) |
| `docs/runbooks/respaldos-y-restauracion.md` | la sección nueva, con lo que exige, lo que no devuelve y el límite del libro append-only |

### La idea que lo hace seguro

**No hay ni un `WHERE company_id` escrito a mano.** Las dos conexiones entran con el rol de la
aplicación y `app.company_id` fijado, así que **RLS recorta el volcado y vuelve a comprobar cada fila
al insertarla**: las filas salen y entran por la misma barrera que las protege. Un filtro escrito a
mano sería una segunda definición de «qué es de quién», y la única que vale es la de la base.

## 3 · Lo que enseñó la base al intentarlo

| Lo que dijo PostgreSQL | Qué se aprendió |
|---|---|
| `COPY FROM not supported with row-level security. Use INSERT statements instead.` | Reinsertar **con la barrera puesta** obliga a `INSERT`. Es el precio de lo que D-16.195 pedía, y por eso el volcado usa `--column-inserts` |
| `permission denied for table company_settings` | Los ajustes de costeo **no son de la aplicación**: los crea el trigger al nacer la company y ella solo puede actualizarlos. No se reinsertan: se **comparan** y, si difieren, se imprimen para reponerlos desde Ajustes. Un `iva_compra_recuperable` restaurado en silencio cambiaría el costo de cada plato |
| El libro no se deja borrar (R3) | Un tenant con movimientos **no se puede vaciar** para rehacerlo. Queda dicho en el runbook como el límite del procedimiento |

## 4 · El respaldo que no cabía en memoria (INC-028)

El simulacro empieza por hacer un respaldo, y **`npm run respaldo` falló con el `stderr` vacío**. No
era del tenant: `volcar()` recogía el volcado en memoria con `maxBuffer: 512 MiB`, y `spawnSync` mata
al hijo **sin mensaje** cuando la salida no cabe. La base de desarrollo pesa 10 GB y su volcado 722
MiB, así que el respaldo llevaba roto desde que la base creció — justo el fallo que aparece el día en
que el respaldo importa.

Ahora el volcado va **del proceso al archivo por un descriptor** y `pg_restore` lee igual: sin tope
que ajustar. El archivo se borra si la verificación no cuadra, para conservar la promesa del runbook.

## 5 · El simulacro, sobre `ensayo-b`

```
1. npm run respaldo            722 MiB · 707 entradas · restaurado y comparado
                               29.118.367 movimientos · 271.062 ítems, cuadran
2. npm run restaurar           costeo_restaurado, la copia completa
3. pérdida simulada            se borran las filas de negocio de ensayo-b en costeo
4. npm run restaurar:tenant    18 filas suyas en 11 tablas, recuentos cuadrados
                               ATENCION: ajustes de costeo, en la copia y no en destino → los imprime
5. comprobación                ensayo-b: 2 ítems, 1 producto, 1 línea · ensayo: 7, 4, 15 — INTACTO
6. en el navegador             duena@ensayo-b entra, ve sus dos sucursales y «Arroz marinero» a 9.90
                               con su receta (Arroz 0.3 kg AP → 3.60) y su costo recalculado
```

El guardián de «destino vacío» también se probó sin querer: una corrida anterior dejó tres tablas
escritas, y la siguiente **se paró y las listó** en vez de duplicarlas.

## 6 · Decisiones

D-16.195 en `ESTADO.md`; **INC-028**.
