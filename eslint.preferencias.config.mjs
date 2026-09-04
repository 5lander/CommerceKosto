// @ts-check
/**
 * `audit:complexity:preferencias` — el limite blando de AUDITORIA.md B4.
 *
 * CLAUDE.md §3 dice "preferir <= 20 lineas". Esto lo reporta como AVISO y NO
 * rompe el build: alimenta la revision manual de B4, donde la justificacion
 * explicita es aceptable. El limite que si rompe el build (40) esta en
 * eslint.complexity.config.mjs.
 */

import { IGNORADOS } from './eslint.config.mjs';

const LINEAS_PREFERIDAS = 20;

export default [
  { ignores: IGNORADOS },
  {
    files: ['apps/*/src/**/*.ts', 'tools/**/*.mjs', 'scripts/**/*.mjs'],
    rules: {
      'max-lines-per-function': [
        'warn',
        { max: LINEAS_PREFERIDAS, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  {
    files: ['apps/*/test/**/*.ts', 'apps/*/src/**/*.spec.ts'],
    rules: { 'max-lines-per-function': 'off' },
  },
];
