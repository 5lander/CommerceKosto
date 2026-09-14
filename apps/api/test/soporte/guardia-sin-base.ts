/**
 * Guardian del criterio arquitectonico de CLAUDE.md §2:
 *
 *   "El motor de costeo debe ser ejecutable y probable con la base de datos
 *    apagada. Si para probar el cálculo del costo de un plato hace falta
 *    levantar PostgreSQL, las capas están mal y se arregla antes de seguir."
 *
 * El problema de esa regla es que se cumple sola mientras nadie la rompa, y el
 * dia que alguien la rompe la suite sigue en verde — porque en su maquina la
 * base estaba levantada. Este archivo convierte la regla en un fallo.
 *
 * Intercepta la creacion de sockets TCP durante el proyecto `unit`. Si un test
 * intenta conectar al puerto de PostgreSQL, falla con un mensaje que dice que
 * mirar. No bloquea otros puertos: el objetivo es la dependencia de la base, no
 * prohibir la red en general.
 */

import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { afterAll, beforeAll } from 'vitest';

const PUERTO_POSTGRES_POR_DEFECTO = 5432;

/** Las cadenas por las que una prueba podría llegar a la base: directa o por el pooler. */
const CADENAS_DE_LA_BASE = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PGBOUNCER_DATABASE_URL'] as const;

// `__dirname`, como en `entorno-de-integracion.ts`: la aplicación compila a CommonJS.
const ARCHIVO_ENV = resolve(__dirname, '..', '..', '..', '..', '.env');

/**
 * El `.env` LEÍDO, NO CARGADO. Las unitarias corren sin las variables del
 * archivo y así se quedan: meterlas en `process.env` cambiaría lo que prueban.
 * Solo se miran los puertos.
 */
function variablesDelArchivo(): Record<string, string | undefined> {
  return existsSync(ARCHIVO_ENV) ? parseEnv(readFileSync(ARCHIVO_ENV, 'utf8')) : {};
}

/**
 * **LOS PUERTOS DE LAS CADENAS DE CONEXIÓN, NO UN NÚMERO FIJO.** Hasta el
 * armazón se vigilaba `POSTGRES_PORT ?? 5432` leído de `process.env`, que en las
 * unitarias no trae el `.env`: con la base publicada en otro puerto —para no
 * chocar con otro proyecto de la máquina—, la guardia habría vigilado un puerto
 * donde ya no hay nada, y una prueba que conectara a la base de verdad habría
 * pasado en verde. Es INC-007 con otro disfraz. Se vigila el 5432 de siempre,
 * `POSTGRES_PORT` y el puerto de cada cadena, venga del entorno o del archivo.
 */
function puertosVigilados(): ReadonlySet<number> {
  const archivo = variablesDelArchivo();
  const leer = (nombre: string): string | undefined => process.env[nombre] ?? archivo[nombre];
  const puertos = new Set([PUERTO_POSTGRES_POR_DEFECTO]);

  const declarado = leer('POSTGRES_PORT');
  if (declarado !== undefined && declarado !== '') puertos.add(Number(declarado));

  for (const nombre of CADENAS_DE_LA_BASE) {
    const cadena = leer(nombre);
    if (cadena === undefined || cadena === '') continue;
    const { port } = new URL(cadena);
    puertos.add(port === '' ? PUERTO_POSTGRES_POR_DEFECTO : Number(port));
  }
  return puertos;
}

const PUERTOS_VIGILADOS = puertosVigilados();

const conexionOriginal = net.Socket.prototype.connect;

function mensaje(puerto: number): string {
  return [
    '',
    `Una prueba del proyecto "unit" intento conectar al puerto ${String(puerto)} (PostgreSQL).`,
    '',
    'CLAUDE.md §2: el dominio y los casos de uso se prueban con la base APAGADA.',
    'Si esta prueba necesita una base de datos, no pertenece a "unit":',
    '',
    '  - mueve el archivo a test/integracion/, o',
    '  - renombralo a *.integration.spec.ts, o',
    '  - sustituye la dependencia real por su doble de prueba.',
    '',
    'Que el motor de costeo corra sin base no es una preferencia: es lo que',
    'demuestra que las capas estan bien puestas.',
    '',
  ].join('\n');
}

/**
 * `connect` admite mas formas de las que parece, y una de ellas se le escapaba
 * a este guardian: la que usa `net.connect()`.
 *
 *   socket.connect(puerto, host)          ->  numero
 *   socket.connect({ port, host })        ->  objeto
 *   socket.connect([{ port, host }, cb])  ->  ARRAY  <- por aqui entra net.connect
 *
 * `net.connect(...)` normaliza sus argumentos a un array y se lo pasa tal cual
 * a `Socket.prototype.connect`. Mirando solo las dos primeras formas, el
 * guardian dejaba pasar exactamente la forma mas comoda de escribir —y la que
 * usa `pg` por debajo—, mientras seguia en verde. Lo encontro la prueba del
 * guardian; ver docs/incidencias/INC-007.
 */
function puertoDestino(primerArgumento: unknown): number | undefined {
  if (Array.isArray(primerArgumento)) {
    return puertoDestino(primerArgumento[0]);
  }
  if (typeof primerArgumento === 'number') {
    return primerArgumento;
  }
  if (typeof primerArgumento === 'string') {
    const numero = Number(primerArgumento);
    return Number.isNaN(numero) ? undefined : numero;
  }
  if (typeof primerArgumento === 'object' && primerArgumento !== null && 'port' in primerArgumento) {
    const { port } = primerArgumento as { port?: number | string };
    return port === undefined ? undefined : Number(port);
  }
  return undefined;
}

beforeAll(() => {
  const interceptar = function interceptar(
    this: net.Socket,
    ...args: Parameters<typeof conexionOriginal>
  ): net.Socket {
    const puerto = puertoDestino(args[0]);
    if (puerto !== undefined && PUERTOS_VIGILADOS.has(puerto)) throw new Error(mensaje(puerto));
    return conexionOriginal.apply(this, args);
  };

  net.Socket.prototype.connect = interceptar as typeof conexionOriginal;
});

afterAll(() => {
  net.Socket.prototype.connect = conexionOriginal;
});
