#!/usr/bin/env node
/**
 * `npm run respaldo` — vuelca la base, RESTAURA lo volcado y compara.
 *
 * POR QUE ESTE SCRIPT NO ES UN `pg_dump` EN UN CRON.
 *
 * «Backup con restauracion PROBADA, no solo configurada. Un backup que nadie ha
 * restaurado nunca no es un backup.» Un `pg_dump | gzip > archivo` en un cron
 * cumple la primera mitad y **finge** la segunda: escribe un archivo todos los
 * dias, no lo lee nunca, y el dia que hace falta se descubre que llevaba ocho
 * meses truncandose porque el disco estaba lleno.
 *
 * Es INC-007 aplicado a lo que menos perdona: un check que pasa en verde sin
 * medir nada. Aqui la verificacion es el trabajo, no un extra:
 *
 *   1. `pg_dump` en formato personalizado
 *   2. `pg_restore --list` sobre lo volcado — si esta truncado, falla aqui
 *   3. **se restaura de verdad** sobre una base desechable
 *   4. **se cuentan las filas de las tablas testigo en las dos** y se comparan
 *   5. se tira la base desechable y se guarda el archivo
 *
 * Si el paso 4 no cuadra, el archivo **no se guarda**. Un respaldo que no
 * restaura no es un respaldo, y guardarlo solo sirve para creer que se tiene.
 *
 * LA TABLA TESTIGO QUE MAS IMPORTA ES `inventory_movement`. El libro es
 * append-only (R3): no se puede reconstruir desde ningun otro sitio, ni desde
 * el Excel del cliente, ni volviendo a importar. Si de ahi falta una fila, el
 * saldo de un item deja de cuadrar para siempre.
 */

import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { RAIZ, conexionDeSuperusuario, opcional } from './lib/entorno.mjs';
import { consultar } from './lib/psql.mjs';
import { listar, restaurar, volcar } from './lib/pgdump.mjs';
import { SQL_DE_RECUENTOS, TABLAS_TESTIGO, comoRecuentos } from './lib/testigos.mjs';

/**
 * La base desechable donde se prueba la restauracion. Se crea y se tira.
 *
 * EL NOMBRE ES UNA CONSTANTE Y EL SQL VA ESCRITO, no interpolado: un nombre de
 * base es un identificador y no se puede pasar como parametro. La respuesta de
 * este proyecto a eso es no tenerlos dinamicos (`no-prisma-raw` lo dice con
 * estas palabras), no abrir una exencion a `no-sql-interpolado`.
 */
const BASE_DE_PRUEBA = 'costeo_verificacion_respaldo';

const SQL_TIRAR_PRUEBA = 'DROP DATABASE IF EXISTS costeo_verificacion_respaldo';
const SQL_CREAR_PRUEBA = 'CREATE DATABASE costeo_verificacion_respaldo';

const MILISEGUNDOS_POR_DIA = 24 * 60 * 60 * 1000;


/**
 * La misma cadena, apuntando a otra base del mismo servidor.
 * @param {string} conexion @param {string} base @returns {string}
 */
function apuntandoA(conexion, base) {
  const url = new URL(conexion);
  url.pathname = `/${base}`;
  return url.toString();
}

/**
 * Restaura el volcado sobre una base desechable y compara los recuentos.
 *
 * @param {{volcado: Buffer, origen: string}} peticion
 * @returns {readonly {tabla: string, original: string, restaurado: string}[]}
 */
function verificarRestaurando({ volcado, origen }) {
  const administrativa = apuntandoA(origen, 'postgres');

  consultar({ conexion: administrativa, sql: SQL_TIRAR_PRUEBA });
  consultar({ conexion: administrativa, sql: SQL_CREAR_PRUEBA });

  try {
    restaurar({ volcado, conexion: origen, base: BASE_DE_PRUEBA });

    const original = comoRecuentos(consultar({ conexion: origen, sql: SQL_DE_RECUENTOS }));
    const copia = comoRecuentos(
      consultar({ conexion: apuntandoA(origen, BASE_DE_PRUEBA), sql: SQL_DE_RECUENTOS }),
    );

    return TABLAS_TESTIGO.map((tabla) => ({
      tabla,
      original: original.get(tabla) ?? '(ausente)',
      restaurado: copia.get(tabla) ?? '(ausente)',
    }));
  } finally {
    // Se tira SIEMPRE, tambien si la comparacion fallo: dejarla puesta ocupa
    // disco y la siguiente corrida chocaria con ella.
    consultar({ conexion: administrativa, sql: SQL_TIRAR_PRUEBA });
  }
}

/** @param {readonly {tabla: string, original: string, restaurado: string}[]} recuentos */
function exigirQueCuadren(recuentos) {
  const descuadres = recuentos.filter((r) => r.original !== r.restaurado);
  if (descuadres.length === 0) return;

  const detalle = descuadres
    .map((r) => `  ${r.tabla}: original ${r.original}, restaurado ${r.restaurado}`)
    .join('\n');

  throw new Error(
    `LA RESTAURACION NO CUADRA. El respaldo NO se ha guardado.\n${detalle}\n\n` +
      'Un respaldo que no restaura no es un respaldo. No lo guardes "por si acaso":\n' +
      'averigua por que falta lo que falta antes de volver a confiar en la cadena.',
  );
}

/**
 * Borra los respaldos mas viejos que la retencion.
 * @param {string} directorio @param {number} dias @returns {number}
 */
function podar(directorio, dias) {
  const limite = Date.now() - dias * MILISEGUNDOS_POR_DIA;
  let borrados = 0;

  for (const nombre of readdirSync(directorio)) {
    if (!nombre.endsWith('.dump')) continue;
    const ruta = join(directorio, nombre);
    if (statSync(ruta).mtimeMs >= limite) continue;
    unlinkSync(ruta);
    borrados += 1;
  }

  return borrados;
}

function marcaDeTiempo() {
  return new Date().toISOString().replace(/[:.]/gu, '-');
}

function main() {
  // LA BASE DE VERDAD, NO LA ADMINISTRATIVA.
  //
  // `conexionDeSuperusuario()` apunta a `postgres` —la base administrativa que
  // existe siempre y que hace falta para crear y tirar otras—, no a la del
  // producto. Volcar esa conexion tal cual **respalda una base vacia**: el
  // volcado sale de 1 KiB y el script muere comparando recuentos porque
  // `inventory_movement` no existe alli.
  //
  // Paso cuando P15 extrajo la funcion a `lib/entorno.mjs` para quitar una
  // duplicacion. `bench` y `restaurar` no lo notaron porque los dos reapuntan a
  // su propia base desechable; este era el unico que usaba la cadena tal cual.
  // Ver INC-019.
  const origen = apuntandoA(conexionDeSuperusuario(), opcional('POSTGRES_DB', 'costeo'));
  const directorio = join(RAIZ, opcional('RESPALDO_DIRECTORIO', '.respaldos'));
  const retencion = Number(opcional('RESPALDO_RETENCION_DIAS', '14'));

  if (!existsSync(directorio)) mkdirSync(directorio, { recursive: true });

  console.log('[respaldo] volcando');
  const volcado = volcar({ conexion: origen });
  console.log(`[respaldo] ${(volcado.byteLength / 1024).toFixed(0)} KiB volcados`);

  console.log('[respaldo] leyendo el volcado sin restaurarlo');
  const entradas = listar({ volcado, conexion: origen }).split('\n').length;
  console.log(`[respaldo] ${String(entradas)} entradas en el indice`);

  console.log(`[respaldo] restaurando sobre ${BASE_DE_PRUEBA} y comparando`);
  const recuentos = verificarRestaurando({ volcado, origen });
  exigirQueCuadren(recuentos);

  for (const r of recuentos) console.log(`[respaldo]   ${r.tabla}: ${r.original} filas, cuadra`);

  const destino = join(directorio, `costeo-${marcaDeTiempo()}.dump`);
  writeFileSync(destino, volcado);
  console.log(`[respaldo] guardado en ${destino}`);

  const borrados = podar(directorio, retencion);
  if (borrados > 0) console.log(`[respaldo] ${String(borrados)} respaldo(s) por encima de la retencion, borrados`);

  console.log('[respaldo] listo — volcado, restaurado y comparado');
}

main();
