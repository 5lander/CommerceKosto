#!/usr/bin/env node
/**
 * `npm run backoffice` — arranca el proceso del back office.
 *
 * ES UN SEGUNDO BINARIO, no un modo de la API. La conexion privilegiada vive
 * solo aqui (SPEC §1, ADR-017), y el proceso de la aplicacion cliente ni
 * siquiera lee la variable que la contiene.
 *
 * El porque de compilar antes y de ejecutar `dist/` esta en
 * `lib/compilar-y-correr.mjs`.
 */

import { compilarYCorrer } from './lib/compilar-y-correr.mjs';

compilarYCorrer('dist/backoffice.js', process.argv.slice(2));
