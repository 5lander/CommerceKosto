#!/usr/bin/env node
/**
 * `npm run correo:despachar` — arranca el despachador de correo.
 *
 * ES UN TERCER BINARIO, no un modo de la API (D-16.23, ADR-025). El rol que
 * marca la cola y purga el limite de tasa vive solo aqui, y el proceso de la
 * aplicacion cliente ni siquiera lee la variable que lo contiene.
 *
 * El porque de compilar antes y de ejecutar `dist/` esta en
 * `lib/compilar-y-correr.mjs`.
 */

import { compilarYCorrer } from './lib/compilar-y-correr.mjs';

compilarYCorrer('dist/despachador.js', process.argv.slice(2));
