/**
 * La sonda de los puertos de la base — INC-015, a la tercera vez.
 *
 * Responde a una sola pregunta antes de que nada intente conectarse: ¿contesta
 * en cada puerto lo que las cadenas de conexión creen que contesta? Las tres
 * recurrencias de INC-015 fueron tres respuestas distintas a esa pregunta, todas
 * con los contenedores `healthy` y `docker port` en orden:
 *
 *   1. el puerto directo aceptaba y cortaba sin contestar   → `cortada` / `muda`
 *   2. el puerto directo lo contestaba PgBouncer             → el `StartupMessage` no recibe `R`
 *   3. el 6432 de PgBouncer rechazaba la conexión            → `rechazada` (solo él)
 *
 * Las tres son el estado `rota`. `apagada` es otra cosa —todas rechazadas, la pila
 * sin levantar— y conserva su trato de siempre en `audit:tests`.
 *
 * **ES PURO A PROPÓSITO**: no lee `process.env` ni carga el `.env`. Quien llama
 * decide de dónde salen las cadenas. `doctor` ya tiene el entorno cargado;
 * `audit:tests` NO lo carga, porque las pruebas unitarias no deben ver sus
 * variables, y por eso importar `entorno.mjs` desde aquí —que carga el `.env` al
 * importarse— habría roto esa garantía sin que nada avisara.
 *
 * No autentica en ningún momento ni manda una contraseña.
 */

import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

/** Las cadenas por las que algo entra en la base: la de la app, la directa y la del pooler. */
const CADENAS = ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PGBOUNCER_DATABASE_URL'];

/** La cadena que va SIEMPRE directa a PostgreSQL (ADR-001): el CLI de Prisma no cabe en el pooler. */
const CADENA_DIRECTA = 'MIGRATION_DATABASE_URL';

const ESPERA_MS = 3000;

/**
 * Cuántas veces preguntan a cada puerto los checks que deciden si se corren pruebas.
 *
 * NACE DE UN FALLO REAL, en el commit de P9. Con la base ARRIBA y sana, la sonda
 * agotó su plazo y `audit:tests` se degradó a PARCIAL: el commit pasó sin correr
 * una sola prueba de integración, y en verde. La causa es el atasco del proxy de
 * Docker en Windows (INC-016), que de vez en cuando se traga una conexión entera.
 * Tres intentos separan «no está» de «está y tuvo hipo».
 */
export const INTENTOS_ANTE_EL_PROXY = 3;

/** Lo que dice la ficha, para que el mensaje no se escriba en tres sitios. */
const RECREAR = 'Reenvio de Docker desincronizado (INC-015): npm run db:down && npm run db:up';
const LEVANTAR = 'La pila no esta levantada: npm run db:up';

/**
 * El `SSLRequest` del protocolo: ocho bytes a los que PostgreSQL y PgBouncer
 * contestan con UNA letra, `S` o `N`, antes de pedir credenciales.
 */
const SSL_REQUEST = Buffer.from([0, 0, 0, 8, 0x04, 0xd2, 0x16, 0x2f]);
const RESPUESTAS_AL_SSL = new Set(['S', 'N']);

/** Versión 3.0 del protocolo, tal como va en el `StartupMessage`. */
const PROTOCOLO_3 = 196608;

/** @typedef {'responde' | 'rechazada' | 'cortada' | 'muda'} Sondeo */
/** @typedef {{host: string, puerto: string, cadenas: string[], usuario: string, base: string}} Destino */
/** @typedef {{estado: 'ok' | 'sin-cadenas' | 'apagada' | 'rota', detalle: string, arreglo: string}} Diagnostico */

/**
 * Lee una variable del entorno del proceso y, si no está, del `.env` de la raíz
 * **sin cargarlo**. Es lo que necesita quien no puede tocar `process.env`.
 *
 * @param {string} raiz
 * @returns {(nombre: string) => string | undefined}
 */
export function lectorSinCargar(raiz) {
  const ruta = join(raiz, '.env');
  const archivo = existsSync(ruta) ? parseEnv(readFileSync(ruta, 'utf8')) : {};
  return (nombre) => process.env[nombre] ?? archivo[nombre];
}

/**
 * Los `host:puerto` distintos de las tres cadenas, con qué cadenas llegan a cada uno.
 *
 * @param {(nombre: string) => string | undefined} leer
 * @returns {Map<string, Destino>}
 */
function destinosDeLaBase(leer) {
  /** @type {Map<string, Destino>} */
  const destinos = new Map();
  for (const nombre of CADENAS) {
    const cadena = leer(nombre);
    if (cadena === undefined || cadena === '') continue;
    const url = new URL(cadena);
    const puerto = url.port === '' ? '5432' : url.port;
    const clave = `${url.hostname}:${puerto}`;
    const usuario = decodeURIComponent(url.username);
    const base = url.pathname.replace(/^\//, '');
    const destino = destinos.get(clave) ?? { host: url.hostname, puerto, cadenas: [], usuario, base };
    destino.cadenas.push(nombre);
    if (nombre === CADENA_DIRECTA) Object.assign(destino, { usuario, base });
    destinos.set(clave, destino);
  }
  return destinos;
}

/**
 * Abre una conexión nueva, manda `mensaje` y entrega la primera respuesta.
 *
 * @param {string} host
 * @param {string} puerto
 * @param {Buffer} mensaje
 * @returns {Promise<Buffer | 'rechazada' | 'cortada' | 'muda'>}
 */
function preguntar(host, puerto, mensaje) {
  return new Promise((resolver) => {
    const socket = connect({ host, port: Number(puerto) });
    /** @param {Buffer | 'rechazada' | 'cortada' | 'muda'} resultado */
    const terminar = (resultado) => {
      socket.destroy();
      resolver(resultado);
    };
    socket.setTimeout(ESPERA_MS, () => terminar('muda'));
    socket.once('connect', () => socket.write(mensaje));
    socket.once('data', terminar);
    socket.once('end', () => terminar('cortada'));
    socket.once('error', (/** @type {NodeJS.ErrnoException} */ error) =>
      terminar(error.code === 'ECONNREFUSED' ? 'rechazada' : 'cortada'),
    );
  });
}

/**
 * ¿Habla el protocolo de PostgreSQL quien está en ese puerto?
 *
 * Los `intentos` existen por INC-016: el proxy de Docker en Windows a veces se
 * traga una conexión entera, y una base viva contesta a la segunda. Una apagada
 * rechaza las tres al instante, así que repetir no cuesta nada.
 *
 * @param {string} host
 * @param {string} puerto
 * @param {number} intentos
 * @returns {Promise<Sondeo>}
 */
async function sondear(host, puerto, intentos) {
  /** @type {Sondeo} */
  let ultimo = 'muda';
  for (let intento = 0; intento < intentos; intento += 1) {
    const respuesta = await preguntar(host, puerto, SSL_REQUEST);
    if (typeof respuesta === 'string') {
      ultimo = respuesta;
      continue;
    }
    if (RESPUESTAS_AL_SSL.has(respuesta.subarray(0, 1).toString('latin1'))) return 'responde';
    ultimo = 'cortada';
  }
  return ultimo;
}

/** @param {string} usuario @param {string} base */
function startupMessage(usuario, base) {
  const pares = Buffer.from(`user\0${usuario}\0database\0${base}\0\0`, 'utf8');
  const cabecera = Buffer.alloc(8);
  cabecera.writeInt32BE(cabecera.length + pares.length, 0);
  cabecera.writeInt32BE(PROTOCOLO_3, 4);
  return Buffer.concat([cabecera, pares]);
}

/** El campo `M` (mensaje) de un `ErrorResponse`. @param {Buffer} respuesta */
function mensajeDeError(respuesta) {
  const cuerpo = respuesta.subarray(5);
  for (let i = 0; i < cuerpo.length && cuerpo[i] !== 0; ) {
    const fin = cuerpo.indexOf(0, i + 1);
    if (String.fromCharCode(cuerpo[i] ?? 0) === 'M') return cuerpo.subarray(i + 1, fin).toString('utf8');
    i = fin + 1;
  }
  return '(sin mensaje)';
}

/**
 * La variante que el `SSLRequest` no ve: PgBouncer también contesta esa letra.
 *
 * Se manda un `StartupMessage` con el usuario y la base de la cadena directa,
 * **sin contraseña** y **en una conexión nueva** —nunca en la del `SSLRequest`:
 * si el servidor contestó `S`, lo siguiente que espera es TLS—.
 *
 * Medido el 2026-10-03 contra la pila real, con `costeo_migrator`:
 *   - PostgreSQL (5442) contesta `R`, código 10: empieza la negociación SCRAM.
 *   - PgBouncer (6432) contesta `E`, `FATAL 08P01 «bouncer config error»`: no
 *     conoce al rol de migraciones, por diseño (ADR-001).
 *
 * Un `E` no PRUEBA que sea PgBouncer —PostgreSQL también lo manda ante una regla
 * de `pg_hba` o un rol que no existe—, así que el mensaje cita el error tal cual
 * en vez de afirmar quién contestó. Lo que sí está medido es que PostgreSQL, con
 * la cadena buena, contesta `R`: cualquier otra cosa es un entorno roto.
 *
 * Con el rol de la aplicación no serviría: PgBouncer lo conoce y contestaría `R`
 * igual que PostgreSQL. Por eso solo se pregunta por la cadena directa.
 *
 * @param {Destino} destino
 * @returns {Promise<string | null>} el motivo si no contesta PostgreSQL; `null` si sí
 */
async function noContestaPostgres(destino) {
  const respuesta = await preguntar(destino.host, destino.puerto, startupMessage(destino.usuario, destino.base));
  if (typeof respuesta === 'string') return `al presentarse como ${destino.usuario}: ${respuesta}`;
  const tipo = String.fromCharCode(respuesta[0] ?? 0);
  if (tipo === 'R') return null;
  if (tipo === 'E') {
    return `rechaza a ${destino.usuario} antes de autenticar: «${mensajeDeError(respuesta)}» (PostgreSQL contestaria «R»; «bouncer config error» es PgBouncer)`;
  }
  return `respuesta inesperada «${tipo}» a ${destino.usuario}`;
}

/**
 * El diagnóstico entero: ¿se puede entrar en la base por donde dicen las cadenas?
 *
 * @param {(nombre: string) => string | undefined} leer
 * @param {{intentos: number}} opciones
 * @returns {Promise<Diagnostico>}
 */
export async function diagnosticarLaBase(leer, { intentos }) {
  const destinos = destinosDeLaBase(leer);
  if (destinos.size === 0) return { estado: 'sin-cadenas', detalle: 'sin cadenas de conexion', arreglo: '' };

  /** @type {Array<{clave: string, destino: Destino, resultado: Sondeo}>} */
  const sondeos = [];
  for (const [clave, destino] of destinos) {
    sondeos.push({ clave, destino, resultado: await sondear(destino.host, destino.puerto, intentos) });
  }
  const malos = sondeos.filter((s) => s.resultado !== 'responde');
  /** @param {typeof sondeos} grupo */
  const lista = (grupo) => grupo.map((s) => `${s.clave} (${s.destino.cadenas.join(', ')}) ${s.resultado}`).join(' · ');

  if (malos.length === sondeos.length && malos.every((s) => s.resultado === 'rechazada')) {
    return { estado: 'apagada', detalle: lista(malos), arreglo: LEVANTAR };
  }
  if (malos.length > 0) return { estado: 'rota', detalle: lista(malos), arreglo: RECREAR };

  const directo = sondeos.find((s) => s.destino.cadenas.includes(CADENA_DIRECTA));
  const motivo = directo === undefined ? null : await noContestaPostgres(directo.destino);
  if (directo !== undefined && motivo !== null) {
    return { estado: 'rota', detalle: `${directo.clave} (${CADENA_DIRECTA}) ${motivo}`, arreglo: RECREAR };
  }
  return { estado: 'ok', detalle: `${[...destinos.keys()].join(', ')} contestan; el directo es PostgreSQL`, arreglo: '' };
}
