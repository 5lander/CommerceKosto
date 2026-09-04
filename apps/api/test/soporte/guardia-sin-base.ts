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

import net from 'node:net';
import { afterAll, beforeAll } from 'vitest';

const PUERTO_POSTGRES_POR_DEFECTO = 5432;
const PUERTO_VIGILADO = Number(process.env['POSTGRES_PORT'] ?? PUERTO_POSTGRES_POR_DEFECTO);

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
    if (puerto === PUERTO_VIGILADO) throw new Error(mensaje(puerto));
    return conexionOriginal.apply(this, args);
  };

  net.Socket.prototype.connect = interceptar as typeof conexionOriginal;
});

afterAll(() => {
  net.Socket.prototype.connect = conexionOriginal;
});
