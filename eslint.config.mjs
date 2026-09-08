// @ts-check
/**
 * Configuracion de ESLint — `audit:lint`.
 *
 * Se ejecuta con `--no-inline-config`: los comentarios `eslint-disable` NO
 * tienen efecto. Es deliberado y es la mitad de la defensa; la otra mitad es la
 * regla `no-eslint-disable` de `audit:forbidden`, que ademas hace fallar el
 * check si alguien los escribe. Si una regla estorba, se refactoriza el codigo
 * o se cambia la regla con un ADR (CLAUDE.md §8).
 *
 * La complejidad vive aparte, en `eslint.complexity.config.mjs`, para que
 * `audit:lint` y `audit:complexity` puedan fallar por separado y el informe de
 * auditoria diga cual de los dos fue.
 */

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export const IGNORADOS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/coverage/**',
  '**/reports/**',
  '**/generated/**',
  '.tmp/**',
  'apps/*/prisma/migrations/**',
  // Asercion de compilacion: sus lineas estan escritas para NO compilar, asi
  // que las reglas con tipos se quejarian de todas ellas. Lo verifica `tsc`
  // (audit:types), y `audit:forbidden` controla sus `@ts-expect-error`.
  'apps/*/src/**/*.type-contract.ts',
  // Lo genera Next en cada arranque, no se versiona y no es nuestro.
  'apps/web/.next/**',
  'apps/web/next-env.d.ts',
];

export default tseslint.config(
  { ignores: IGNORADOS },

  js.configs.recommended,

  // --- El FRONTEND: mismas reglas duras, con las de React encima -----------
  //
  // `apps/web` NO lleva las 7 fases del protocolo —alli no vive ninguna regla de
  // negocio, asi que la auditoria de cien verificaciones protege poco y cuesta
  // mucho—, pero SI lleva las cuatro que no se relajan en ningun sitio: nada de
  // `any`, dinero y cantidades nunca en punto flotante, decimales como cadena en
  // las fronteras, y cero logica de negocio.
  //
  // `no-restricted-syntax` es lo que convierte la tercera en algo verificable en
  // vez de en una intencion: `parseFloat` y `Number()` sobre un decimal de la API
  // rompen el build. Es la unica forma de que la regla sobreviva a la prisa.
  {
    files: ['apps/web/src/**/*.ts', 'apps/web/src/**/*.tsx'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],

      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.name='parseFloat']",
          message:
            'Los decimales de la API llegan como cadena y se muestran como cadena. ' +
            '`parseFloat` los convierte en punto flotante y 0.1 + 0.2 deja de dar 0.3 ' +
            '(CLAUDE.md §3). Si hace falta un calculo, va en la API.',
        },
        {
          selector: "CallExpression[callee.object.name='Number'][callee.property.name='parseFloat']",
          message: 'Mismo motivo que `parseFloat`: los decimales no se parsean en el frontend.',
        },
        {
          selector: "CallExpression[callee.name='Number'] > MemberExpression",
          message:
            'Convertir a numero un campo que viene de la API es punto flotante sobre un decimal ' +
            'exacto. Muestralo como cadena (CLAUDE.md §3).',
        },
      ],
    },
  },

  // --- TypeScript de la aplicacion, con tipos ------------------------------
  {
    files: ['apps/api/src/**/*.ts', 'apps/api/test/**/*.ts'],
    ignores: ['apps/api/src/navegador/**'],
    extends: [
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: {
      // CLAUDE.md §3: `any` prohibido. Es error, no aviso.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',

      // Errores tipados de dominio, nunca cadenas sueltas (CLAUDE.md §3).
      '@typescript-eslint/only-throw-error': 'error',

      // Un `catch` que silencia el error es una fuga de informacion diagnostica.
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Sin numeros magicos: constantes con nombre (AUDITORIA B7).
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],

      // `+` sobre tipos que no son numero ni cadena: es lo que atrapa `Money + 1`
      // en el caso de que alguien esquive el sistema de tipos.
      '@typescript-eslint/restrict-plus-operands': [
        'error',
        { allowAny: false, allowBoolean: false, allowNullish: false, allowNumberAndString: false, allowRegExp: false },
      ],

      // La aplicacion registra por el logger estructurado con correlation_id,
      // nunca por consola (CLAUDE.md §13 · FASE0-CHECKLIST D1).
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // --- Modulos de constantes ------------------------------------------------
  {
    // Un archivo cuyo unico trabajo es dar nombre a los numeros, con su
    // justificacion al lado, ES el cumplimiento de la regla, no su violacion.
    files: ['apps/*/src/**/escalas.ts', 'apps/*/src/**/constantes.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },

  // --- Modulos de NestJS ----------------------------------------------------
  {
    // Un modulo de NestJS ES, por contrato del framework, una clase vacia (toda
    // su configuracion vive en el decorador) o una clase con un unico metodo
    // estatico `forRoot`. `no-extraneous-class` existe para atrapar el
    // antipatron de la clase usada como espacio de nombres, que no es este
    // caso: la clase es el TOKEN con el que Nest identifica el modulo, asi que
    // no puede ser una funcion suelta.
    files: ['apps/*/src/**/*.module.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': ['error', { allowStaticOnly: true, allowEmpty: true }],
    },
  },

  // --- Pruebas: mismas reglas, con dos concesiones justificadas -------------
  {
    files: ['apps/*/test/**/*.ts', 'apps/*/src/**/*.spec.ts'],
    rules: {
      // Los valores esperados de un caso conocido SON numeros literales: ese es
      // justamente su valor como prueba. Ver docs/pruebas/casos-conocidos.md.
      '@typescript-eslint/no-magic-numbers': 'off',
      // Una prueba de contrato de tipos necesita construir el caso invalido.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      // Referenciar un metodo estatico (`const m = Money.fromDecimalString`) o
      // guardar `net.Socket.prototype.connect` es deliberado en las pruebas.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // --- El lector de hojas: JavaScript plano en un proceso aparte -----------
  //
  // Esta en JavaScript por una razon de EJECUCION —tiene que arrancar en un
  // proceso hijo desde el fuente y desde `dist/`, y Node exige extension
  // explicita para ejecutar TypeScript como ESM— no porque sus reglas sean mas
  // laxas. Sus tipos viven en `lector.d.mts` y `tsc` comprueba a quien lo usa.
  {
    files: ['apps/*/parser/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // ES EL ARCHIVO QUE ABRE LA ENTRADA HOSTIL: nada de consola, que acabaria
      // mezclada con el canal IPC por el que contesta.
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // --- Tooling de auditoria y scripts: JavaScript con tipos JSDoc -----------
  {
    files: ['tools/**/*.mjs', 'scripts/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // El tooling informa por consola: es su unica salida.
      'no-console': 'off',
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
);
