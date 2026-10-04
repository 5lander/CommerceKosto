#!/usr/bin/env node
/**
 * `audit:base` — ¿contesta la base por donde dicen las tres cadenas de conexión?
 *
 * VA ANTES DE `audit:sec-headers`, Y POR ESO EXISTE COMO CHECK PROPIO. Esa etapa
 * corre el proyecto de integración entero con un filtro de nombre, así que es la
 * primera que entra en la base dentro de `npm run audit`. La recurrencia 2 de
 * INC-015 salió justo ahí: `bouncer config error` en `backoffice-interfaz`, con
 * las cabeceras en verde y el error acusando al componente equivocado. Una sonda
 * solo dentro de `audit:tests` habría llegado tarde.
 *
 * Aquí no hay `--solo-unitarias`: `npm run audit` exige la base. Quien no la tenga
 * levantada recibe el comando para levantarla.
 *
 * La sonda es la de `scripts/lib/sonda-de-la-base.mjs`, la misma de `doctor` y de
 * `audit:tests`. El `.env` se lee sin cargarlo, como en `audit:tests`.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  diagnosticarLaBase,
  INTENTOS_ANTE_EL_PROXY,
  lectorSinCargar,
} from '../../scripts/lib/sonda-de-la-base.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { estado, detalle, arreglo } = await diagnosticarLaBase(lectorSinCargar(RAIZ), {
  intentos: INTENTOS_ANTE_EL_PROXY,
});

if (estado === 'ok') {
  console.log(`audit:base  OK — ${detalle}`);
  process.exit(0);
}

console.error(`\naudit:base  FALLO — ${detalle}`);
if (arreglo !== '') console.error(`  ${arreglo}`);
process.exit(1);
