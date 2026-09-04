/**
 * Reglas de contenido de `audit:forbidden` — nucleo del proyecto.
 *
 * Las reglas son DATOS, no codigo. Un paquete nuevo anade su regla aqui (o en
 * otro archivo `*.rules.mjs`) sin tocar el escaner.
 *
 * Campos de una regla:
 *   id          identificador estable, aparece en el mensaje de fallo
 *   descripcion que prohibe, en una linea
 *   porQue      la razon. Sin esto, la siguiente persona la desactiva
 *   patron      RegExp con flag `g`
 *   incluye     globs de archivos donde aplica
 *   excluye     globs de archivos donde NO aplica
 *   desde       paquete en el que entra en vigor (documental)
 *   referencia  seccion del documento normativo que la respalda
 */

/**
 * Archivos de codigo del proyecto.
 *
 * LAS PRUEBAS ESTAN DENTRO A PROPOSITO. Se descubrio al escribir un doble de
 * `ServerResponse`: `apps/*\/test/**` quedaba fuera del escaner, asi que un
 * `as any` o un `SELECT *` en una prueba de integracion no lo veia nadie. Una
 * prueba es codigo que se mantiene igual que el resto, y ademas es donde mas
 * tienta saltarse el sistema de tipos "porque es solo un test". Las reglas que
 * de verdad no aplican a una prueba se excluyen una a una con `PRUEBAS`.
 */
const CODIGO = ['apps/*/src/**/*.ts', 'apps/*/test/**/*.ts', 'tools/**/*.mjs', 'scripts/**/*.mjs'];

/**
 * El propio escaner y sus fixtures contienen a proposito los textos que
 * prohibe. Excluirlos no es una concesion: es la unica forma de que las reglas
 * puedan escribirse. Su correccion se verifica con la suite de fixtures.
 */
const META = ['tools/audit/**', 'apps/*/test/fixtures/**'];

const PRUEBAS = ['**/*.spec.ts', '**/*.test.ts', '**/test/**'];

const DOMINIO = ['apps/*/src/**/domain/**/*.ts'];

export const coreRules = [
  {
    id: 'no-any',
    // Sin cadenas: `as any` dentro de un literal de texto no es codigo. Lo
    // encontro la prueba del guardian — el nombre de la prueba que provocaba la
    // violacion («usa as any en una prueba») se marcaba como infraccion
    // aparte. Un check que reporta de mas se acaba leyendo por encima.
    analiza: 'codigo-sin-cadenas',
    descripcion: 'El tipo `any`, en cualquiera de sus formas',
    porQue: '`any` apaga el verificador de tipos justo donde mas hace falta. Usar `unknown` y estrechar.',
    patron: /(?::\s*any\b)|(?:\bas\s+any\b)|(?:<\s*any\s*>)|(?:\bany\[\])|(?:\bArray<\s*any\s*>)/g,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'CLAUDE.md §3 · AUDITORIA.md B1',
  },
  {
    id: 'no-ts-ignore',
    analiza: 'todo',
    descripcion: '`@ts-ignore` y `@ts-nocheck`',
    porQue: 'Silencian un error de tipos sin dejar constancia de cual era ni de si sigue existiendo.',
    patron: /@ts-(?:ignore|nocheck)\b/g,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'CLAUDE.md §8 · AUDITORIA.md B1',
  },
  {
    id: 'no-eslint-disable',
    analiza: 'todo',
    descripcion: '`eslint-disable` en cualquiera de sus variantes',
    porQue: 'Si una regla estorba, se refactoriza el codigo o se cambia la regla con un ADR. No se apaga en el sitio.',
    patron: /eslint-disable(?:-next-line|-line)?\b/g,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'CLAUDE.md §8 · AUDITORIA.md B1',
  },
  {
    id: 'ts-expect-error-solo-en-contratos-de-tipo',
    analiza: 'todo',
    descripcion: '`@ts-expect-error` fuera de un archivo `*.type-contract.ts`',
    porQue:
      'Es el mecanismo idiomatico para AFIRMAR que algo no compila, y ahi es legitimo: si algun dia compila, `tsc` falla por directiva no usada. En cualquier otro archivo es un `@ts-ignore` con otro nombre.',
    patron: /@ts-expect-error\b/g,
    incluye: CODIGO,
    excluye: [...META, '**/*.type-contract.ts'],
    desde: 'P0',
    referencia: 'ADR-003',
  },
  {
    id: 'no-marcador-pendiente',
    descripcion: 'Marcadores `TODO`, `FIXME`, `XXX` o `HACK` en el codigo',
    porQue:
      'OPTIMIZACION.md §1: o se hace, o se registra en ESTADO.md, o se borra. Un marcador sin ticket es una promesa que nadie va a cumplir.',
    // SIN el flag `i`, a proposito. La regla `no-warning-comments` de ESLint no
    // distingue mayusculas y en un proyecto escrito en espanol es inservible:
    // marcaria cada comentario que contenga la palabra "todo".
    patron: /\b(?:TODO|FIXME|XXX|HACK)\b\s*[:(]/g,
    analiza: 'todo',
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'OPTIMIZACION.md §1 · AUDITORIA.md B11',
  },
  {
    id: 'no-shell-en-spawn',
    descripcion: '`shell: true` al lanzar un proceso hijo',
    porQue:
      'En Windows el shell no PASA los argumentos: los concatena sin comillas, y uno con espacios (una consulta SQL, una ruta) llega troceado. La via correcta es `correr` / `correrCli` de scripts/lib/proceso.mjs. Ver docs/incidencias/INC-006.',
    patron: /shell:\s*(?:true|process\.platform\s*===\s*['"]win32['"])/g,
    incluye: ['tools/**/*.mjs', 'scripts/**/*.mjs', 'apps/*/src/**/*.ts'],
    // proceso.mjs es quien encapsula la decision: contiene `shell: false`.
    excluye: [...META, 'scripts/lib/proceso.mjs'],
    desde: 'P0',
    referencia: 'docs/incidencias/INC-006',
  },
  {
    id: 'no-as-unknown-as',
    analiza: 'codigo-sin-cadenas',
    descripcion: 'La doble asercion `as unknown as`',
    porQue:
      'Es la unica llave que abre las defensas de tipo de `Money`. Convierte cualquier cosa en cualquier cosa sin que el compilador pueda objetar.',
    patron: /\bas\s+unknown\s+as\b/g,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'ADR-003',
  },
  {
    id: 'no-select-star',
    descripcion: '`SELECT *`',
    porQue:
      'Devuelve columnas que nadie pidio. Ademas de coste, es la via por la que un campo protegido acaba en una respuesta.',
    patron: /\bSELECT\s+\*/gi,
    incluye: [...CODIGO, 'prisma/migrations/**/*.sql', 'docker/**/*.sql'],
    excluye: META,
    desde: 'P0',
    referencia: 'CLAUDE.md §5 · AUDITORIA.md D10',
  },
  {
    id: 'no-sql-interpolado',
    descripcion: 'Interpolacion `${...}` dentro de un template literal que contiene SQL',
    porQue:
      'Es inyeccion SQL directa. El valor va SIEMPRE como parametro. Prisma ofrece `$queryRaw` con parametros; `$queryRawUnsafe` no se usa.',
    patron: /`[^`]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP|ALTER|CREATE)\b[^`]*\$\{/gis,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'SEGURIDAD.md §1.1 · AUDITORIA.md C7',
  },
  {
    id: 'no-sql-concatenado',
    descripcion: 'Concatenacion de cadenas dentro de una llamada de consulta',
    porQue: 'Misma razon que la anterior, por la otra via.',
    patron: /\$?queryRawUnsafe\s*\(|\$?executeRawUnsafe\s*\(/g,
    incluye: CODIGO,
    excluye: META,
    desde: 'P0',
    referencia: 'SEGURIDAD.md §1.1 · AUDITORIA.md C15',
  },
  {
    id: 'no-decimal-literal-en-dominio',
    analiza: 'codigo-sin-cadenas',
    descripcion: 'Literal numerico con punto decimal en la capa `domain`',
    porQue:
      'Es la forma literal de "punto flotante para dinero o cantidades". `0.1 + 0.2 !== 0.3`. Todo decimal entra por cadena: `Money.fromDecimalString("0.10")`.',
    patron: /(?<![\w.])\d+\.\d+(?![\w.])/g,
    incluye: DOMINIO,
    // El contrato de tipos DEBE contener los contraejemplos: su trabajo es
    // afirmar que `Money.fromDecimalString(0.1)` no compila.
    excluye: [...META, ...PRUEBAS, '**/*.type-contract.ts'],
    desde: 'P0',
    referencia: 'CLAUDE.md §3 y §8 · AUDITORIA.md E22',
  },
  {
    id: 'no-coercion-numerica-en-dominio',
    descripcion: '`parseFloat`, `Number(...)` y `.toNumber()` en la capa `domain`',
    porQue: 'Sacan un valor exacto del mundo decimal y lo meten en el binario. La perdida es silenciosa.',
    patron: /\bparseFloat\s*\(|\bNumber\s*\(|\.toNumber\s*\(/g,
    incluye: DOMINIO,
    excluye: [...META, ...PRUEBAS, '**/*.type-contract.ts'],
    desde: 'P0',
    referencia: 'CLAUDE.md §8 · ADR-003',
  },
  {
    id: 'decimaljs-solo-en-shared-domain-decimal',
    descripcion: 'Importar `decimal.js` fuera de `shared/domain/decimal/`',
    porQue:
      'CLAUDE.md §2 prohibe librerias de terceros en `domain`. La excepcion de ADR-003 esta acotada a UNA carpeta: el resto del proyecto solo ve `Money`, `Ratio`, `Count` y `Quantity`.',
    patron: /from\s+['"]decimal\.js['"]|require\(\s*['"]decimal\.js['"]\s*\)/g,
    incluye: CODIGO,
    excluye: [...META, 'apps/*/src/shared/domain/decimal/**'],
    desde: 'P0',
    referencia: 'ADR-003 · CLAUDE.md §2',
  },
];
