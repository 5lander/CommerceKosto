# ADR-013 — El parser vive en `.mjs`, fuera de `src/`, y corre en un proceso aparte

| | |
|---|---|
| **Estado** | Aceptada |
| **Fecha** | 2026-09-07 |
| **Paquete** | P10 |
| **Contexto** | `CLAUDE.md` §4.6 · `docs/SEGURIDAD.md` §5.4 · `docs/incidencias/INC-017` |

Un archivo subido es **entrada no confiable**. `CLAUDE.md` §4.6 lo dice sin rodeos: tipo verificado
por magic bytes, límite de tamaño y de filas, **parseo en proceso acotado**, previsualización antes
de escribir y escritura en una sola transacción reversible.

Este ADR registra las tres decisiones que hicieron falta para cumplir «proceso acotado» en este
proyecto concreto, y —más importante— **qué no aporta la solución elegida**.

---

## 1. El parser corre en un proceso hijo, con `fork`, no en una cola de trabajos

**La decisión.** `apps/api/src/modules/imports/infrastructure/aislamiento/leer-en-hijo.ts` lanza
`fork(parser/hijo.mjs)` con tres cosas puestas a propósito:

| | |
|---|---|
| `env: {}` | **El hijo no tiene la cadena de conexión ni ningún secreto.** Si el parser cayera ante un archivo malicioso, lo que cae no sabe dónde está la base |
| `execArgv: ['--max-old-space-size=192']` | Techo de memoria. Un zip bomb no puede tumbar al padre pidiendo RAM |
| `PLAZO_MS = 15_000` + `SIGKILL` | Un archivo que hace trabajar al parser para siempre se muere solo |

Habla por **IPC**, no por stdout, para que una traza no contamine el canal.

**Por qué no una cola (BullMQ + Redis).** `CLAUDE.md` §1 la lista «solo desde el paquete que la
necesite», y este paquete no la necesita: la importación de esta versión es una migración operada
desde la terminal, que ocurre una vez y con alguien mirando. Meter Redis en el despliegue para eso
sería añadir una pieza de infraestructura —con su disponibilidad, su respaldo y su monitorización— a
cambio de nada que se vaya a usar esta semana.

**Lo que esto NO aporta, dicho para que nadie lo crea más de lo que es:**

- **No hay reintentos ni DLQ.** Si el hijo muere, la importación falla y el operador vuelve a
  lanzarla. Con una persona delante eso es suficiente; con una pantalla de subida y cien clientes,
  no lo sería.
- **No hay aislamiento de sistema operativo.** Es un proceso hijo, no un contenedor ni un sandbox.
  Comparte usuario y sistema de archivos con el padre. Lo que impide el daño es que no tiene
  secretos, no tiene red que le sirva y no vive más de 15 segundos.
- **No hay backpressure.** Dos importaciones a la vez son dos hijos a la vez.

---

## 2. El parser es JavaScript plano (`.mjs`) y vive FUERA de `src/`

**La decisión.** `apps/api/parser/lector.mjs`, `apps/api/parser/hijo.mjs` y un `lector.d.mts` escrito
a mano para que TypeScript vea los tipos.

**Por qué no TypeScript.** Porque `fork('hijo.ts')` **no funciona en este paquete**, y es exactamente
la causa raíz de **INC-017**: `apps/api` es `"type": "commonjs"` y sus imports no llevan extensión;
para ejecutar TypeScript, Node lo trata como ESM, y **ESM exige extensión explícita** en los
especificadores relativos. Comprobado con un caso mínimo:

```
import { saluda } from './a';      →  ERR_MODULE_NOT_FOUND
import { saluda } from './a.ts';   →  funciona
```

No falta una bandera: es una incompatibilidad entre cómo está escrito el paquete y lo que Node exige.
Arreglarlo de raíz sería pasar `apps/api` entero a ESM con extensiones — cambio de otro paquete, y
NestJS 12 lo traerá (ADR-001).

**Por qué fuera de `src/`.** Para que `tsc` no lo compile y **la ruta sea idéntica en desarrollo y en
producción**. Si viviera en `src/`, el hijo estaría en `src/…/hijo.mjs` al desarrollar y en
`dist/…/hijo.mjs` al desplegar, y `rutaDelHijo()` tendría que saber en cuál de los dos mundos está —
que es la clase de condicional que se rompe solo en producción. Sube desde `__dirname` buscando el
`package.json` más cercano, y de ahí a `parser/hijo.mjs`.

**Lo que esto cuesta, y se acepta:** el parser no tiene tipos comprobados por el compilador. Se
mitiga con `lector.d.mts` —que TS sí verifica en los llamantes—, con un bloque propio de ESLint
(`apps/*/parser/**/*.mjs`, con `no-console: error` porque el canal es IPC) y con **22 pruebas
unitarias** que construyen ZIP y XLSX byte a byte.

---

## 3. El lector devuelve `string`, siempre, y solo mira lo que necesita

**Todo sale como texto.** Devolver `number` metería `2.0999999999999996` en el sistema antes de que
`Money` y `Ratio` puedan defenderse, y el punto flotante para dinero y cantidades está prohibido
(`CLAUDE.md` §3). Quien convierte es el dominio, en su borde.

**Del `.xlsx` se leen dos entradas y ninguna más**: `xl/sharedStrings.xml` y
`xl/worksheets/sheet1.xml`. Y hay tres cosas que **deliberadamente no hace**:

| No hace | Por qué |
|---|---|
| Evaluar fórmulas | Lee el `<v>` cacheado. Un evaluador es un intérprete, y un intérprete sobre entrada hostil es otra superficie |
| Resolver entidades más allá de las cinco de XML | Sin DOCTYPE, sin entidades externas, sin *billion laughs* |
| Leer macros ni objetos incrustados | No son datos de una hoja |

**Los topes del ZIP se aplican en tres puntos** y no en uno: el tamaño declarado en el directorio
central, el `maxOutputLength` de `inflateRawSync` —que corta **dentro de zlib**, antes de reservar
memoria— y el tamaño real tras inflar. La prueba que lo fija es una zip bomb que se corta por el tope
y no por quedarse sin memoria.

**Y el mensaje de un formato no admitido no dice qué se detectó.** «Solo se admiten archivos .xlsx,
.csv y .tsv» y nada más: un detector de tipos que informa es un detector de tipos gratis para quien
está probando qué le cuelas.

---

## Consecuencias

- El parseo de un archivo hostil no puede leer la base, no puede agotar la memoria del proceso
  principal ni durar más de 15 segundos.
- El día que `apps/api` pase a ESM (NestJS 12, ADR-001), la decisión 2 **se puede revertir** y el
  parser volver a TypeScript dentro de `src/`. Las decisiones 1 y 3 no dependen de eso.
- Si algún día hay una pantalla de subida con varios clientes concurrentes, **la decisión 1 se
  reevalúa**: ahí sí hacen falta cola, reintentos y backpressure, y este ADR queda sustituido.
