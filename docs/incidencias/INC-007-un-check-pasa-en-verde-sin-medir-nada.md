# INC-007 — Un check de `npm run audit` pasa en verde sin haber mirado ni un archivo

| Campo | Valor |
|---|---|
| **Fecha** | 2026-08-27 |
| **Paquete** | P0 |
| **Área** | build |
| **Tiempo perdido** | ~2 h repartidas en siete apariciones. La octava y la novena se cazaron en un minuto cada una, y **la novena la cazo la regla que dejo escrita la octava** |
| **Recurrencias** | **14** |

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
7. **P1** — al añadir la comprobación M10 a `audit:migrations` (ver INC-011).

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

**El caso 7 es el primero de P1, y confirma que esto no se cura con disciplina.** La comprobación M10 de `audit:migrations` —la que impide que un `down.sql` borre filas de una tabla que no elimina— se escribió con un carácter de retroceso (`0x08`) donde debía ir la secuencia `` del patrón. El regex compilaba, el check imprimía su línea de éxito y no reconocía ni un solo `DELETE FROM`. Se detectó en el mismo minuto, porque la prueba del guardián ya es un paso obligatorio: se introdujo el borrado prohibido, el check siguió en verde, y ahí se vio. **Sin ese paso, M10 habría entrado al repositorio como una regla decorativa** — y peor que no tenerla, porque la ficha INC-011 diría que el problema está prevenido.

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

## Caso 8 (P5) — el mismo caracter, la segunda vez

**La regla M11 de `audit:migrations` marco 3 migraciones de 5.** Ese numero era el sintoma: P1 y P2 tienen 33 y 20 `CHECK`, y la regla no las veia. Las tres que marco eran justo las que tienen `RAISE EXCEPTION`, o sea las que casaban por la OTRA mitad de la condicion.

La causa: la regex se escribio como

```
/CHECK\s*\(/i
```

pero el archivo se genero desde una cadena de otro lenguaje donde `` **no es «limite de palabra»: es el caracter de RETROCESO (0x08)**. Lo que quedo en el archivo fue una regex que solo casa si delante de `CHECK` hay un retroceso — es decir, nunca. Compila, no lanza, no avisa.

**Es exactamente el caso 7**, que fue M10 y el mismo caracter. La prevencion de entonces —la prueba del guardian— no lo evito, porque el guardian se hace sobre una violacion que uno **sabe** que existe, y aqui la violacion existia: los tres `RAISE` hacian fallar la regla y daban la impresion de que medía.

**Lo que si lo caza es mirar CUANTOS.** Un check que falla no basta: hay que preguntarse si falla en todos los sitios donde debería. «3 de 5» fue la pregunta que destapo el fallo.

### La prevencion, esta vez automatizada

`audit:forbidden` gana la regla **`sin-caracteres-de-control`**: ningun archivo de codigo puede contener un caracter de control literal (todo lo de control menos tabulador, salto de linea y retorno de carro). Un retroceso jamas tiene sitio legitimo en un `.ts` ni en un `.mjs`, asi que la regla no necesita excepciones.

Tiene su prueba del guardian: se vuelve a meter el retroceso en `tools/audit/migrations.mjs`, se comprueba que el check falla senalando linea y columna, y se revierte. La salida esta en `docs/pasos/P5/evidencia/guardian-5-caracter-de-control.txt`.

**Esta es la primera prevencion de INC-007 que ataca la CAUSA y no el sintoma.** Las siete anteriores enseñaban a desconfiar del verde; esta impide que el fallo se escriba.

### Caso 14 (P16-G2) — la regla funcionó, la costumbre no

El mismo retroceso, **la tercera vez con esta causa exacta**, escribiendo la regex de M12 desde un
generador. Se anota aquí y no en una ficha nueva porque no añade nada al diagnóstico: añade la única
cosa que faltaba saber, que es que **la prevención del caso 8 aguanta**. `sin-caracteres-de-control`
lo paró antes del commit, con archivo, línea y columna, y el arreglo fue de un minuto.

Lo que sí cambió: esa regex ya no usa ``. Donde un límite de palabra se puede sustituir por algo
que no se degrada en silencio —aquí `(?!FUNCTION)`— se sustituye, porque la regla caza el carácter
pero no obliga a nadie a dejar de escribirlo.

## Caso 10 (P14) — la misma trampa, ahora con la extensión del archivo

**Otra vez lo delató el contador de archivos, y otra vez porque NO se movió.**

### Qué pasó

P14 añade tres `.tsx` a `apps/web` y borra uno. Después del cambio, el check
seguía diciendo lo mismo que antes:

```
audit:forbidden  OK — 34 reglas sobre 346 archivos
```

Tres archivos más y uno menos, y el número clavado. O el contador no cuenta, o
esos archivos no los mira nadie.

### La causa

Todos los patrones dicen `apps/*/src/**/*.ts`. **Ninguno decía `.tsx`.**

Las 34 reglas —`: any`, `as any`, `@ts-ignore`, `eslint-disable`, marcadores
pendientes— **nunca examinaron una sola línea del frontend**. La Fase C construyó
2.000 líneas en cinco pantallas y ninguna pasó por aquí.

Es exactamente el caso 9 con otra ropa: allí el glob fallaba por la ruta, aquí
por la extensión. En los dos el efecto es el mismo —una regla que no mira nada
no falla nunca— y en los dos lo único que chirrió fue un número.

### El arreglo

Los siete patrones, en seis archivos de reglas, pasan a:

```js
const CODIGO = ['apps/*/src/**/*.{ts,tsx}', 'apps/*/test/**/*.ts'];
```

El contador se mueve a **359**, que son los 13 `.tsx` que faltaban, contados uno
a uno.

**Y el guardián, que es la otra mitad:** con un `// @ts-ignore` y un
`const colado: any = 1` metidos a propósito en `ui/Tabla.tsx`, el check pasa a
`FALLO — 2 infraccion(es)` y las nombra con su línea. Antes las dos pasaban en
silencio.

### La lección, que es nueva

**Un glob de extensión es un alcance con fecha de caducidad.** El día que el
repositorio ganó un tipo de archivo nuevo, treinta y cuatro reglas se quedaron
mirando a otro lado sin que nada fallara. No hay forma de que un check avise de
lo que no está mirando: **lo único que lo delata es que el contador no se mueva
cuando el repositorio sí lo hace.** Por eso ese número se lee en cada paquete.

## Caso 9 (P6) — la regla llevaba desde P0 sin mirar una sola migración

**Lo encontró la regla del caso 8**, la que dice que hay que contar en cuántos sitios falla un check. Sin ella habría pasado por un guardián en verde.

### Qué pasó

P6 añade `inventory_movement` a `TABLAS_APPEND_ONLY`, lo que genera dos reglas: una para el cliente de Prisma y otra para SQL. Se forzó el guardián, como INC-007 exige al ampliar el alcance de un check, con **dos** violaciones deliberadas por regla:

- `tx.inventoryMovement.update(...)` y `.deleteMany(...)` en un archivo de código
- `UPDATE inventory_movement` y `DELETE FROM inventory_movement` en el bloque `MANUAL` de la migración

El check falló. En rojo, con su mensaje, señalando archivo y línea:

```
audit:forbidden  FALLO — 2 infraccion(es)
```

**Dos, y tenían que ser cuatro.** La regla SQL no apareció por ninguna parte.

### La causa

El glob decía `prisma/migrations/**/*.sql`. El escáner compara rutas **relativas a la raíz del repositorio**, y las migraciones están en `apps/api/prisma/migrations/...`. El patrón está anclado al principio, así que no casaba con nada.

La consecuencia es más vieja que P6: **desde P0, dos reglas no habían examinado una sola migración.**

| Regla | Desde | Qué dejó de mirar |
|---|---|---|
| `no-select-star` | P0 | Un `SELECT *` en cualquier migración |
| `append-only-sql-audit_log` | P0 | Un `UPDATE`/`DELETE` sobre `audit_log` en cualquier migración |

Ninguna de las dos avisó nunca, porque nunca tuvo nada que avisar. Y el contador de archivos del informe —`OK — 30 reglas sobre 189 archivos`— tampoco chirriaba: 189 archivos son muchos, y los 14 que faltaban no se echan de menos mirando un número grande. **Es el mismo engaño del caso 3**, donde «135 archivos» tranquilizaba mientras 85 no los miraba nadie.

### El arreglo

Una constante compartida por las dos reglas, con su explicación al lado:

```js
const MIGRACIONES = 'apps/*/prisma/migrations/**/*.sql';
```

Segunda pasada del guardián: **4 infracciones en 4 sitios**. Y tras revertir las violaciones:

```
audit:forbidden  OK — 30 reglas sobre 203 archivos
```

**203 y no 189.** Los catorce de diferencia son las migraciones, escaneadas por primera vez. Ese número es la medida de que el arreglo hizo algo — y es, otra vez, el contador de archivos el que lo dice.

### Lo que añade sobre el caso 8

El caso 8 estableció que hay que contar los sitios donde un check falla. Este añade **dónde mirar cuando el número no cuadra**: casi siempre es el alcance, no la lógica. Un patrón que no casa con nada se comporta exactamente igual que un patrón que casa y no encuentra infracciones, y las dos cosas producen la misma línea verde.

**Y una consecuencia práctica que ya está aplicada:** el contador de archivos examinados de `audit:forbidden` no es decorativo. Cuando una regla cambia de alcance, ese número tiene que moverse. Si no se mueve, el alcance no cambió.

**Evidencia completa:** `docs/pasos/P6/evidencia/guardian-1-append-only.txt`.

## Prevención

- [x] ¿Se puede convertir en una verificación de `npm run audit`? **No en el sentido habitual, y por eso existe la prueba del guardián.** Ningún check puede verificarse a sí mismo: por cada uno de los once se introduce a mano una violación deliberada, se captura la **salida de fallo literal**, se revierte, y esa salida vive en `docs/pasos/P0/evidencia/` y en `docs/pasos/P0/AUDITORIA-RESULTADO.md`. **Sin las once salidas capturadas, P0 no cierra** — es criterio de commit, no un extra.
- [x] ¿Se puede convertir en una prueba automatizada? **Parcialmente, y ya está:** `audit:arch` incorpora su propia autocomprobación (crea el fixture, verifica que la configuración lo detecta, lo borra). Es el único de los once que puede hacerlo sin intervención, porque su violación es un archivo y no un estado del repositorio.
- [x] ¿Es una regla que debería estar en `CLAUDE.md`? Ya lo está en la práctica: §13 exige que `npm run audit` **falle** ante cada punto de la tabla. Esta ficha es la razón por la que esa palabra está en negrita.
- [ ] ¿Es una decisión que merece un ADR? No: no es una decisión, es un modo de fallo.

### La regla que se lleva esta ficha

> **Cada vez que cambia el ALCANCE de un check —un workspace nuevo, una carpeta nueva, una regla nueva, un patrón de ignorar nuevo— hay que volver a forzar el fallo de los checks afectados y volver a capturar la salida.**
>
> Ampliar el alcance sin repetir el guardián deja la parte nueva sin cubrir y el check sigue en verde: es exactamente la situación de los casos 3 y 4, que aparecieron meses después de que el check se diera por bueno.

**Y la que añade el caso 8, que la anterior no cubría:**

> **Un check que falla no está verificado: hay que mirar en CUÁNTOS sitios falla.** Si una regla debería marcar cinco archivos y marca tres, la regla está rota aunque su salida sea roja. El verde no es el único color sospechoso.

Momentos ya identificados en los que esto toca hacerse:

| Cuándo | Qué cambia el alcance | Qué hay que volver a forzar |
|---|---|---|
| **P1** | Regla nueva de `audit:forbidden`: cliente de BD fuera de la capa de tenant | `audit:forbidden` |
| **P5** | Reglas nuevas: M11 en `audit:migrations` y `sin-caracteres-de-control` en `audit:forbidden` | Las dos, forzadas y capturadas en `docs/pasos/P5/evidencia/` |
| ~~**P6**~~ | ~~`inventory_movement` entra en la lista de tablas append-only~~ | ✅ **Hecho, y encontro el caso 9** |
| **P12** | Workspace `apps/web`: globs, `tsconfig`, reglas de capa y de complejidad nuevas | **Los once**, sobre el workspace nuevo |
| Cualquiera | Se añade una carpeta que no casa con los globs existentes | Los checks cuyo glob se amplió |
| Cualquiera | Se sube una herramienta de auditoría a un major nuevo | Los checks que la usan: las claves de configuración cambian de nombre y de semántica sin avisar (caso 5) |

## Caso 11 (P16-A2) — no era un check: era una 🔴, y su titulo mentia

**El modo de fallo es el mismo y por eso vive aqui, pero el sujeto es nuevo: una PRUEBA, no un check.**

### Que paso

La etapa del token anti-CSRF cerro con una 🔴 titulada «volver a entrar rota el token, y el anterior
deja de servir». La prueba estaba en verde. El titulo era falso —`IniciarSesion` no revoca ninguna
sesion— y lo que la prueba media era **cookie nueva + token viejo**, que es exactamente el caso de la
prueba de al lado («con el token de OTRA sesion es 403»). Dos pruebas para un solo hecho, y el hecho
del titulo sin cubrir.

La afirmacion falsa no se quedo en el archivo de pruebas: viajo al contrato publico
(`docs/apis/app-cliente.md`), al comentario de `iniciar-sesion.ts` y a **ADR-021**, donde era el
argumento con el que se descarto rotar el token en cada mutacion. **Una prueba en verde firmando una
afirmacion falsa es peor que no tener la prueba**, porque el resto de la documentacion se apoya en
ella.

### Que lo caza

Lo mismo de siempre, aplicado a una prueba: **preguntarle que pasaria si el sistema NO cumpliera lo
que el titulo dice.** Si la respuesta es «pasaria igual», la prueba no lo mide. Aqui bastaba con
ejecutar la sonda contraria —sesion anterior con SU token— y ver el 201.

La segunda mitad del mismo paquete es el hermano gemelo, y ese si se automatizo: desde P16-A2 hay
**dos** 403 distintos (`PERMISO_DENEGADO` y `CSRF_INVALIDO`) y el guard de CSRF corre primero, asi
que 26 aserciones de autorizacion que solo miraban el ESTADO habrian pasado igual sin ejercitar
ningun permiso. La regla `403-de-integracion-sin-su-code` de `audit:forbidden` lo impide, y se
verifico borrando una asercion a mano para comprobar que **falla**.

### La leccion, que es nueva

> **Un titulo de prueba es una afirmacion sobre el sistema, y nadie lo verifica.** El cuerpo se
> revisa; el titulo se cree. Cuando el titulo dice mas de lo que el cuerpo mide, la diferencia acaba
> copiada en la documentacion y en un ADR, donde ya nadie puede distinguirla de un hecho.

## Caso 12 (P16-B) — el bench medía el `dist` que hubiera en disco

**El sujeto vuelve a ser un check, y esta vez no le faltaba alcance: le sobraba antigüedad.**

### Qué pasó

`npm run bench` siembra `costeo_bench`, aplica las migraciones del árbol de trabajo y lanza el
medidor `apps/api/dist/bench.js`. **Nadie compilaba ese `dist`**: ni el script, ni `npm run audit`,
ni ningún paso del protocolo. Al medir P16-B el archivo era del 2026-09-10 16:45 —anterior a todo el
paquete— y no contenía ni una línea de lo que P16-B cambió en el propio `bench.ts`
(`grep -c ultimaVersionId dist/bench.js` → `0`). La base tenía el esquema nuevo y el código medido
era el viejo.

Esta vez **reventó** (`Cannot read properties of undefined (reading 'toFixed')`), y por eso se vio.
Lo normal habría sido lo contrario: un paquete que no toca el `bench.ts` mide el código del paquete
anterior, imprime cuatro presupuestos con su ✓ y el número va a `AUDITORIA-RESULTADO.md` como
evidencia del paquete que no midió. **Los números de bench de P16-A1 y P16-A2 no se pueden atribuir
con certeza al código que se commiteó**: dependían de cuándo se hubiera compilado por última vez.

### La prevención, que es de construcción y no de disciplina

`scripts/bench.mjs` gana `compilar()`: `tsc --build tsconfig.build.json` sobre `apps/api` **antes de
crear la base**, siempre. Es incremental —si nada cambió, solo comprueba— y un error de compilación
aborta antes de sembrar. Verificado: tras la corrida, `dist/bench.js` contiene `ultimaVersionId`.

### Y dos más del mismo paquete que NO suben el contador, porque los cazó el guardián

Los dos son el modo de fallo del caso 11 —una prueba que afirma más de lo que mide— y los dos
murieron antes del commit, que es exactamente para lo que existe el guardián:

1. **«Diez escrituras a la vez» no era una carrera.** Con `Promise.all`, la transacción del producto
   es tan corta que en local no se solapa: devolviendo la escritura a un leer-comparar-escribir, la
   🔴 seguía en verde. Se rehízo determinista —otra conexión bloquea la fila con `FOR UPDATE`, se
   espera en `pg_locks` a que las cinco escrituras estén paradas y se suelta— y ahora el mismo
   guardián da cinco 200 en vez de uno. `test/soporte/bloqueos.ts`, ADR-023.
2. **«Cuarta recurrencia: una presentación de cero» no lo era.** Devolviendo el esquema a la regex
   vieja, la prueba seguía en 400 porque el dominio la paraba desde P2. Se retituló; la ficha de
   INC-012 lo cuenta.

> **La lección, que amplía la del caso 11:** preguntar «¿qué pasaría si el sistema no cumpliera el
> título?» no basta si la respuesta se imagina. **Hay que escribir el sistema que no lo cumple** —el
> `if` previo, el esquema viejo, el `dist` sin compilar— y verlo fallar.

## Caso 13 (P16 · Armazón) — `typecheck` del web no comprobaba las rutas tipadas en un clon limpio

**Dos checks del mismo commit con el mismo modo de fallo.** Uno se destapó solo; el otro, al
preguntarse si el primero tenía hermano.

### Qué pasó

1. **Las rutas tipadas.** `apps/web` tiene `typedRoutes`: un `<Link href="/ruta-que-no-existe">` no
   compila. **Pero los tipos de las rutas los genera Next en `.next/types/`**, y `npm run typecheck`
   era `tsc --noEmit` a secas. Tras mover las cuatro páginas a `(app)/`, `tsc` falló contra un
   `.next/types/validator.ts` rancio que aún importaba `src/app/costeo/page.js`. El hermano, que es el
   grave: **en un clon limpio —el de CI— no hay `.next/` ni `next-env.d.ts`, y `tsc` no ve la
   restricción**. Sonda, con un `href` a una ruta inexistente:

   ```
   --- sin tipos generados (lo que ve CI):
   (sin salida: tsc en verde)
   --- con tipos generados:
   src/app/sonda-rutas.tsx:5:16 - error TS2322: Type '"/ruta-que-no-existe"' is not assignable to type 'UrlObject | RouteImpl<"/ruta-que-no-existe">'.
   ```

   CI nunca construye `apps/web`, así que **ningún check del proyecto validaba las rutas tipadas**.

2. **La complejidad de los `.tsx`.** `audit:complexity` solo tenía el glob `apps/*/src/**/*.ts`.
   Estaba dicho —el commit 0 lo dejó para el armazón—, pero no medido: con el glob `.tsx` añadido, el
   árbol de P16-C, que salió con `audit exit=0`, tiene **diez** incumplimientos (`Ventas` de 163 líneas
   y complejidad 15, `Inventario` de 141 y 15, `Marco` de 87, `Entrar` de 79, `ElegirSucursal` de 71,
   `HojaDeConteo` de 58, `Cuadrante` de 49, `MenuEngineering` de 43). El armazón los deja en cero.

### La prevención

`"typecheck": "next typegen && tsc --noEmit"`: los tipos se regeneran **siempre** antes de comprobar,
así que no hay `.next/` rancio en local ni ausente en CI. Guardián, borrando `.next/types` y
`next-env.d.ts` como en un clon limpio:

```
--- ROJO esperado (sonda con href inexistente):
✓ Types generated successfully
src/app/sonda-rutas.tsx:5:16 - error TS2322: Type '"/ruta-que-no-existe"' is not assignable to type 'UrlObject | RouteImpl<"/ruta-que-no-existe">'.
--- VERDE esperado (sonda retirada):
✓ Types generated successfully
```

Y el glob `'apps/*/src/**/*.tsx'` en `eslint.complexity.config.mjs`, con los diez de arriba como
guardián: la configuración vieja no los veía, la nueva sí.

### Y dos más, al mover la base de puerto, que no suben el contador porque se cazaron antes

El usuario pidió publicar la base de desarrollo en el 5442. Antes de hacerlo se buscó quién tenía el
5432 escrito, y dos checks lo tenían **con el `.env` fuera de su alcance**:

1. **La guardia de «unitarias sin base»** (`test/soporte/guardia-sin-base.ts`) vigilaba
   `POSTGRES_PORT ?? 5432` de `process.env`, y el proyecto `unit` no carga el `.env`. Con la base en el
   5442, una unitaria que abriera un socket a la base de verdad **pasaba en verde** —comprobado con
   una sonda, salida en `docs/pasos/P16/CONSTRUCCION.md`—.
2. **La sonda de `audit:tests`** preguntaba al mismo `POSTGRES_PORT ?? 5432`, y este proceso tampoco
   carga el `.env`. En el pre-commit, con `--solo-unitarias`, un puerto vacío es un **PARCIAL en verde
   sin una sola prueba de integración**.

Las dos leen ahora **las cadenas de conexión**, del entorno o del `.env` leído con `util.parseEnv` y
**sin cargarlo** (las unitarias no deben ver sus variables). La guardia vigila además el puerto de
PgBouncer: una unitaria tampoco debe llegar a la base por el pooler.

> **La lección que añade:** un número escrito en un check no es una constante, es una suposición sobre
> el entorno. Cuando el entorno se puede configurar, el check tiene que leer **la misma fuente** que el
> código que vigila, no un valor por defecto que coincidía.

## Referencias

- `docs/pasos/P0/evidencia/` — las salidas de fallo capturadas de cada check
- `docs/PROTOCOLO.md` — fase de AUDITORÍA
- CLAUDE.md §13 — la tabla de los checks y la palabra «falla»
