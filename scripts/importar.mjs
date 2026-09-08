#!/usr/bin/env node
/**
 * `npm run importar` — compila si hace falta y ejecuta el importador.
 *
 * EJECUTA `dist/cli.js`, NUNCA EL FUENTE, y compila antes. El porque —INC-017,
 * y que un `dist/` viejo importaria con las reglas de ayer sobre un libro
 * append-only— esta en `lib/compilar-y-correr.mjs`, que es donde vive desde que
 * el back office estreno el segundo binario.
 *
 * SIN DEPENDENCIAS NUEVAS, en la misma linea que `dev.mjs`.
 */

import { compilarYCorrer } from './lib/compilar-y-correr.mjs';

compilarYCorrer('dist/cli.js', process.argv.slice(2));
