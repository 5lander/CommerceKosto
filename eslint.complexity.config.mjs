// @ts-check
/**
 * `audit:complexity` — presupuestos de forma del codigo.
 *
 * Vive aparte de `eslint.config.mjs` para que el informe de auditoria pueda
 * decir cual de los dos checks fallo: "el codigo esta mal escrito" y "el codigo
 * es demasiado complicado" son hallazgos distintos y se arreglan distinto.
 *
 * Los limites duros son los de OPTIMIZACION.md §1:
 *   complejidad ciclomatica <= 10 · profundidad <= 3 · funcion <= 40 lineas
 *
 * AUDITORIA.md B4 pide ademas que ninguna funcion supere 20 lineas "sin
 * justificacion explicita". Esas 20 lineas son la PREFERENCIA de CLAUDE.md §3
 * ("preferir <= 20 lineas"), no un limite duro: se emite como aviso separado
 * en `audit:complexity:preferencias`, que alimenta la revision manual de B4 y
 * no rompe el build. El limite que rompe el build es 40.
 *
 * OJO CON EL PARSER. Sin `parser: tseslint.parser`, ESLint no sabe leer
 * TypeScript y falla con "Parsing error" en cada archivo — o peor, si esos
 * archivos quedaran fuera del glob, saldria en verde sin haber medido nada.
 */

import tseslint from 'typescript-eslint';

import { IGNORADOS } from './eslint.config.mjs';

const COMPLEJIDAD_MAXIMA = 10;
const PROFUNDIDAD_MAXIMA = 3;
const LINEAS_MAXIMAS_POR_FUNCION = 40;
const PARAMETROS_MAXIMOS = 3;
const SENTENCIAS_MAXIMAS = 20;

const LIMITES = {
  complexity: ['error', { max: COMPLEJIDAD_MAXIMA }],
  'max-depth': ['error', PROFUNDIDAD_MAXIMA],
  'max-lines-per-function': [
    'error',
    { max: LINEAS_MAXIMAS_POR_FUNCION, skipBlankLines: true, skipComments: true, IIFEs: true },
  ],
  'max-params': ['error', PARAMETROS_MAXIMOS],
  'max-nested-callbacks': ['error', PROFUNDIDAD_MAXIMA],
  'max-statements': ['error', SENTENCIAS_MAXIMAS],
};

export default [
  { ignores: IGNORADOS },
  {
    files: ['apps/*/src/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: LIMITES,
  },
  {
    files: ['tools/**/*.mjs', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: LIMITES,
  },
  {
    // Las pruebas describen casos; su longitud es descriptiva, no complejidad.
    files: ['apps/*/test/**/*.ts', 'apps/*/src/**/*.spec.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      'max-lines-per-function': 'off',
      'max-statements': 'off',
      'max-nested-callbacks': 'off',
    },
  },
];
