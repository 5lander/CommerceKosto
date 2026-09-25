# P16-U — La base arranca en limpio, y CI se pone en verde por primera vez

> **Este paquete no añade funcionalidad. Repara el guardián.** Sale de abrir el PR que sube
> P10 → P16-T y descubrir, en el primer paso del job, que la base no llega a sana — y, mirando el
> historial de corridas, que **CI nunca había estado en verde en este repositorio**.

## 1 · El hallazgo, antes que el arreglo

`gh run list` devuelve **dos corridas en toda la historia del repositorio, y las dos fallaron**:

| Corrida | Fecha | Rama | Resultado |
|---|---|---|---|
| `34146417141` | 2026-09-07 | `main` (push de P9) | ❌ `failure` |
| `36174848960` | 2026-09-25 | el PR de esta entrega | ❌ `failure` |

Las dos, con el mismo mensaje. Entre una y otra se acumularon **51 commits sin empujar**.

Esto importa más que la causa técnica. `CLAUDE.md` §13 dice que `npm run audit` «corre en CI y en
pre-commit», y la fila I8 de `AUDITORIA.md` ya declaraba en voz alta el riesgo de una disciplina sin
guardián. Aquí el guardián existía, **corrió, falló, y nadie leyó el resultado** — porque el
resultado solo aparece cuando se empuja, y no se empujó en dieciocho días.

La prevención no es un check: es **empujar por paquete**, no por pasada.

## 2 · La causa, en dos hechos que solo juntos rompen

Está entera en [INC-033](../../incidencias/INC-033-la-base-arranca-sin-roles-y-ci-nunca-estuvo-en-verde.md).
En corto:

1. **El entrypoint de PostgreSQL sourcea los `.sh` que no tienen bit de ejecución** en vez de
   ejecutarlos. `10-bootstrap.sh` estaba como `100644` en el índice de git
2. **Al sourcear, `$0` es el del entrypoint**, no el del script. `dirname "$0"` daba
   `/usr/local/bin`, y `psql` moría con `/usr/local/bin/sql/roles.sql: No such file or directory`

El cluster arranca **sin los cuatro roles**, el healthcheck lo marca enfermo, y el job muere antes
de ejecutar un solo check.

### Por qué era invisible

`10-bootstrap.sh` corre **una sola vez: con el volumen de datos vacío**. En la máquina de desarrollo
`costeo-pgdata` lleva meses creado, así que el script no se ejecutaba desde antes de que los `.sql`
se separaran a `sql/`. En CI el volumen es nuevo **siempre**.

Por eso la auditoría local completa —`npm run audit`, 918 unitarias, 555 de integración,
`migrate:verify` 4/4— pasaba en verde sobre un defecto que rompe el arranque de la base. **No medía
el arranque: heredaba uno viejo.**

## 3 · Lo que se cambió

**`docker/postgres/initdb/10-bootstrap.sh`** — la ruta se resuelve con `${BASH_SOURCE[0]}`, que es
la de *este* archivo tanto si se ejecuta como si se sourcea, con el comentario que explica la
trampa para que nadie lo «simplifique» de vuelta:

```sh
directorio="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sql"
```

**El bit de ejecución, devuelto en el índice** (`git update-index --chmod=+x`): `100644` → `100755`.

**Las dos, no una.** La primera sostiene el arreglo aunque el bit se vuelva a perder —y con
`core.fileMode=false` se puede volver a perder sin que git avise—; la segunda restaura el
comportamiento previsto, que es que el script corra en su propio proceso y su `set -euo pipefail` no
se le pegue al entrypoint.

## 4 · La incidencia, convertida en check

`CLAUDE.md` §8.4: una incidencia automatizable se convierte **en el mismo paquete**. Regla nueva en
`tools/audit/rules/repo.rules.mjs`:

| Regla | Qué detecta |
|---|---|
| `initdb-no-resuelve-su-ruta-con-dollar-cero` | `$0` fuera de un comentario en cualquier `docker/**/initdb/**/*.sh` |

Los comentarios se permiten a propósito: **el comentario que explica la trampa tiene que poder
nombrarla.**

`audit:forbidden` pasa de **48 a 49 reglas**. Ese contador tenía que moverse — es lo que INC-007
caso 9 exige cuando cambia el alcance.

### La regla se verificó viéndola FALLAR

Un check nuevo que solo se ha visto en verde no está verificado; es la lección entera de INC-007. Se
volvió a añadir la línea original al script:

```
audit:forbidden  FALLO — 1 infraccion(es)
  [initdb-no-resuelve-su-ruta-con-dollar-cero]
     docker/postgres/initdb/10-bootstrap.sh:53  directorio="$(dirname "$0")/sql"
```

La señaló con ruta y línea. Después se restauró el archivo bueno y volvió a `OK — 49 reglas`.

## 5 · Verificado donde se rompía, no donde ya funcionaba

La auditoría ya pasaba **antes** del arreglo, así que pasar la auditoría no prueba nada aquí. Se
levantó la base con un **volumen vacío de verdad**, en un proyecto de compose aparte con su propio
volumen y su propio `container_name`, para no tocar la base de desarrollo:

```
[initdb] creando roles costeo_migrator, costeo_app, costeo_backoffice y costeo_despachador
[initdb] creando la base sombra costeo_shadow
[initdb] aplicando privilegios en costeo
[initdb] aplicando privilegios en costeo_shadow
[initdb] listo
```

`SALUD=healthy`, y los cuatro roles presentes en `pg_roles`. La base de prueba y su volumen se
destruyeron después; la de desarrollo siguió en pie.

## 6 · Lo que este paquete NO arregla

**Nada vigila el bit de ejecución.** Con `core.fileMode=false` git no lo reporta en esta máquina, así
que un check no tendría de dónde leerlo de forma fiable. Si se pierde otra vez, el arreglo (1)
sostiene el arranque, pero el script volverá a sourcearse.

**Y lo que ningún check arregla:** CI solo protege si alguien mira su resultado.
