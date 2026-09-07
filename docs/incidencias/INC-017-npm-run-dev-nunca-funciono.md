# INC-017 — `npm run dev` nunca funcionó, y nadie lo notó en diez paquetes

| Campo | Valor |
|---|---|
| **Fecha** | 2026-09-07 |
| **Paquete** | P10 |
| **Área** | build · despliegue |
| **Tiempo perdido** | ~25 min (encontrarlo fue gratis; entender por qué, no) |
| **Recurrencias** | 0 |

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
