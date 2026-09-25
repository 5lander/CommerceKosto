# INC-014 — Pruebas de integración que fallan con 500 en sitios distintos cada vez, y ninguna toca lo que se cambió

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-04 |
| **Paquete** | P8 |
| **Área** | base de datos · build |
| **Tiempo perdido** | ~20 min |
| **Recurrencias** | **1** |

> **El síntoma no apunta a la causa, y por eso cuesta.** Las pruebas que fallan no son las del código que se acaba de tocar, y no son las mismas dos veces seguidas. Es fácil perder media hora buscando el error en el diff.

## Síntoma

`npm run audit` falla en `audit:tests` con un puñado de pruebas de integración en rojo. Todas dicen lo mismo:

```
AssertionError: expected 500 to be 200
```

Y tres cosas que juntas son la firma de esta incidencia:

1. **Las suites que fallan cambian en cada corrida.** Una vez `analitica` y `pgbouncer`; la siguiente, `costeo` y `rendimiento-de-costeo`. Entre 1 y 6 pruebas.
2. **Fallan suites que el cambio no toca.** Un cambio solo de documentación las hace fallar igual.
3. **En el log, `"responseTime": 2017`** — o 2012, o 2028. **Siempre justo por encima de 2000 ms**, que es el timeout del interceptor de P0.

## Contexto

Al commitear una verificación de P8 que **no tocaba una sola línea de código**: solo `ESTADO.md`, dos ADR y un script de herramientas. El hook de pre-commit rechazó el commit.

## Causa raíz

**Las pruebas de integración siembran y no limpian, y la base de desarrollo es la misma en cada corrida.**

Las tres suites de rendimiento —`rendimiento-de-costeo`, `rendimiento-de-inventario` y `rendimiento-de-conteo`— crean cada una cientos de miles de filas para tener volumen realista, que es lo que INC-007 (caso 8) exige. Pero crean una company **nueva** cada vez, así que el volumen se acumula corrida tras corrida.

Medido cuando saltó:

```
companies  items   movimientos  tamaño
      594  31 112    9 373 351  3087 MB
```

Con ese volumen, las peticiones que cargan un catálogo entero —`/costeo`, y con él las vistas de P8— se acercan a los 2 s, y **cuál de ellas cruza el umbral depende de cómo se repartan los workers de Vitest esa vez**. De ahí la aleatoriedad.

**El 500 es correcto**: es el timeout haciendo su trabajo. Lo que está mal es el entorno, no el código.

## Por qué no se puede limpiar por company

Es lo primero que se intenta, y **no funciona ni con el rol dueño de las tablas**:

```
ERROR: La tabla inventory_movement es append-only: DELETE rechazado.
       Un error se corrige con una fila nueva, nunca editando el historial.
```

**Eso no es un obstáculo que sortear: es R3 funcionando.** El libro de inventario y `audit_log` son append-only en tres capas, y la del trigger es `FOR EACH STATEMENT`, así que alcanza también al dueño (P6, y la razón está en `modelo-datos.md`).

Desactivar el trigger para limpiar abriría exactamente la puerta que P6 cerró. **La consecuencia es que la única limpieza posible es tirar el esquema entero**, y conviene tenerlo escrito porque volverá a pensarse.

## Una corrección importante sobre la causa

**Parte de lo escrito arriba resultó ser un diagnóstico incompleto, y se deja visible en vez de reescribirse en silencio.** Cuando por fin se pudo vaciar la base, apareció que el `ETIMEDOUT` y buena parte de los fallos aleatorios venían de otro sitio: **el puerto 5432 del host estaba llegando a pgbouncer**, cuyo pool es de tamaño 1. Eso es **INC-015**.

Lo que sí sigue siendo cierto de esta ficha: las suites siembran y no limpian, la base crece sin techo, y con 3 GB el timeout de 2 s empieza a tumbar peticiones. Lo que hay que corregir es el reflejo: **antes de culpar al tamaño, comprueba por dónde entran las conexiones** (INC-015 lo explica en un minuto).

## Solución

```bash
npm run db:reset -- --si
```

Vacía el esquema `public` y reaplica las nueve migraciones. Exige `--si`, se niega con `NODE_ENV=production` y se niega si la conexión no apunta a localhost: un script que vacía una base no puede ejecutarse por autocompletado.

**Efecto colateral útil:** cada reset vuelve a ejercitar la ida completa de las migraciones sobre una base vacía.

### Por qué VACÍA el esquema en vez de tirarlo — dos trampas, las dos comprobadas

La primera versión del script hacía `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`, que es lo obvio y está mal por **dos** razones independientes:

| | Qué pasa | Por qué |
|---|---|---|
| 1 | `ERROR: permission denied for database costeo` | `costeo_migrator` es dueño del **esquema**, no de la base. No tiene `CREATE` sobre ella, así que puede tirar `public` y **no volver a crearlo**. Es P0 haciendo su trabajo |
| 2 | La peor, y no dio ningún error | **`pg_stat_statements` y `pg_trgm` viven en `public`.** El `DROP` se los lleva, y el primero lo crea `initdb` **como superusuario**: el migrator no puede recrearlo. La base se habría quedado sin la observabilidad que CLAUDE.md §5 exige, sin forma de recuperarla salvo borrando el volumen |

La segunda no llegó a ocurrir solo porque la primera abortó la transacción entera (`--single-transaction`). **El fallo ruidoso tapó al silencioso**, que es exactamente para lo que P0 puso ese flag.

El script borra ahora las **tablas** y las **rutinas** propias, saltando todo lo que pertenece a una extensión (`pg_depend.deptype = 'e'`). Los índices, las secuencias, los triggers y las políticas se van con su tabla, y `_prisma_migrations` cae en el mismo barrido, que es lo que hace que `migrate deploy` reaplique las nueve desde cero. Conservar el esquema tiene otra ventaja: los `DEFAULT PRIVILEGES` de `grants.sql` cuelgan de él y **sobreviven**, así que no hay que restaurarlos ni existe el riesgo de restaurarlos desviados.

## Lo que el primer reset destapó: dos pruebas que dependían del residuo

Con la base limpia por primera vez desde P0, dos pruebas de rendimiento fallaron. Ninguna era un fallo nuevo: **las dos llevaban pasando gracias a datos de corridas anteriores.**

**Los tests de plan exigían el índice y sobre una base limpia salía `Seq Scan`.** Y `Seq Scan` era **la elección correcta**: si las 200 recetas de la única company son todas las recetas de la tabla, el filtro por company no descarta nada. La prueba pasaba porque en la base compartida había cientos de companies de corridas viejas haciendo de ruido **por accidente**. Es INC-007 caso 8 otra vez, y las suites de inventario y de conteo ya lo tenían resuelto a propósito con `UBICACIONES_DE_RUIDO`; la de costeo no.

**Corregido en el mismo paquete:** `rendimiento-de-costeo.spec.ts` siembra ahora `COMPANIES_DE_RUIDO = 9` companies con carta propia —sin líneas de receta, que son la parte cara— para que la company medida no sea la tabla entera. La siembra se reestructuró en `crearCompany` + `sembrarCarta` para no duplicar los `INSERT`, y `jscpd` da 0 clones.

**La regla que queda:** una prueba de plan necesita que su propia siembra haga selectivo el filtro. Si depende de que en la base haya datos de otro, no está midiendo nada — solo todavía no se sabe.

## Prevención

**Lo que se automatizó:** el script existe, está en `package.json` y tiene sus tres guardas. Antes había que improvisarlo.

**Lo que NO se automatizó, y por qué se dice en vez de fingir que sí:**

- **Limpiar en `afterAll`** es imposible sin desactivar los triggers append-only. Descartado por lo dicho arriba.
- **Resetear antes de cada `test:integration`** haría que cada corrida reaplicara nueve migraciones —unos segundos— y, peor, escondería este problema en vez de resolverlo: las suites seguirían sin limpiar y nadie volvería a mirarlo.
- **Bajar el volumen de las pruebas de rendimiento** es exactamente lo que INC-007 caso 8 prohíbe: sin volumen realista, la prueba del plan no mide nada.

**La regla operativa, que es lo que queda:** si `npm run audit` falla en pruebas de integración que **no** tocan lo que cambiaste, y el log dice `responseTime` de poco más de 2000, **mira el tamaño de la base antes que el diff**:

```sql
SELECT count(*) FROM company;
SELECT pg_size_pretty(pg_database_size('costeo'));
```

Por encima de unas 200 companies o 1 GB, resetea.

## Lo que esta incidencia destapó de paso

**`npm run db:psql` apuntaba a `scripts/psql-shell.mjs`, que no existe.** Llevaba así desde P0 y ningún check lo veía: `knip` analiza imports de TypeScript, no las rutas que los scripts de `package.json` invocan. La entrada se sustituyó por `db:reset`.

Es una laguna pequeña pero real —**un script del `package.json` puede apuntar a un archivo inexistente y nada avisa**— y merece una regla de `audit:forbidden` el día que haya un segundo caso. Con uno solo, escribirla es la abstracción especulativa que `OPTIMIZACION.md` §1 prohíbe.

---

## Recurrencia 1 (P16-I, 2026-09-20) — y lo que la hace peor de lo que dice esta ficha

La base de desarrollo llegó a **12 GB y 34,4 millones de movimientos**, y el síntoma ya no fue el
timeout de Prisma: fue **una prueba de integración que expira a los 60 s unas veces sí y otras no**.
`la corrección CONSERVA el tipo, para que Σ(COMPRA) del mes se cancele sola` tumbó `npm run audit`
en una corrida y pasó en la siguiente, sin tocar nada.

**La causa no es solo el tamaño: es que esas consultas de prueba no pueden usar ningún índice.**
Estaban escritas como `WHERE item_id = $1 AND type = COMPRA`, sin `company_id`, y **todos** los
índices del libro empiezan por el tenant (CLAUDE.md §5). Resultado:

```
Parallel Seq Scan on inventory_movement
  Filter: ((item_id = …) AND (type = COMPRA))
```

Un barrido de 34 millones de filas por cada aserción, cuyo tiempo depende de qué haya en caché y de
qué más esté corriendo. De ahí la inestabilidad: no es aleatoria, es un barrido compitiendo con el
resto de la máquina.

**Arreglo:** las siete consultas crudas de `inventario.spec.ts` llevan `company_id` por delante. El
plan pasa a `Index Scan` y la suite bajó de expirar a **43 s de pruebas**.

**La lección, que esta ficha no tenía:** una prueba que lee la base a pelo **también** está sujeta a
la regla de índices del proyecto. Saltársela no da un resultado incorrecto —el número sale bien—,
da una prueba que se degrada con el tamaño de la base hasta volverse inestable, y la inestabilidad
se lee como «cosas del entorno» en vez de como lo que es.
