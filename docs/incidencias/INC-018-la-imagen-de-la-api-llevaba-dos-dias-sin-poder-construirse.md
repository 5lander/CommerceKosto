# INC-018 — La imagen de la API llevaba dos días sin poder construirse, y el despliegue salía «sano»

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-08 |
| **Paquete** | P14b (ensayo de despliegue) |
| **Área** | despliegue · build |
| **Tiempo perdido** | ~40 min, y todo en no creerme lo que veía |
| **Recurrencias** | 0 |

> **Lo grave no es que el build fallara: es que el despliegue no lo dijera.** El
> contenedor anterior siguió corriendo, su comprobación de salud siguió en verde
> y la API contestó a todo. Solo que con el código del 6 de septiembre.

## Síntoma

Ninguno visible. Todo estaba «bien»:

```
$ docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api
 Container costeo-api  Started
$ docker inspect -f '{{.State.Health.Status}}' costeo-api
healthy
```

El síntoma real apareció por la puerta de atrás: un endpoint devolvía **menos
campos de los que su DTO declara**. `GET /analitica/menu-engineering` no traía
`mcTotal`, `unidadesConMargen` ni `metodoMcPromedio`, y por eso el panel de
«margen de referencia» de la pantalla de menú —que ADR-015 existe para dar— no
se pintaba nunca.

## El diagnóstico, que fue por eliminación

1. ¿Falta el mapeo? **No.** `presentacion.ts` mapea los tres campos.
2. ¿Está en el `dist` del host? **Sí**, con fecha de hoy.
3. ¿Está en el `dist` **de dentro del contenedor**? **No**, y el archivo estaba
   fechado **dos días antes**:

```
$ docker exec costeo-api ls -l apps/api/dist/.../presentacion.js
-rw-r--r-- 1 root root 8928 Sep  6 23:43 ...
```

4. ¿Y la imagen?

```
imagen del contenedor:  sha256:8c3e7d4f...
imagen costeo-saas-api: sha256:8c3e7d4f...   ← la misma
creada la imagen:       2026-09-06T23:44:23Z ← de hace dos días
```

Ni `--build` ni `--force-recreate` la movían.

## La causa

El build **falla**, y compose se lo traga. Con `--progress=plain` aparece:

```
#17 [build 12/13] RUN npm run build --workspace @costeo/api
#17 11.63 src/modules/imports/infrastructure/limites.ts(13,36):
          error TS2307: Cannot find module '../../../../parser/lector.mjs'
#17 ERROR: process "/bin/sh -c npm run build ..." did not complete successfully
```

**P10 creó `apps/api/parser/` y el `Dockerfile` nunca lo copió.** Son tres
archivos `.mjs`/`.d.mts` que viven fuera de `src/` a propósito (ADR-013): Node
exige extensión explícita para ejecutar TypeScript como ESM, así que el hijo que
se forkea tiene que ser `.mjs` de verdad. El Dockerfile copia `apps/api/src` y
nada más.

En la máquina de desarrollo el archivo está, así que `audit:types` pasa. Dentro
de la imagen no está, así que el `tsc` muere. **La imagen no se podía construir
desde P10, y no se notó porque entre P10 y P14 nadie la construyó.**

## Por qué el fallo se esconde, que es la parte que hay que recordar

`docker compose up -d --build` **no aborta el despliegue cuando el build falla**
si ya existe una imagen previa con ese nombre: deja el contenedor anterior en
pie. Y ese contenedor:

- responde a todo,
- pasa su `healthcheck`,
- aparece como `healthy` en `docker compose ps`,
- y sirve el código de la última vez que el build funcionó.

**Un despliegue que falla y parece haber funcionado es peor que uno que se cae.**

## El arreglo

Dos líneas en `apps/api/Dockerfile`, una por etapa:

```dockerfile
# etapa de construccion — sin esto el `tsc` no encuentra el tipo
COPY apps/api/parser apps/api/parser
# etapa de ejecucion — sin esto `leer-en-hijo.ts` no encuentra a quien forkear
COPY --from=build /app/apps/api/parser apps/api/parser
```

La segunda es igual de necesaria y falla más tarde: `rutaDelHijo()` sube desde
`__dirname` hasta la carpeta con `package.json` y busca `parser/hijo.mjs`. Sin
ella, la imagen arranca bien y **la importación de un archivo revienta en
caliente**, delante de quien esté cargando el catálogo.

## Prevención

**Automatizada, en el mismo paquete.** Regla nueva de `audit:forbidden`:

> `dockerfile-no-copia-lo-que-el-codigo-importa`

Resuelve cada import relativo de `apps/*/src/**/*.{ts,tsx}`, se queda con los
que **salen de `src/`**, y exige que el `Dockerfile` de esa app copie la carpeta
resultante. Con la línea del parser quitada:

```
audit:forbidden  FALLO — 2 infraccion(es)
  [dockerfile-no-copia-lo-que-el-codigo-importa]
     apps/api/src/modules/imports/infrastructure/limites.ts:13
       import type { LimitesDelZip } from '../../../../parser/lector.mjs';
```

**Y la regla enmascara los comentarios del Dockerfile antes de mirar.** Sin eso
no cazaba nada: el propio Dockerfile explica por qué copia el parser y al
hacerlo escribe la ruta, así que el comentario hacía pasar la regla aunque el
`COPY` de debajo no estuviera. Se descubrió al forzar el guardián — INC-007
aplicado a la regla nueva, que también hay que comprobar que mide algo.

**Y en el runbook**, porque una regla no sustituye a mirar: el despliegue
construye con `docker compose build` **como paso propio**, comprueba su código
de salida, y solo entonces levanta. `docs/runbooks/despliegue.md` y
`docs/runbooks/puesta-en-marcha.md`.

## La lección

**Un artefacto que nadie construye no está roto: está sin comprobar, que es
distinto y peor.** Entre P10 y P14 la auditoría pasó doce veces en verde sobre
un repositorio cuya imagen de producción no compilaba. `audit:types` compila con
el árbol del host, y el host tiene archivos que la imagen no.
