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

import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { correrCli } from '../../scripts/lib/proceso.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = join(RAIZ, 'apps', 'api');
const PUERTO = Number(process.env['POSTGRES_PORT'] ?? 5432);
const HOST = process.env['POSTGRES_HOST'] ?? '127.0.0.1';
const SOLO_UNITARIAS = process.argv.includes('--solo-unitarias');

/**
 * Cuantas veces se pregunta antes de dar la base por ausente.
 *
 * NACE DE UN FALLO REAL, en el commit de P9. Con la base ARRIBA y sana, la
 * sonda agoto su plazo y `audit:tests` se degrado a PARCIAL: el commit paso
 * sin correr una sola prueba de integracion, y en verde. La causa es el atasco
 * del proxy de Docker en Windows (INC-016), que ocasionalmente traga una
 * conexion entera.
 *
 * Un intento respondia a «¿esta la base?» con «¿esta y ademas responde rapido
 * ahora mismo?», que es otra pregunta. Tres intentos separan las dos: una base
 * apagada falla las tres veces al instante —`ECONNREFUSED`, no agota plazo—, y
 * una base viva detras de un transporte con hipo contesta a la segunda.
 */
const INTENTOS = 3;

/**
 * Sonda TCP: no necesita psql ni credenciales, solo saber si algo escucha.
 * @returns {Promise<boolean>}
 */
function unSondeo() {
  return new Promise((resolver) => {
    const socket = connect({ host: HOST, port: PUERTO });
    /** @param {boolean} disponible */
    const cerrar = (disponible) => {
      socket.destroy();
      resolver(disponible);
    };
    socket.setTimeout(1500);
    socket.once('connect', () => cerrar(true));
    socket.once('timeout', () => cerrar(false));
    socket.once('error', () => cerrar(false));
  });
}

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
 * @returns {Promise<boolean>}
 */
async function baseDisponible() {
  for (let intento = 0; intento < INTENTOS; intento += 1) {
    if (await unSondeo()) return true;
  }
  return false;
}

const hayBase = await baseDisponible();

if (!hayBase) {
  if (SOLO_UNITARIAS) {
    console.log(`\naudit:tests  PARCIAL — unitarias en verde; integracion omitida (nada escucha en ${HOST}:${PUERTO})`);
    console.log('  Para correrlas:  npm run db:up');
    process.exit(0);
  }

  console.error(`\naudit:tests  FALLO — no hay PostgreSQL en ${HOST}:${PUERTO}`);
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
