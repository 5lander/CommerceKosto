/**
 * `audit:arch` — la regla de dependencia de CLAUDE.md §2.
 *
 *     infrastructure  ->  application  ->  domain
 *
 * Las dependencias apuntan SIEMPRE hacia adentro. El dominio no sabe que existe
 * la infraestructura, y por eso el motor de costeo se puede probar con la base
 * de datos apagada — que es el criterio arquitectonico de aceptacion del
 * proyecto entero.
 *
 * Tres cosas que hacen que esto funcione de verdad y no de adorno:
 *
 *   tsPreCompilationDeps: true
 *     Sin esto, un `import type` es invisible para la herramienta y el check A1
 *     de la auditoria queda vacio. Un tipo importado desde infraestructura es
 *     un acoplamiento igual: obliga a que ese archivo exista y a que compile.
 *
 *   severity: 'error' en TODAS las reglas
 *     Con 'warn' la herramienta imprime el problema y sale con codigo 0. El
 *     build pasa, nadie lee la salida, y la regla deja de existir.
 *
 *   Las reglas se anclan por CAPA, no por ubicacion
 *     `(^|/)(modules/<x>|shared)/domain/` en vez de `^apps/api/src/...`. Asi la
 *     regla sigue valiendo si el codigo se mueve, y la autocomprobacion de
 *     `tools/audit/arch.mjs` puede usar un fixture fuera de `apps/`.
 *
 * Esa autocomprobacion verifica que esta configuracion realmente detecta una
 * violacion, porque un `exclude` mal escrito produce un verde silencioso: la
 * herramienta no analiza nada, no encuentra nada, y sale con exito.
 */

/** Unica excepcion a "el dominio no importa nada de fuera" — ver ADR-003. */
const DECIMAL_EN_DOMINIO = '(^|/)shared/domain/decimal/';

/**
 * Las pruebas viven junto al codigo que prueban, pero no SON esa capa: importan
 * el runner y los generadores de casos. Las reglas de pureza no les aplican.
 */
const PRUEBAS = '\\.(spec|test|type-contract)\\.ts$';

const CAPA_DOMINIO = '(^|/)(modules/[^/]+|shared)/domain/';
const CAPA_APLICACION = '(^|/)(modules/[^/]+|shared)/application/';
const CAPA_INFRAESTRUCTURA = '(^|/)(modules/[^/]+|shared)/infrastructure/';

module.exports = {
  forbidden: [
    {
      name: 'domain-no-importa-application',
      severity: 'error',
      comment:
        'CLAUDE.md §2: la capa `domain` solo puede importar otros archivos de `domain`. ' +
        'Si una regla de negocio necesita un caso de uso, la regla esta en el sitio equivocado.',
      from: { path: CAPA_DOMINIO },
      to: { path: CAPA_APLICACION },
    },
    {
      name: 'domain-no-importa-infrastructure',
      severity: 'error',
      comment:
        'CLAUDE.md §2: el dominio no sabe que existe la infraestructura. ' +
        'Es lo que permite probar el motor de costeo con PostgreSQL apagado.',
      from: { path: CAPA_DOMINIO },
      to: { path: CAPA_INFRAESTRUCTURA },
    },
    {
      name: 'domain-sin-node-modules',
      severity: 'error',
      comment:
        'CLAUDE.md §2 prohibe librerias de terceros en `domain`. La UNICA excepcion es ' +
        '`decimal.js` dentro de shared/domain/decimal/, acotada y registrada en ADR-003: ' +
        'fuera de esa carpeta el resto del proyecto solo ve Money, Ratio, Count y Quantity.',
      from: { path: CAPA_DOMINIO, pathNot: [DECIMAL_EN_DOMINIO, PRUEBAS] },
      to: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'npm-peer', 'npm-bundled'] },
    },
    {
      name: 'domain-sin-nucleo-de-node',
      severity: 'error',
      comment:
        'Ni `fs`, ni `process`, ni `crypto`. El dominio son reglas puras: si necesita el reloj ' +
        'o un identificador, los recibe por puerto. Asi se puede probar de forma determinista.',
      from: { path: CAPA_DOMINIO, pathNot: PRUEBAS },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'application-no-importa-infrastructure',
      severity: 'error',
      comment:
        'CLAUDE.md §2: `application` define PUERTOS (interfaces) y recibe sus implementaciones ' +
        'por constructor. Importar una implementacion concreta invierte la regla de dependencia.',
      from: { path: CAPA_APLICACION },
      to: { path: CAPA_INFRAESTRUCTURA },
    },
    {
      name: 'application-sin-framework',
      severity: 'error',
      comment:
        'Los casos de uso no conocen NestJS, Prisma ni Express. El cableado vive en infraestructura.',
      from: { path: CAPA_APLICACION, pathNot: PRUEBAS },
      to: { path: 'node_modules/(@nestjs|@prisma|express|pino|helmet)' },
    },
    {
      name: 'sin-dependencias-circulares',
      severity: 'error',
      comment: 'Un ciclo entre modulos hace imposible razonar sobre el orden de inicializacion.',
      from: {},
      to: { circular: true },
    },
    {
      name: 'sin-modulos-huerfanos',
      severity: 'error',
      comment:
        'Un archivo que nadie importa es codigo muerto (OPTIMIZACION.md §1). ' +
        'Los puntos de entrada y las aserciones de compilacion estan exceptuados.',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)(main|index)\\.ts$',
          '\\.(spec|test)\\.ts$',
          '\\.type-contract\\.ts$',
          '(^|/)vitest\\.config\\.ts$',
        ],
      },
      to: {},
    },
    {
      name: 'sin-dependencias-de-desarrollo-en-produccion',
      severity: 'error',
      comment: 'Una devDependency importada desde src rompe la imagen de produccion.',
      from: { path: '^apps/[^/]+/src/', pathNot: PRUEBAS },
      to: { dependencyTypes: ['npm-dev'] },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: ['^apps/[^/]+/dist/', '^apps/[^/]+/generated/', '(^|/)\\.tmp/'],
    },
    tsPreCompilationDeps: true,

    // No se declara `tsConfig`: el proyecto no usa alias de rutas, y apuntar a
    // un tsconfig con `extends` hace que dependency-cruiser resuelva el padre
    // contra el cwd en vez de contra el propio archivo (error TS5083). Sin
    // alias que resolver, la opcion no aporta nada y si rompe.
    enhancedResolveOptions: {
      extensions: ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
