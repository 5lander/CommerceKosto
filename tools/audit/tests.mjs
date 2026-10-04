#!/usr/bin/env node
/**
 * `audit:tests` — corre las pruebas, con una distincion que importa.
 *
 * Las pruebas UNITARIAS corren SIEMPRE, y deben pasar **con PostgreSQL
 * apagado**. Es el criterio arquitectonico del proyecto (CLAUDE.md §2): si el
 * motor de costeo necesita una base para probarse, las capas estan mal.
 *
 * Las de INTEGRACION necesitan la base. Si no esta levantada, este script no
 * las omite en silencio: avisa con el comando exacto para levantarla y falla,
 * salvo que se pase `--solo-unitarias` (que es lo que usa el pre-commit cuando
 * el desarrollador no tiene Docker corriendo).
 *
 * En CI nunca se pasa esa bandera: alli la base siempre esta.
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { correrCli } from '../../scripts/lib/proceso.mjs';
import {
  diagnosticarLaBase,
  INTENTOS_ANTE_EL_PROXY,
  lectorSinCargar,
} from '../../scripts/lib/sonda-de-la-base.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(RAIZ, 'apps', 'api');
const SOLO_UNITARIAS = process.argv.includes('--solo-unitarias');

/**
 * Se invoca Vitest directamente y no `npm run`: en Windows `npm` es `npm.cmd`,
 * y desde la mitigacion de CVE-2024-27980 Node se niega a lanzar un `.cmd` sin
 * shell (EINVAL). Ver docs/incidencias/INC-006.
 *
 * @param {string} proyecto
 */
function correrProyecto(proyecto) {
  const resultado = correrCli('vitest', ['run', '--project', proyecto], {
    cwd: APP,
    stdio: 'inherit',
  });
  return resultado.status === 0;
}

const unitariasOk = correrProyecto('unit');
if (!unitariasOk) {
  console.error('\naudit:tests  FALLO — pruebas unitarias en rojo');
  process.exit(1);
}

/**
 * Las pruebas de `apps/web/src/lib`: funciones puras del cliente —cómo se
 * enseña un número, qué mes se mira— que ninguna prueba de la API puede ver.
 * Nacieron con el signo perdido de `comoImporte` (INC-024).
 *
 * **CON EL EJECUTOR DE NODE, SIN DEPENDENCIAS.** Node 24 quita los tipos de un
 * `.ts` por su cuenta y `node --test` expande el patrón. `process.execPath` y no
 * `node`: es el mismo binario que corre este script (INC-006).
 */
const web = spawnSync(process.execPath, ['--test', 'src/**/*.spec.ts'], {
  cwd: join(RAIZ, 'apps', 'web'),
  stdio: 'inherit',
});
if (web.status !== 0) {
  console.error('\naudit:tests  FALLO — pruebas de apps/web en rojo');
  process.exit(1);
}

/**
 * **LA SONDA PREGUNTA POR LAS TRES CADENAS**, no solo por la directa (INC-015,
 * recurrencia 3): con el 6432 de PgBouncer muerto, preguntar solo al 5442 dejaba
 * correr la integracion entera para fallar con un `ECONNREFUSED` que no nombraba
 * la causa. El `.env` se LEE, no se carga: `process.env` pasa tal cual a Vitest,
 * y las unitarias no deben ver sus variables.
 */
const base = await diagnosticarLaBase(lectorSinCargar(RAIZ), { intentos: INTENTOS_ANTE_EL_PROXY });

/*
 * `rota` FALLA SIEMPRE, también con `--solo-unitarias`. Esa bandera es para quien
 * no tiene Docker corriendo, y degrada a PARCIAL; con Docker arriba pero con un
 * puerto mal, un PARCIAL en verde seria exactamente INC-007: un check que pasa sin
 * haber medido nada.
 */
if (base.estado === 'rota') {
  console.error(`\naudit:tests  FALLO — la base no contesta como dicen las cadenas: ${base.detalle}`);
  console.error(`  ${base.arreglo}`);
  process.exit(1);
}

if (base.estado !== 'ok') {
  if (SOLO_UNITARIAS) {
    console.log(`\naudit:tests  PARCIAL — unitarias en verde; integracion omitida (${base.detalle})`);
    console.log('  Para correrlas:  npm run db:up');
    process.exit(0);
  }

  console.error(`\naudit:tests  FALLO — no hay PostgreSQL: ${base.detalle}`);
  console.error('  Las pruebas de integracion verifican el aislamiento entre companies y los');
  console.error('  privilegios de los roles de base de datos. Omitirlas no es una opcion.');
  console.error('\n  Levanta la base:  npm run db:up');
  console.error('  O, si sabes lo que haces:  node tools/audit/tests.mjs --solo-unitarias');
  process.exit(1);
}

const integracionOk = correrProyecto('integration');
if (!integracionOk) {
  console.error('\naudit:tests  FALLO — pruebas de integracion en rojo');
  process.exit(1);
}

console.log('\naudit:tests  OK — unitarias (sin base) e integracion en verde');
