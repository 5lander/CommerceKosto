#!/usr/bin/env node
/**
 * `npm run doctor` — informe del entorno de desarrollo.
 *
 * Existe porque tres de las cuatro incidencias de P0 son del entorno, no del
 * codigo, y las tres se diagnostican mal: los mensajes de error apuntan al
 * lugar equivocado. Este script las detecta ANTES de que cuesten tiempo.
 */

import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';

import { partesDeConexion } from '../scripts/lib/entorno.mjs';
import { correr } from '../scripts/lib/proceso.mjs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {'ok' | 'aviso' | 'fallo'} Estado */
/** @typedef {{estado: Estado, detalle: string, arreglo?: string}} Veredicto */
/** @typedef {Veredicto & {titulo: string}} Resultado */

/** @type {Resultado[]} */
const resultados = [];

/**
 * @param {string} titulo
 * @param {() => Veredicto | Promise<Veredicto>} comprobar
 */
async function revisar(titulo, comprobar) {
  try {
    resultados.push({ titulo, ...(await comprobar()) });
  } catch (error) {
    const detalle = error instanceof Error ? error.message : String(error);
    resultados.push({ titulo, estado: 'fallo', detalle });
  }
}

/** @param {string} comando @param {string[]} args */
function ejecutar(comando, args) {
  return execFileSync(comando, args, {
    cwd: RAIZ,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/** @param {string} comando */
function disponible(comando) {
  const resultado = correr(comando, ['--version'], { stdio: 'ignore' });
  return resultado.error === undefined && resultado.status === 0;
}

await revisar('Node.js', () => {
  const actual = process.versions.node;
  const objetivo = existsSync(join(RAIZ, '.nvmrc'))
    ? readFileSync(join(RAIZ, '.nvmrc'), 'utf8').trim()
    : '(sin .nvmrc)';
  const [major] = actual.split('.');
  if (major !== '24') {
    return {
      estado: 'fallo',
      detalle: `${actual} — se requiere la linea 24 (Active LTS hasta 2028-04-30)`,
      arreglo: `Instala Node ${objetivo}`,
    };
  }
  if (actual !== objetivo) {
    return { estado: 'aviso', detalle: `${actual} — .nvmrc apunta a ${objetivo}` };
  }
  return { estado: 'ok', detalle: actual };
});

await revisar('Docker', () => {
  if (!disponible('docker')) {
    return {
      estado: 'aviso',
      detalle: 'no disponible',
      arreglo: 'Sin Docker no corren las pruebas de integracion ni migrate:verify',
    };
  }
  return { estado: 'ok', detalle: ejecutar('docker', ['--version']) };
});

await revisar('psql (INC-002)', () => {
  if (disponible('psql')) {
    return { estado: 'ok', detalle: `en el PATH — ${ejecutar('psql', ['--version'])}` };
  }
  if (disponible('docker')) {
    return {
      estado: 'ok',
      detalle: 'no esta en el PATH; los scripts caeran a `docker compose exec -T db psql`',
    };
  }
  return {
    estado: 'fallo',
    detalle: 'no hay psql ni Docker',
    arreglo: 'Los scripts de migracion no van a poder aplicar SQL. Levanta Docker.',
  };
});

await revisar('Hooks de git', () => {
  let ruta = '';
  try {
    ruta = ejecutar('git', ['config', '--get', 'core.hooksPath']);
  } catch {
    ruta = '';
  }
  if (ruta !== '.githooks') {
    return {
      estado: 'fallo',
      detalle: ruta ? `core.hooksPath = ${ruta}` : 'core.hooksPath sin configurar',
      arreglo: 'npm run prepare',
    };
  }
  return { estado: 'ok', detalle: '.githooks activo' };
});

await revisar('Finales de linea (INC-001)', () => {
  const salida = ejecutar('git', ['ls-files', '--eol', '--', '.githooks', 'docker']);
  const culpables = salida
    .split('\n')
    .filter(Boolean)
    .filter((linea) => /w\/crlf/.test(linea))
    .map((linea) => linea.split('\t').pop());

  if (culpables.length > 0) {
    return {
      estado: 'fallo',
      detalle: `${culpables.length} archivo(s) POSIX con CRLF: ${culpables.slice(0, 3).join(', ')}`,
      arreglo: 'git add --renormalize .',
    };
  }
  return { estado: 'ok', detalle: 'todo lo POSIX en LF' };
});

await revisar('Version de Prisma fijada (ADR-001)', () => {
  const manifiesto = join(RAIZ, 'apps', 'api', 'package.json');
  if (!existsSync(manifiesto)) return { estado: 'aviso', detalle: 'apps/api/package.json aun no existe' };
  const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(manifiesto, 'utf8'));
  const todas = { ...dependencies, ...devDependencies };
  const flojas = Object.entries(todas)
    .filter(([nombre]) => nombre === 'prisma' || nombre.startsWith('@prisma/'))
    .filter(([, rango]) => /^[\^~><*]/.test(String(rango)));

  if (flojas.length > 0) {
    return {
      estado: 'fallo',
      detalle: `${flojas.map(([n, r]) => `${n}@${r}`).join(', ')}`,
      arreglo: 'El `latest` de npm apunta a un RC. Fija la version exacta 7.10.0.',
    };
  }
  return { estado: 'ok', detalle: `prisma ${todas.prisma ?? '(no declarado)'}` };
});

/**
 * El `SSLRequest` del protocolo de PostgreSQL: ocho bytes a los que cualquier
 * servidor que hable el protocolo —PostgreSQL o PgBouncer— contesta con UNA
 * letra, `S` o `N`, antes de pedir credenciales. No autentica ni abre sesión.
 */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
const RESPUESTAS_DEL_PROTOCOLO = new Set(['S', 'N']);
const ESPERA_MS = 3000;

/**
 * @param {string} host
 * @param {string} puerto
 * @returns {Promise<'responde' | 'rechazada' | 'cortada' | 'muda'>}
 */
function sondear(host, puerto) {
  return new Promise((resolver) => {
    const socket = connect({ host, port: Number(puerto) });
    /** @param {'responde' | 'rechazada' | 'cortada' | 'muda'} resultado */
    const terminar = (resultado) => {
      socket.destroy();
      resolver(resultado);
    };
    socket.setTimeout(ESPERA_MS, () => terminar('muda'));
    socket.once('connect', () => socket.write(SSL_REQUEST));
    socket.once('data', (/** @type {Buffer} */ datos) =>
      terminar(RESPUESTAS_DEL_PROTOCOLO.has(datos.subarray(0, 1).toString('latin1')) ? 'responde' : 'cortada'),
    );
    socket.once('end', () => terminar('cortada'));
    socket.once('error', (/** @type {NodeJS.ErrnoException} */ error) =>
      terminar(error.code === 'ECONNREFUSED' ? 'rechazada' : 'cortada'),
    );
  });
}

/** Los `host:puerto` distintos de las cadenas de conexión del `.env`. */
function destinosDeLaBase() {
  const destinos = new Map();
  for (const nombre of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PGBOUNCER_DATABASE_URL']) {
    const cadena = process.env[nombre];
    if (cadena === undefined || cadena === '') continue;
    const { host, puerto } = partesDeConexion(cadena);
    destinos.set(`${host}:${puerto}`, { host, puerto });
  }
  return destinos;
}

/*
 * INC-015, a la segunda vez. EL CONTENEDOR SANO NO DICE NADA del puerto del host:
 * tras reiniciar Docker Desktop, el reenvío de 5432 quedó aceptando conexiones y
 * cerrándolas sin contestar —`Connection terminated unexpectedly`— con la base
 * `healthy` y `docker port` en orden. Se pregunta al puerto, que es por donde
 * entran las pruebas.
 *
 * LO QUE NO CUBRE: la primera variante de INC-015, el 5432 que llega a PgBouncer.
 * PgBouncer también habla el protocolo y contesta la misma letra; distinguirlos
 * exige autenticarse, y eso ya es una prueba de integración, no un informe.
 */
await revisar('Puertos de la base (INC-015)', async () => {
  const destinos = destinosDeLaBase();
  if (destinos.size === 0) return { estado: 'aviso', detalle: 'sin cadenas de conexion en .env' };

  const malos = [];
  for (const [clave, { host, puerto }] of destinos) {
    const resultado = await sondear(host, puerto);
    if (resultado !== 'responde') malos.push(`${clave} ${resultado}`);
  }
  if (malos.length === 0) return { estado: 'ok', detalle: `${[...destinos.keys()].join(', ')} contestan` };

  return {
    estado: 'fallo',
    detalle: malos.join(' · '),
    arreglo: malos.every((malo) => malo.endsWith('rechazada'))
      ? 'La pila no esta levantada: docker compose up -d db pgbouncer'
      : 'Reenvio de Docker desincronizado: docker compose down && docker compose up -d db pgbouncer',
  };
});

const ICONO = { ok: '  OK  ', aviso: ' AVISO', fallo: ' FALLO' };

console.log('\ncosteo-saas — informe del entorno\n');
for (const { titulo, estado, detalle, arreglo } of resultados) {
  console.log(`[${ICONO[estado]}]  ${titulo.padEnd(30)} ${detalle}`);
  if (arreglo) console.log(`${' '.repeat(42)}-> ${arreglo}`);
}

const fallos = resultados.filter((r) => r.estado === 'fallo').length;
console.log(fallos === 0 ? '\nEntorno listo.\n' : `\n${fallos} problema(s) que arreglar.\n`);
process.exit(fallos === 0 ? 0 : 1);
