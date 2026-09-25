# INC-017 — `npm run dev` nunca funcionó, y nadie lo notó en diez paquetes

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-07 |
| **Paquete** | P10 |
| **Área** | build · despliegue |
| **Tiempo perdido** | ~25 min (encontrarlo fue gratis; entender por qué, no) |
| **Recurrencias** | **2** (P16-A1, 2026-09-10: `npm run bench`; P16-C, 2026-09-12: el comando del ensayo local del runbook) |

> **Lo interesante no es el fallo: es que sobreviviera diez paquetes.** Un comando del `package.json` que no arranca es fácil de arreglar. Que nadie se diera cuenta en P0…P9 dice algo del sistema de comprobaciones, y eso es lo que esta ficha viene a cerrar.

## Síntoma

```
$ npm run dev
Warning: Failed to load the ES module: apps/api/src/main.ts.
         Make sure to set "type": "module" in the nearest package.json file
SyntaxError: Cannot use import statement outside a module
```

No arranca. No es que falle a mitad: **no llega a cargar el primer módulo.**

## Por qué nadie lo vio

Las tres formas de ejecutar este proyecto son:

| Cómo | Qué usa | ¿Pasa por `dev`? |
|---|---|---|
| Pruebas | Vitest, que transpila con SWC | No |
| Docker | `node dist/main.js`, ya compilado | No |
| `npm run dev` | El fuente directamente | **Sí, y es el único** |

Y **ningún check lo cubría.** `knip` analiza imports de TypeScript, no las rutas ni los comandos que los scripts del manifiesto invocan.

## Causa raíz

`apps/api` es `"type": "commonjs"` y sus imports **no llevan extensión**. Para ejecutar TypeScript, Node lo trata como ESM, y **ESM exige extensión explícita** en los especificadores relativos. Comprobado con un caso mínimo:

```
import { saluda } from './a';      →  ERR_MODULE_NOT_FOUND
import { saluda } from './a.ts';   →  funciona
```

Así que no falta una bandera: es una incompatibilidad entre cómo está escrito el paquete y lo que Node exige para ejecutar TS. Arreglarlo de raíz sería pasar `apps/api` entero a ESM con extensiones — cambio de otro paquete, y NestJS 12 lo traerá (ADR-001).

## Solución

`scripts/dev.mjs`: `tsc --build --watch` deja `dist/` al día y `node --watch-path=dist dist/main.js` reinicia cuando cambia. Es lo mismo que hace producción, en vigilancia. **Sin dependencias nuevas** — nada de `concurrently` ni `nodemon`, en la misma línea que P0 con husky, dotenv y cross-env.

Un detalle que la primera prueba destapó: `node --watch` a secas vigila **todo lo que se requiere**, `node_modules` incluido, y la aplicación se reiniciaba cuatro veces por compilación. `--watch-path=dist` lo acota.

## El mismo problema tuvo consecuencias en P10

`fork('hijo.ts')` falla por **exactamente** la misma razón, y por eso el parser de importaciones acabó en `parser/lector.mjs`, JavaScript plano fuera de `src/`. Está contado en ADR-013.

## Prevención — automatizada, y es la parte que importa

**INC-014 lo dejó pedido con estas palabras:** «merece una regla de `audit:forbidden` el día que haya un segundo caso. Con uno solo, escribirla es la abstracción especulativa que `OPTIMIZACION.md` §1 prohíbe.»

Este es el segundo caso. La regla existe:

```
[script-de-package-json-apunta-a-nada]
  package.json  "roto": node scripts/no-existe.mjs  ->  no existe scripts/no-existe.mjs
```

**Comprobada rompiendo a propósito**, no supuesta: se añadió un script apuntando a un archivo inexistente, el check falló con el mensaje de arriba, y volvió a verde al quitarlo.

**Lo que la regla NO cubre, dicho para que nadie la crea más lista de lo que es:** solo mira `node <ruta>`. Un `prisma migrate deploy` o un `eslint .` los resuelve npm por su cuenta, y comprobarlos exigiría reimplementar esa resolución. Cubre el caso que ha fallado dos veces —una ruta escrita a mano en el manifiesto— y nada más.

**Y lo que sigue sin cubrir nadie:** que el comando *arranque*. La regla comprueba que el archivo existe, no que funcione. `dev` habría pasado esta regla durante los diez paquetes, porque `src/main.ts` sí existía. Lo que lo habría cazado es alguien ejecutándolo — y eso, hoy por hoy, no lo hace ningún check.

---

## Recurrencia 1 — `npm run bench`, roto desde P11 · 2026-09-10 (P16-A1)

**Y pasó exactamente por donde esta ficha dijo que pasaría.**

```
$ npm run bench
· Sembrando el volumen sintetico (tarda; son ~220.000 movimientos)
psql:<stdin>:43: ERROR:  column "max_locations" of relation "company" does not exist
LINE 1: INSERT INTO company (id, name, status, max_locations)
```

**Causa raíz:** P11 borró `company.max_locations` y puso el límite en la tabla
`plan` («dos sitios donde vive el mismo límite son dos sitios que un día dejan de
coincidir», D5). `scripts/lib/volumen.sql` —que P15 había escrito dos días
antes— se quedó insertándola. El commit de P11 no la tocó porque **nada la
enlaza**: no es TypeScript (knip no lo ve), no es una migración (M1–M11 no lo
ven), y el `script-de-package-json-apunta-a-nada` de esta misma ficha solo
comprueba que `scripts/bench.mjs` exista, que existía.

**Cuánto sobrevivió:** dos paquetes (P11 y P14/P14b). `npm run bench` está fuera
de `npm run audit` a propósito —tarda dos minutos, AUDITORIA.md I8— y **eso es
justo lo que lo dejó pudrirse**: la fila I8 de la auditoría avisaba de este
riesgo con estas palabras, «un medidor fuera del pre-commit puede decaer sin que
nadie se entere», y se cumplió por la vía más tonta.

**Arreglo:** `INSERT INTO company (id, name, status, plan_code) … 'PROFESIONAL'`.
El plan se eligió por el volumen que el propio archivo siembra: 10 ubicaciones,
500 ítems y 200 productos **no caben en `BASICO`** (300 productos), y medir sobre
una company cuyo plan no admite su propio volumen sería medir un caso que la
aplicación habría rechazado.

**Lo que esta recurrencia añade, y no es una regla nueva:** el SQL suelto que
acompaña a un script —`volumen.sql`, `grants.sql`, `roles.sql`— es código que
ninguna herramienta del proyecto verifica. Cuando una migración borre una
columna, `grep` por su nombre en `scripts/` y `docker/` es más barato que
descubrirlo dos paquetes después. **La prevención sigue siendo la misma que dice
arriba: ejecutarlo.** Por eso el bench pasa a ser obligatorio en el paquete que
toque el camino de lectura, que es lo que I8 ya pedía y P16-A1 fue el primero en
cumplir.

---

## Recurrencia 2 — el ensayo local del runbook, roto desde P16-A1 · 2026-09-12 (P16-C)

**Esta vez no era un script del `package.json` sino el comando que un runbook pide copiar**, y el
síntoma es el mismo: algo que nadie ejecutaba ya no arrancaba.

```
$ DOMINIO=localhost CORREO_TLS=tu@correo.ec \
    docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
error while interpolating services.api.environment.APP_URL: required variable APP_URL is missing a value: falta APP_URL
```

**Causa raíz:** P16-A1 añadió al compose de producción tres variables obligatorias —`APP_URL` para
los enlaces del correo, `PROXY_DE_CONFIANZA` para la IP tras Caddy (INC-022) y `MAIL_ADAPTER` para el
despachador— y el paso 0 de `docs/runbooks/puesta-en-marcha.md` se quedó con las dos de P14b. El commit
tocó el compose, `preparar.sh` y los dos runbooks —`puesta-en-marcha.md` incluido, 93 líneas—, pero
no el paso 0: se añadieron el paso 3b (el remitente en Resend) y el 6b (el envío real), y nada enlaza el
comando del ensayo con el compose.

**Cómo se vio:** P16-C necesitaba la pila de producción para probar `DELETE /usuarios/roles` a través de
Caddy, y se copió el comando del runbook. Es exactamente el paso que existe «porque encontró tres fallos»
(INC-018, INC-019, INC-020), y llevaba dos paquetes sin poder ejecutarse.

### La prevención, automatizada

Regla **`ensayo-local-con-las-variables-obligatorias`** de `audit:forbidden` (`repo.rules.mjs`): lee las
`${VAR:?…}` de `docker-compose.prod.yml` y exige que el «Paso 0» del runbook ponga cada una como
`VAR=`. Si cambia cualquiera de los dos archivos, compara los dos.

**Guardián:** la regla se escribió **antes** de arreglar el runbook, y su primera corrida fue el rojo:

```
audit:forbidden  FALLO — 3 infraccion(es)
  [ensayo-local-con-las-variables-obligatorias]
     docs/runbooks/puesta-en-marcha.md  el ensayo local no pone APP_URL, y docker-compose.prod.yml la exige
     docs/runbooks/puesta-en-marcha.md  el ensayo local no pone PROXY_DE_CONFIANZA, y docker-compose.prod.yml la exige
     docs/runbooks/puesta-en-marcha.md  el ensayo local no pone MAIL_ADAPTER, y docker-compose.prod.yml la exige
```

Con las tres en el comando: `OK — 47 reglas`.

**Lo que sigue sin cubrir, igual que en la recurrencia 1:** que el comando **funcione**. La regla
comprueba que las variables estén; no que la imagen construya ni que la pila arranque. Eso solo lo sabe
quien lo ejecuta, y por eso el paso 0 no se salta.
