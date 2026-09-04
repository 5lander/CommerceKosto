#!/usr/bin/env node
/**
 * `audit:arch` — reglas de capa de CLAUDE.md §2, con autocomprobacion.
 *
 * Corre `dependency-cruiser` sobre el codigo y, ademas, verifica que la
 * herramienta SI detecta una violacion deliberada. Sin esa segunda parte, un
 * `exclude` mal escrito hace que no analice nada, salga 0, y la regla mas
 * importante del proyecto quede en verde sin haber mirado un solo import.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { correrCli } from '../../scripts/lib/proceso.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// Fuera de `.tmp`: esa ruta esta en el `exclude` de la configuracion, y un
// fixture excluido produce exactamente el verde silencioso que este guardian
// existe para detectar. Ironico y facil de no ver.
const FIXTURE = join(RAIZ, '.arch-selftest');

/** @param {readonly string[]} args */
function cruise(args) {
  return correrCli('dependency-cruiser', args, {
    cwd: RAIZ,
    encoding: 'utf8',
    ejecutable: 'depcruise',
  });
}

function analizarProyecto() {
  const resultado = cruise(['apps/api/src', '--config', '.dependency-cruiser.cjs']);
  if (resultado.stdout) process.stdout.write(resultado.stdout);
  if (resultado.status !== 0 && resultado.stderr) process.stderr.write(resultado.stderr);
  return resultado.status === 0;
}

/**
 * Escribe un modulo de dominio que importa infraestructura y comprueba que
 * dependency-cruiser lo rechaza. Es la prueba del guardian de este check.
 */
function autocomprobar() {
  const dominio = join(FIXTURE, 'src', 'modules', 'probe', 'domain');
  const infraestructura = join(FIXTURE, 'src', 'modules', 'probe', 'infrastructure');

  mkdirSync(dominio, { recursive: true });
  mkdirSync(infraestructura, { recursive: true });

  writeFileSync(join(infraestructura, 'repository.ts'), 'export const repositorio = {};\n');
  writeFileSync(
    join(dominio, 'entity.ts'),
    "import { repositorio } from '../infrastructure/repository';\nexport const entidad = repositorio;\n",
  );

  const resultado = cruise([
    `${normalizar(FIXTURE)}/src`,
    '--config',
    '.dependency-cruiser.cjs',
    '--output-type',
    'err',
  ]);

  rmSync(FIXTURE, { recursive: true, force: true });

  if (resultado.status === 0) {
    console.error('\naudit:arch  FALLO — la autocomprobacion no detecto la violacion.');
    console.error('  Se creo un archivo de `domain` que importa `infrastructure` y depcruise salio 0.');
    console.error('  Eso significa que la configuracion no esta analizando lo que cree analizar:');
    console.error('  revisa `exclude`, `includeOnly` y los globs de .dependency-cruiser.cjs.');
    return false;
  }

  return true;
}

/** @param {string} ruta */
function normalizar(ruta) {
  return ruta.split('\\').join('/');
}

const guardianOk = autocomprobar();
if (!guardianOk) process.exit(1);

const proyectoOk = analizarProyecto();
if (!proyectoOk) {
  console.error('\naudit:arch  FALLO — hay imports que violan la regla de dependencia (CLAUDE.md §2).');
  process.exit(1);
}

console.log('audit:arch  OK — reglas de capa respetadas y guardian verificado');
