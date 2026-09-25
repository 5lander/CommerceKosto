# INC-033 — `container costeo-db is unhealthy` en CI, con la base sana en local

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-25 |
| **Paquete** | P16-U |
| **Área** | despliegue · build · base de datos |
| **Tiempo perdido** | ~40 min |
| **Recurrencias** | 0 |

> **Y el hallazgo que pesa más que la causa: CI nunca había estado en verde.** En toda la historia
> del repositorio hay **dos corridas y las dos fallaron** — la de P9 el 2026-09-07 y la de este
> paquete el 2026-09-25, con el mismo mensaje. Entre una y otra se acumularon **51 commits sin
> empujar**, así que el guardián que debía avisar estaba rojo y nadie lo miró.

## Síntoma

El job muere en el primer paso que toca la base, antes de ejecutar un solo check:

```
 Container costeo-db  Waiting
 Container costeo-db  Error
dependency failed to start: container costeo-db is unhealthy
##[error]Process completed with exit code 1.
```

Y, en los logs que recoge el paso `if: failure()`, la línea que lo explica:

```
costeo-db  | /usr/local/bin/docker-entrypoint.sh: sourcing /docker-entrypoint-initdb.d/10-bootstrap.sh
costeo-db  | [initdb] creando roles costeo_migrator, costeo_app, costeo_backoffice y costeo_despachador
costeo-db  | psql: error: /usr/local/bin/sql/roles.sql: No such file or directory
```

**En local no se reproduce jamás**, y esa es la parte engañosa: `npm run audit` completo, las 555
pruebas de integración, `migrate:verify` 4/4 — todo en verde contra la misma imagen fijada por
digest y el mismo `docker-compose.yml`.

## Contexto

Abrir el PR que sube P10 → P16-T. La auditoría entera había pasado en local minutos antes.

## Causa raíz

Dos hechos que solo juntos producen el fallo.

**1. El entrypoint SOURCEA el script en vez de ejecutarlo.** La imagen de PostgreSQL recorre
`/docker-entrypoint-initdb.d` y, para cada `.sh`, decide:

```sh
*.sh)
    if [ -x "$f" ]; then  docker_process_init_file "$f"   # lo EJECUTA
    else                  source "$f"                     # lo SOURCEA
    fi
```

`docker/postgres/initdb/10-bootstrap.sh` estaba en el índice de git como **`100644`**, sin bit de
ejecución, así que caía en la rama `source`. El log lo dice con todas las letras: `sourcing`.

**2. `$0` no es el script cuando se sourcea.** El script resolvía su carpeta así:

```sh
directorio="$(dirname "$0")/sql"
```

Al sourcear, `$0` sigue siendo `/usr/local/bin/docker-entrypoint.sh`, no el archivo sourceado. Así
que `directorio` valía `/usr/local/bin/sql`, y ahí no hay ningún `roles.sql`.

**Por qué el bit se perdió y nadie lo notó:** la máquina de desarrollo es Windows y tiene
`core.fileMode=false`, así que git **no registra ni vigila** el permiso de ejecución. El archivo
nació `100644` en P0 y siguió así.

### Por qué es invisible en local y seguro en CI

`10-bootstrap.sh` se ejecuta **una sola vez: cuando el volumen de datos está vacío**. En la máquina
de desarrollo el volumen `costeo-pgdata` lleva meses creado, así que el script no ha vuelto a correr
desde antes de que los `.sql` se separaran a `sql/`. En CI el volumen es nuevo en cada corrida, y
por eso falla **siempre**.

Es la forma de fallo que este proyecto ya conoce por otro nombre: **el estado heredado del entorno
local tapa un defecto que solo se ve en limpio.** Un `docker compose up` en una máquina que ya tuvo
la base nunca prueba el arranque de la base.

## Solución

**(1) Resolver la ruta con `${BASH_SOURCE[0]}`**, que es la ruta de *este* archivo tanto si se
ejecuta como si se sourcea:

```sh
directorio="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/sql"
```

**(2) Devolver el bit de ejecución en el índice de git**, para que el entrypoint lo ejecute en su
propio proceso y el `set -euo pipefail` del script no se le pegue al entrypoint:

```
git update-index --chmod=+x docker/postgres/initdb/10-bootstrap.sh
```

Las dos, no una: la (1) arregla el fallo aunque el bit se vuelva a perder —y con
`core.fileMode=false` se puede volver a perder—; la (2) restaura el comportamiento previsto.

### Verificado donde se rompía

No basta con que la auditoría pase: eso ya pasaba. Se levantó la base **con un volumen vacío de
verdad**, en un proyecto de compose aparte para no tocar la base de desarrollo:

```
docker compose -f docker-compose.yml -f <override> -p costeo-prueba-initdb up -d db
```

```
[initdb] creando roles costeo_migrator, costeo_app, costeo_backoffice y costeo_despachador
[initdb] creando la base sombra costeo_shadow
[initdb] aplicando privilegios en costeo
[initdb] aplicando privilegios en costeo_shadow
[initdb] listo
```

`SALUD=healthy`, y los cuatro roles existen (`costeo_app`, `costeo_backoffice`,
`costeo_despachador`, `costeo_migrator`).

## Qué NO era

- **La imagen o su digest** → descartada: es la misma que corre sana en local
- **El healthcheck mal configurado** → descartada: `pg_isready` es correcto; el contenedor está de
  verdad enfermo, porque el entrypoint aborta con `ON_ERROR_STOP=1`
- **Las variables de entorno del workflow** → descartada: las cuatro contraseñas llegan, y el script
  lo confirma imprimiendo su primera línea antes de morir
- **`sin-crlf-en-archivo-posix` (INC-001)** → descartada: el archivo está en LF y la regla pasa. Es
  la misma familia —un detalle del archivo que el intérprete ve y git no— pero otro eje: allí el
  contenido, aquí el permiso

## El segundo defecto, que solo apareció cuando CI pudo avanzar

Con la base arrancando, el job llegó por fin a `npm run audit` y murió ahí:

```
audit:forbidden  FALLO — 1 infraccion(es)
  [script-de-package-json-apunta-a-nada]
     apps/api/package.json  "start": node dist/main.js  ->  no existe dist/main.js
```

**Y es la misma enfermedad que la causa principal: una comprobación que responde según el residuo
del entorno.** `apps/api/tsconfig.json` es `noEmit`, así que ningún paso de `npm run audit` genera
`dist/`. En la máquina de desarrollo el check pasaba porque había un `dist/main.js` de un
`npm run build` anterior; en CI, sobre el **mismo commit**, no había nada. Verde aquí, rojo allí.

`"start": "node dist/main.js"` es **correcto** —es lo que ejecuta el Dockerfile tras `npm run
build`—, así que el falso positivo estaba en la regla. Ahora salta los objetivos que viven en una
salida de compilación (`dist/`, `.next/`, `build/`), con el motivo escrito al lado.

**Y se comprobó que la regla sigue cazando lo suyo**, que es la mitad que se olvida: se añadió un
script apuntando a un archivo inexistente **fuera** de `dist/` y lo señaló. Desactivar una regla y
arreglarla se parecen mucho en el diff; solo se distinguen en esa prueba.

> Este arreglo viajó dentro del commit de **P16-V** por un descuido de secuencia. Pertenece a esta
> ficha, no a INC-032, y queda anotado aquí para que el registro no engañe.

## El tercer defecto, y ya no es casualidad: es un patrón

Con la auditoría avanzando, cayó la suite del back office — **7 pruebas**, empezando por un `500`
donde se esperaba un `200`:

```
FAIL  backoffice-interfaz.spec.ts > los tres recursos son públicos…
AssertionError: expected 500 to be 200

FAIL  backoffice-interfaz.spec.ts > el guion servido es el COMPILADO, no un archivo vacío
AssertionError: expected '{"code":"INTERNAL_ERROR",…' to contain 'X-Motivo'
```

`BackofficeController` sirve `dist/ui/backoffice.js`, que produce `npm run build --workspace
@costeo/api`. El propio código **falla en alto a propósito** cuando no está compilado, y su
comentario lo razona: «una pantalla en blanco porque nadie compiló la interfaz es peor que un
proceso que no arranca». La guarda funciona. Lo que fallaba era que **en local nunca se dispara**,
porque el artefacto lleva ahí desde el último build.

**Tres defectos, una sola enfermedad:**

| # | Qué pasaba | Qué lo tapaba en local |
|---|---|---|
| 1 | El cluster arrancaba sin roles | El volumen `costeo-pgdata`, creado hace meses |
| 2 | `script-de-package-json-apunta-a-nada` señalaba `dist/main.js` | Un `dist/` de un build anterior |
| 3 | La suite del back office daba 500 | El mismo `dist/`, con la interfaz compilada dentro |

**El entorno de desarrollo acumula estado que el pipeline nunca tiene**, y cada cosa que ese estado
cubre es un defecto que solo se ve en limpio. Verlo una vez es mala suerte; verlo tres en la misma
tarde es el patrón, y merece decirse en voz alta más que cualquiera de los tres arreglos.

**Arreglo:** CI compila el workspace antes de auditar, con el motivo escrito en el propio paso.

**Reproducido primero, arreglado después** — que es lo que no se había hecho ninguna de las tres
veces: se borró `apps/api/dist/` en local y las dos pruebas cayeron con el mismo `500` que en CI;
tras `npm run build`, las 22 del back office en verde.

## El cuarto, y el único que también rompe un despliegue nuevo

Con el workspace compilado, la suite del back office avanzó dos pruebas más y cayó en la tercera:
**las cinco que hacen login** daban `500` en `POST /sesion`.

La causa, comprobada sobre un clúster recién inicializado:

```
rolname             has_database_privilege(…, 'CONNECT')
costeo_app          t
costeo_backoffice   f      ← no puede ni entrar
costeo_despachador  f      ← tampoco
costeo_migrator     t
```

`grants.sql` empieza con `REVOKE ALL ON DATABASE … FROM PUBLIC` y después concede `CONNECT`
**solo a `costeo_migrator` y `costeo_app`**. `roles.sql` **crea** los otros dos y la migración de
P11 les da sus privilegios de **tabla**, pero entre una cosa y otra **nadie les daba entrada a la
base**.

**Por qué no se veía en desarrollo:** `npm run rol:backoffice` y `npm run rol:despachador` —que se
ejecutan **a mano** sobre un clúster que ya existe— sí conceden `CONNECT`. El camino manual estaba
completo; el automático, no.

> **Este es distinto de los tres anteriores y conviene separarlo: no es solo un problema de CI.**
> Cualquier clúster levantado **solo** con `docker compose up` —un despliegue nuevo, un entorno de
> un compañero— tendría el back office y el despachador de correo caídos con `500`. Los entornos
> existentes funcionan porque en su día se ejecutaron los scripts a mano, así que el fallo estaba
> esperando al **siguiente** despliegue limpio.

**Arreglo:** `grants.sql` concede `CONNECT` también a los dos, y **no sobre la base sombra** —es de
`prisma migrate diff` y solo la toca el migrator (mínimo privilegio, CLAUDE.md §4).

**Reproducido y verificado en limpio**, las dos direcciones: antes del arreglo los dos en `f`;
después, los cuatro en `t` sobre `costeo` y los dos en `f` sobre `costeo_shadow`.

## Prevención

**Convertida en check, en este mismo paquete.** Regla nueva de `audit:forbidden`:

| Regla | Qué detecta |
|---|---|
| `initdb-no-resuelve-su-ruta-con-dollar-cero` | `$0` fuera de un comentario en cualquier `docker/**/initdb/**/*.sh`. Los comentarios se permiten a propósito: el que **explica** la trampa tiene que poder nombrarla |

El contador de `audit:forbidden` pasa de **48 a 49 reglas**, que es el movimiento que INC-007 exige
cuando el alcance cambia.

La regla se verificó **viéndola fallar**: se volvió a añadir la línea original al script y el check
la señaló con su ruta y su número de línea. Un check nuevo que solo se ha visto en verde no está
verificado — es la lección entera de INC-007.

**Convertido en prueba**, en `roles-de-base-de-datos.spec.ts` — la suite de la Barrera 1, que es
donde pertenece:

| Prueba | Qué exige |
|---|---|
| `los CUATRO roles pueden conectarse a la base de la aplicación` | Los cuatro existen y ninguno tiene `CONNECT` en falso |

Y **se verificó viéndola fallar**: se revocó `CONNECT` a `costeo_backoffice` en la base de
desarrollo, la prueba se puso en rojo, y se restauró.

### La prevención del patrón, que es más valiosa que las tres del detalle

Ningún check puede vaciar el entorno local antes de cada corrida; eso es precisamente lo que hace CI
y por lo que existe. Lo que sí se puede escribir, y se escribe:

**Cuando una prueba o un check dependa de un artefacto que no está versionado** —un volumen, un
`dist/`, una base sembrada— **la comprobación en local no dice nada.** Hay que reproducir en limpio:
borrar el artefacto y verla fallar. Es lo que destapó los tres, y lo que no se había hecho ninguna
de las tres veces.

### Lo que el check NO cubre, dicho en voz alta

**Nada vigila el bit de ejecución**, porque `core.fileMode=false` hace que git no lo reporte en esta
máquina. Si se pierde otra vez, la regla (1) sostiene el arreglo, pero el script volverá a
sourcearse y su `set -euo pipefail` afectará al entrypoint.

**Y lo más importante, que ningún check arregla:** CI solo protege si alguien mira su resultado.
Cincuenta y un commits sin empujar son cincuenta y una oportunidades perdidas de enterarse. La
prevención real es **empujar por paquete**, no por pasada.
