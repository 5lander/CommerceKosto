# INC-007 — Un check de `npm run audit` pasa en verde sin haber mirado ni un archivo

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | build |
| **Tiempo perdido** | ~2 h repartidas en seis apariciones |
| **Recurrencias** | 6 |

> **Es una sola ficha para seis problemas porque lo que se repite es el MODO DE FALLO, no la causa.** Las causas no se parecen entre sí: un parser ausente, un `exclude` demasiado ancho, un glob que no cubría una carpeta, unos patrones de ignorar mal anclados, una clave de configuración que la herramienta ignora, y un intercept que solo cubría dos de las tres formas de llamar a una función. Lo que sí es idéntico las seis veces es la forma de manifestarse —el check dice que todo está bien— y la única forma de detectarlo: provocarle un fallo a propósito y comprobar que se entera.
>
> **Cuatro de las seis se descubrieron precisamente al hacer la prueba del guardián de P0.** Sin ese paso habrían llegado enteras a P5, con el motor de costeo ya escrito encima.

## Síntoma

**No hay mensaje de error. Ese es el síntoma.**

El check imprime su línea de éxito y devuelve código 0. La suite entera está en verde. Nadie sospecha nada, porque un check que falla se ve y un check que no mide, no.

```
audit:complexity    (sin salida)
audit:arch          ✔ no dependency violations found
audit:forbidden     audit:forbidden  OK — 22 reglas sobre 135 archivos
audit:secrets       (sin salida)
audit:duplication   time: 0.474ms
audit:tests         ✓ unit (1 test) — y la prueba abría una conexión a PostgreSQL
```

Dos líneas merecen leerse dos veces.

La tercera **decía la verdad y engañaba igual**: el repositorio sí tenía 135 archivos, pero ninguna regla de contenido miraba 85 de ellos. Solo examinaba 50. La cifra grande tranquilizaba.

La quinta es la más descarada: **`time: 0.474ms`**. Analizar cinco mil líneas de TypeScript no se hace en medio milisegundo. El propio informe traía la prueba de que no había analizado nada, y aun así se leyó como un verde durante todo el paquete.

## Contexto

Fase de construcción del tooling de P0, y después cada vez que se amplió su alcance:

1. Al escribir `eslint.complexity.config.mjs` (paso 5 del orden de P0).
2. Al añadir la autocomprobación de `tools/audit/arch.mjs`.
3. Al escribir el primer doble de prueba en `apps/api/test/` (paso 16).
4. Al compilar por primera vez con `npm run build`, que crea `apps/api/dist/` (paso 16).
5. Al forzar el fallo de `audit:duplication` en la prueba del guardián.
6. Al forzar el fallo de `audit:tests` en la prueba del guardián.

## Causa raíz

Cuatro causas distintas, un mismo efecto: **el conjunto de archivos que el check llegaba a examinar estaba vacío, o no contenía el archivo que importaba.**

| # | Check | Causa concreta | Efecto |
|---|---|---|---|
| 1 | `audit:complexity` | La configuración no declaraba `parser: tseslint.parser`. Sin parser de TypeScript, ningún `.ts` entra al análisis | Cero archivos analizados |
| 2 | `audit:arch` | El fixture de la autocomprobación vivía en `.tmp/`, que la propia configuración de `dependency-cruiser` excluye | La autocomprobación se comprobaba a sí misma… sin analizar el fixture |
| 3 | `audit:forbidden` | El glob de código era `apps/*/src/**/*.ts`. `apps/*/test/**` quedaba fuera | Un `as any` o un `SELECT *` en una prueba de integración no lo veía nadie |
| 4 | `audit:secrets` | Los patrones de `.secretlintignore` estaban anclados a la raíz: `dist/**` no casa con `apps/api/dist/` | Escaneaba el compilado y reportaba dos veces cada hallazgo del fuente; el ruido enseña a ignorar la salida |
| 5 | `audit:duplication` | La clave `path` de `.jscpd.json` **jscpd la ignora**: las rutas solo se toman como argumentos posicionales del CLI | Cero archivos analizados |
| 6 | `audit:tests`, guardián «sin base» | Interceptaba `Socket.prototype.connect`, pero solo entendía las formas `(puerto, host)` y `({ port })`. `net.connect()` normaliza sus argumentos a un **array** y lo pasa tal cual | La forma más común de abrir una conexión —y la que usa `pg`— pasaba sin ser vista |

Los casos 1, 2 y 5 producían **cero cobertura** y son los peores. Los casos 3, 4 y 6 producían **cobertura parcial**, que cuesta más de ver porque el check sí encuentra cosas de vez en cuando y parece vivo.

**El caso 5 tuvo consecuencia material, no solo teórica.** En cuanto jscpd empezó a analizar de verdad apareció duplicación real: la API de comparación (`compare`, `equals`, `lessThan`…) repetida en `Money`, `Ratio`, `Count` y `Quantity`. Cuatro repeticiones, cuando `OPTIMIZACION.md` §1 fija el umbral de extracción en la tercera. Se resolvió con la clase base `ValorDecimal` y las 128 pruebas del módulo pasaron sin tocarse. Un check que no mide no es solo una casilla falsa: es deuda que se acumula sin que nadie la vea.

## Solución

Cada causa tiene su arreglo, y ninguno de los cuatro se parece:

```diff
  // 1 — eslint.complexity.config.mjs
+ languageOptions: { parser: tseslint.parser },

  // 2 — tools/audit/arch.mjs
- const FIXTURE = '.tmp/arch-selftest';
+ const FIXTURE = '.arch-selftest';   // fuera de toda ruta excluida

  // 3 — tools/audit/rules/core.rules.mjs
- const CODIGO = ['apps/*/src/**/*.ts', 'tools/**/*.mjs', 'scripts/**/*.mjs'];
+ const CODIGO = ['apps/*/src/**/*.ts', 'apps/*/test/**/*.ts', 'tools/**/*.mjs', 'scripts/**/*.mjs'];

  // 4 — .secretlintignore
- dist/**
+ **/dist/**
+ **/generated/**

  // 5 — package.json: las rutas van como argumentos, no en .jscpd.json
- "audit:duplication": "jscpd"
+ "audit:duplication": "jscpd apps tools scripts"

  // 6 — apps/api/test/soporte/guardia-sin-base.ts
+ if (Array.isArray(primerArgumento)) return puertoDestino(primerArgumento[0]);
```

Y un quinto arreglo que no es de ningún check en particular sino del informe: `audit:forbidden` ahora cuenta **los archivos que examina de verdad alguna regla de contenido**, no los del repositorio. La cifra pasó de 135 a 50. Es más pequeña y es la cierta.

## Qué NO era

- **No era que el código estuviera limpio.** Fue la primera lectura las cuatro veces, y es la lectura que hace que esto sobreviva meses: un check en verde sobre código recién escrito es indistinguible de un check roto.
- **No se detecta leyendo la configuración.** Las cuatro configuraciones eran plausibles a la vista; tres de ellas las había escrito y releído la misma sesión.
- **No se detecta con cobertura de pruebas ni con revisión de código.** Lo único que lo detecta es ejecutar el check contra una violación que sabes que existe.
- **El caso 4 no era un falso positivo de secretlint.** El hallazgo era real y estaba bien: lo que estaba mal era escanear un artefacto de build y duplicar el reporte.
- **El caso 5 no era que el umbral del 3 % fuera generoso.** El umbral nunca llegó a evaluarse porque no había nada que evaluar. De paso se descubrió que con `exitCode: 1` jscpd falla ante **cualquier** clon y no al superar el umbral: la política efectiva es cero clones, más estricta que la escrita.
- **El caso 6 no era que el guardián estuviera desactivado.** El parche estaba puesto —`net.Socket.prototype.connect.name` devolvía `interceptar`— e interceptaba de verdad. Solo que la llamada que interceptaba es la que casi nadie escribe.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **No en el sentido habitual, y por eso existe la prueba del guardián.** Ningún check puede verificarse a sí mismo: por cada uno de los once se introduce a mano una violación deliberada, se captura la **salida de fallo literal**, se revierte, y esa salida vive en `docs/pasos/P0/evidencia/` y en `docs/pasos/P0/AUDITORIA-RESULTADO.md`. **Sin las once salidas capturadas, P0 no cierra** — es criterio de commit, no un extra.
- [x] ¿Se puede convertir en una prueba automatizada? **Parcialmente, y ya está:** `audit:arch` incorpora su propia autocomprobación (crea el fixture, verifica que la configuración lo detecta, lo borra). Es el único de los once que puede hacerlo sin intervención, porque su violación es un archivo y no un estado del repositorio.
- [x] ¿Es una regla que debería estar en `CLAUDE.md`? Ya lo está en la práctica: §13 exige que `npm run audit` **falle** ante cada punto de la tabla. Esta ficha es la razón por la que esa palabra está en negrita.
- [ ] ¿Es una decisión que merece un ADR? No: no es una decisión, es un modo de fallo.

### La regla que se lleva esta ficha

> **Cada vez que cambia el ALCANCE de un check —un workspace nuevo, una carpeta nueva, una regla nueva, un patrón de ignorar nuevo— hay que volver a forzar el fallo de los checks afectados y volver a capturar la salida.**
>
> Ampliar el alcance sin repetir el guardián deja la parte nueva sin cubrir y el check sigue en verde: es exactamente la situación de los casos 3 y 4, que aparecieron meses después de que el check se diera por bueno.

Momentos ya identificados en los que esto toca hacerse:

| Cuándo | Qué cambia el alcance | Qué hay que volver a forzar |
|---|---|---|
| **P1** | Regla nueva de `audit:forbidden`: cliente de BD fuera de la capa de tenant | `audit:forbidden` |
| **P6** | `inventory_movement` entra en la lista de tablas append-only; migraciones nuevas | `audit:forbidden`, `audit:migrations` |
| **P12** | Workspace `apps/web`: globs, `tsconfig`, reglas de capa y de complejidad nuevas | **Los once**, sobre el workspace nuevo |
| Cualquiera | Se añade una carpeta que no casa con los globs existentes | Los checks cuyo glob se amplió |
| Cualquiera | Se sube una herramienta de auditoría a un major nuevo | Los checks que la usan: las claves de configuración cambian de nombre y de semántica sin avisar (caso 5) |

## Referencias

- `docs/pasos/P0/evidencia/` — las salidas de fallo capturadas de cada check
- `docs/PROTOCOLO.md` — fase de AUDITORÍA
- CLAUDE.md §13 — la tabla de los checks y la palabra «falla»
