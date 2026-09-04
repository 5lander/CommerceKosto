#!/usr/bin/env node
/**
 * `audit:deps` — vulnerabilidades conocidas en las dependencias (AUDITORIA C26).
 *
 * POR QUE NO ES UN `npm audit --audit-level=high` A SECAS. Porque en cuanto una
 * dependencia de desarrollo tiene un aviso que no se puede arreglar, el comando
 * queda en rojo permanente. Y una comprobacion que siempre falla no se arregla:
 * se quita del pipeline, o se ignora su salida, que es peor porque ademas deja
 * de avisar de lo nuevo.
 *
 * Aqui la excepcion es EXPLICITA, esta acotada al aviso concreto, lleva su razon
 * al lado y tiene fecha de revision. Cualquier vulnerabilidad alta o critica que
 * NO este en la lista rompe el build. La comprobacion conserva los dientes.
 *
 * AUDITORIA.md C26 lo contempla: "sin vulnerabilidad alta/critica (`npm audit`
 * en verde o excepcion con ADR)". Estas cuatro estan en ADR-006.
 */

import { correr } from '../../scripts/lib/proceso.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Avisos aceptados, uno a uno.
 *
 * CRITERIO PARA ENTRAR AQUI, y no hay otro: la dependencia **no llega a la
 * imagen de produccion**. `prisma` es el CLI, una devDependency, y el
 * `npm prune --omit=dev` del Dockerfile la deja fuera. `@prisma/client` —que si
 * viaja a produccion— depende unicamente de `@prisma/client-runtime-utils` y no
 * arrastra ninguna de estas.
 *
 * @type {ReadonlyArray<{paquete: string, motivo: string, revisar: string}>}
 */
const ACEPTADAS = [
  {
    paquete: 'mysql2',
    motivo:
      'Llega solo por el CLI de Prisma, que empaqueta drivers de todas las bases. Este proyecto usa ' +
      'PostgreSQL: no hay ninguna conexion MySQL que atacar, y el CLI no viaja a la imagen de produccion.',
    revisar: 'con la evaluacion de Prisma 8 (ADR-002)',
  },
  {
    paquete: 'deepmerge-ts',
    motivo: 'Dependencia de `@prisma/config`, que solo usa el CLI para leer `prisma.config.ts`.',
    revisar: 'con la evaluacion de Prisma 8 (ADR-002)',
  },
  {
    paquete: '@prisma/config',
    motivo: 'Arrastra el aviso de `deepmerge-ts`. Solo la usa el CLI.',
    revisar: 'con la evaluacion de Prisma 8 (ADR-002)',
  },
  {
    paquete: 'prisma',
    motivo: 'Es el CLI. Arrastra los avisos de `mysql2` y `@prisma/config`; no esta en la imagen de produccion.',
    revisar: 'con la evaluacion de Prisma 8 (ADR-002)',
  },
];

const GRAVES = new Set(['high', 'critical']);

/**
 * `npm` en Windows es `npm.cmd`, y desde la mitigacion de CVE-2024-27980 Node
 * se niega a lanzar un `.cmd` sin shell (INC-006). La via fiable es la misma de
 * siempre: resolver el JavaScript real y lanzarlo con `node`.
 *
 * `npm_execpath` lo pone el propio npm al ejecutar un script, y apunta a su
 * `npm-cli.js`. Es la referencia mas fiable que existe: no depende del PATH ni
 * de como este instalado npm.
 */
const NPM = process.env['npm_execpath'];
if (NPM === undefined || NPM === '') {
  console.error('audit:deps  FALLO — no hay `npm_execpath`. Ejecutalo con `npm run audit:deps`.');
  process.exit(1);
}

const resultado = correr(process.execPath, [NPM, 'audit', '--json'], {
  cwd: RAIZ,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
});

const salida = typeof resultado.stdout === 'string' ? resultado.stdout : '';
if (salida.trim() === '') {
  console.error('audit:deps  FALLO — `npm audit` no devolvio nada. ¿Hay red?');
  console.error(String(resultado.stderr ?? ''));
  process.exit(1);
}

/** @type {{vulnerabilities?: Record<string, {severity: string, via: unknown[]}>}} */
let informe;
try {
  informe = JSON.parse(salida);
} catch {
  console.error('audit:deps  FALLO — la salida de `npm audit` no es JSON.');
  process.exit(1);
}

const aceptadas = new Set(ACEPTADAS.map((a) => a.paquete));
const inesperadas = Object.entries(informe.vulnerabilities ?? {})
  .filter(([, v]) => GRAVES.has(v.severity))
  .filter(([nombre]) => !aceptadas.has(nombre));

if (inesperadas.length > 0) {
  console.error(`\naudit:deps  FALLO — ${inesperadas.length} vulnerabilidad(es) alta(s) sin aceptar\n`);
  for (const [nombre, v] of inesperadas) {
    const via = v.via.map((x) => (typeof x === 'string' ? x : String(/** @type {{name?: string}} */ (x).name)));
    console.error(`  [${v.severity}]  ${nombre}   via: ${via.slice(0, 3).join(', ')}`);
  }
  console.error('\n  Arreglalo, o anadela a ACEPTADAS de tools/audit/dependencies.mjs CON SU MOTIVO');
  console.error('  y su fecha de revision. El criterio: no puede llegar a la imagen de produccion.\n');
  process.exit(1);
}

/** Una excepcion que ya no hace falta es ruido: se avisa para retirarla. */
const presentes = new Set(Object.keys(informe.vulnerabilities ?? {}));
const sobrantes = ACEPTADAS.filter((a) => !presentes.has(a.paquete));
for (const s of sobrantes) {
  console.log(`audit:deps  AVISO — "${s.paquete}" ya no tiene aviso: retira su excepcion.`);
}

console.log(`audit:deps  OK — sin vulnerabilidades altas fuera de las ${ACEPTADAS.length} aceptadas y documentadas`);
