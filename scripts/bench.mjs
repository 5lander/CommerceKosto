/**
 * `npm run bench` — monta el volumen, mide los presupuestos y recoge los planes.
 *
 * DEUDA PAGADA. Los presupuestos de CLAUDE.md §5 llevaban desde P9 sin un
 * comando que los midiera: se fijaron para P9, se re-fecharon a P10 y P10 los
 * volvio a mover. P15 los paga, y en su primera corrida encontro que el
 * consolidado de diez ubicaciones tardaba 1.399 ms contra un limite de 800.
 *
 * TODO PASA EN UNA BASE APARTE, `costeo_bench`, que este script crea y BORRA.
 * Tres razones, las tres duras:
 *
 *   1. La base de desarrollo no crece con 220.000 movimientos que nadie queria
 *      (INC-014, que ya obligo a un `db:reset` una vez).
 *   2. Limpiar el volumen de una base compartida exigiria `DELETE` sobre el
 *      libro de inventario, que es exactamente lo que R3 prohibe y lo que
 *      `audit:forbidden` caza. Soltar una base entera no es un DELETE.
 *   3. Un `VACUUM ANALYZE` sobre datos de verdad cambiaria los planes del
 *      entorno de desarrollo por un efecto colateral de medir.
 *
 * NO SE INTERPOLA NADA EN NINGUN SQL. El nombre de la base viaja como `:"base"`,
 * que psql entrecomilla COMO IDENTIFICADOR —el mismo patron que `migrate-verify`
 * usa desde P0— y el hash de la contrasena como `:'hash'`, que psql escapa como
 * literal. Ninguna cadena de SQL se arma concatenando.
 *
 * Y LA BASE NUEVA RECIBE `grants.sql` ANTES DE MIGRAR, que no es un detalle: los
 * privilegios por defecto solo alcanzan a las tablas que se creen DESPUES de
 * declararlos. Al reves, `costeo_app` se queda sin permiso sobre nada y el
 * medidor mediria una base que no se parece a produccion.
 *
 * `--conservar` deja la base en pie con sus credenciales impresas, para
 * reproducir a mano lo que se acabe de medir.
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { RAIZ, conexionDeSuperusuario, exigir } from './lib/entorno.mjs';
import { correr, correrCli } from './lib/proceso.mjs';
import { aplicarSql, consultar } from './lib/psql.mjs';

const SALIDA_CON_ERROR = 1;

const BASE_BENCH = 'costeo_bench';
const SQL_SOLTAR = 'DROP DATABASE IF EXISTS :"base" WITH (FORCE)';
const SQL_CREAR = 'CREATE DATABASE :"base" OWNER costeo_migrator';

const RUTA_GRANTS = resolve(RAIZ, 'docker', 'postgres', 'initdb', 'sql', 'grants.sql');
const RUTA_VOLUMEN = resolve(RAIZ, 'scripts', 'lib', 'volumen.sql');
const RUTA_INFORME = resolve(RAIZ, 'docs', 'pasos', 'P15');
const RUTA_MEDIDOR = resolve(RAIZ, 'apps', 'api', 'dist', 'bench.js');
const RUTA_HASHEADOR = resolve(RAIZ, 'apps', 'api', 'dist', 'hashear.js');

const MS_POR_SEGUNDO = 1000;
const BYTES_DE_CONTRASENA = 24;
const ANCHO_DEL_RECUENTO = 18;

/**
 * Las diez sentencias mas caras de la corrida.
 *
 * ES LO QUE CLAUDE.md §8 PIDE —«EXPLAIN ANALYZE de consultas nuevas»— sin que
 * nadie tenga que adivinar cual es la consulta critica: `pg_stat_statements` la
 * senala sola, ordenada por tiempo TOTAL, que es la que de verdad duele. Una de
 * 3 ms que corre mil veces pesa mas que una de 200 ms que corre una, y es
 * exactamente asi como se encontro la repeticion del consolidado.
 */
const SQL_MAS_CARAS = `
  SELECT round(total_exec_time::numeric)::text || ' ms totales, ' ||
         calls::text || ' llamadas, ' ||
         round(mean_exec_time::numeric, 2)::text || ' ms de media' AS resumen,
         query
  FROM pg_stat_statements
  WHERE dbid = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND query NOT LIKE '%pg_stat_statements%'
  ORDER BY total_exec_time DESC
  LIMIT 10
`;

const SQL_REINICIAR_ESTADISTICAS = 'SELECT pg_stat_statements_reset()';

/**
 * Sin esto el planificador trabaja con estimaciones de tabla vacia y elige
 * planes que no son los de produccion. Medir antes de `ANALYZE` es medir otro
 * sistema. Va fuera de la transaccion del volumen porque `VACUUM` no puede
 * correr dentro de una.
 */
const SQL_ANALIZAR = 'VACUUM ANALYZE';

const SQL_RECUENTOS = `
  SELECT 'movimientos' AS que, count(*)::text FROM inventory_movement
  UNION ALL SELECT 'lineas de receta', count(*)::text FROM recipe_line
  UNION ALL SELECT 'items', count(*)::text FROM item
  UNION ALL SELECT 'productos', count(*)::text FROM product
  UNION ALL SELECT 'ventas', count(*)::text FROM product_sales
`;

/** @param {string} conexion @param {string} base @returns {string} */
function apuntandoA(conexion, base) {
  const url = new URL(conexion);
  url.pathname = `/${base}`;
  return url.toString();
}


/** @param {string} texto */
function anunciar(texto) {
  process.stdout.write(`\n· ${texto}\n`);
}

/**
 * El hash de la contrasena de bench, calculado con el hasher REAL.
 *
 * No se copia un hash a mano en el SQL del volumen: los parametros de Argon2id
 * viven en un solo sitio (`Argon2Hasher`) y duplicarlos aqui seria tener dos
 * verdades que un dia dejarian de coincidir.
 *
 * @param {string} contrasena
 * @returns {string}
 */
function hashDe(contrasena) {
  const resultado = correr(process.execPath, [RUTA_HASHEADOR], {
    cwd: RAIZ,
    encoding: 'utf8',
    input: contrasena,
  });

  if (resultado.status !== 0) {
    throw new Error(`No se pudo calcular el hash: ${resultado.stderr ?? ''}`);
  }
  return String(resultado.stdout).trim();
}

/**
 * Base nueva con EXACTAMENTE los privilegios de produccion, antes de migrar.
 *
 * @param {{administrativa: string, supervisora: string}} conexiones
 */
function crearLaBase({ administrativa, supervisora }) {
  anunciar(`Creando ${BASE_BENCH} desde cero, con los privilegios de produccion`);

  consultar({ conexion: administrativa, sql: SQL_SOLTAR, variables: { base: BASE_BENCH } });
  consultar({ conexion: administrativa, sql: SQL_CREAR, variables: { base: BASE_BENCH } });

  // Como superusuario: `grants.sql` registra extensiones, y eso el migrator no
  // puede hacerlo. Es el mismo camino que `migrate-verify`.
  aplicarSql({
    conexion: supervisora,
    sql: readFileSync(RUTA_GRANTS, 'utf8'),
    descripcion: 'los privilegios de produccion',
  });
}

/** @param {string} migrador */
function migrar(migrador) {
  anunciar('Aplicando las migraciones');

  const migradas = correrCli('prisma', ['migrate', 'deploy'], {
    cwd: resolve(RAIZ, 'apps', 'api'),
    // `prisma.config.ts` lee MIGRATION_DATABASE_URL, no DATABASE_URL: el CLI es
    // SIEMPRE costeo_migrator, y esa separacion es la Barrera 1.
    env: { ...process.env, MIGRATION_DATABASE_URL: migrador },
    stdio: 'inherit',
  });

  if (migradas.status !== 0) throw new Error('Las migraciones no se aplicaron.');
}

/** @param {string} migrador */
function sembrar(migrador) {
  anunciar('Sembrando el volumen sintetico (tarda; son ~220.000 movimientos)');
  const arranque = Date.now();

  aplicarSql({
    conexion: migrador,
    sql: readFileSync(RUTA_VOLUMEN, 'utf8'),
    descripcion: 'el volumen sintetico',
  });
  consultar({ conexion: migrador, sql: SQL_ANALIZAR });

  const segundos = Math.round((Date.now() - arranque) / MS_POR_SEGUNDO);
  process.stdout.write(`  sembrado en ${String(segundos)} s\n`);

  for (const linea of consultar({ conexion: migrador, sql: SQL_RECUENTOS }).split('\n')) {
    const [que, cuantos] = linea.split('|');
    process.stdout.write(`  ${String(que).padEnd(ANCHO_DEL_RECUENTO)} ${String(cuantos)}\n`);
  }
}

/**
 * Deja una contrasena utilizable y devuelve cual es.
 *
 * El volumen siembra un hash invalido a proposito, para que la base sembrada no
 * abra nada por si sola. La que sirve se genera aqui, al azar, y vive lo que
 * dura la corrida.
 *
 * @param {string} migrador
 * @returns {string}
 */
function ponerContrasena(migrador) {
  anunciar('Poniendo una contrasena de bench con el hasher real');

  const contrasena = randomBytes(BYTES_DE_CONTRASENA).toString('base64url');
  consultar({
    conexion: migrador,
    sql: "UPDATE app_user SET password_hash = :'hash'",
    variables: { hash: hashDe(contrasena) },
  });

  return contrasena;
}

/**
 * Lanza el medidor y dice si paso.
 *
 * `pipe` y no `inherit`: cuando el medidor murio al arrancar por un fallo de
 * inyeccion, `inherit` dejo la causa sin imprimir y el fallo parecio un
 * silencio. Aqui se captura y se vuelca siempre.
 *
 * @param {{aplicacion: string, contrasena: string}} entrada
 * @returns {boolean}
 */
function medir({ aplicacion, contrasena }) {
  anunciar('Midiendo');

  const medida = correr(process.execPath, [RUTA_MEDIDOR], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: aplicacion, COSTEO_BENCH_PASSWORD: contrasena },
  });

  process.stdout.write(String(medida.stdout ?? ''));
  process.stderr.write(String(medida.stderr ?? ''));
  if (medida.error !== undefined) process.stderr.write(`spawn: ${String(medida.error)}\n`);

  return medida.status === 0;
}

/** @param {{administrativa: string, aplicacion: string, contrasena: string}} entrada */
function cerrar({ administrativa, aplicacion, contrasena }) {
  if (process.argv.includes('--conservar')) {
    anunciar(`${BASE_BENCH} se conserva para inspeccion.`);
    process.stdout.write(`  DATABASE_URL=${aplicacion}\n`);
    process.stdout.write(`  COSTEO_BENCH_PASSWORD=${contrasena}\n`);
    return;
  }

  anunciar(`Soltando ${BASE_BENCH}`);
  consultar({ conexion: administrativa, sql: SQL_SOLTAR, variables: { base: BASE_BENCH } });
}

/** @param {string} salida la salida cruda de `SQL_MAS_CARAS`, una fila por linea */
function escribirInforme(salida) {
  anunciar('Recogiendo las consultas mas caras de la corrida');
  mkdirSync(RUTA_INFORME, { recursive: true });
  const destino = resolve(RUTA_INFORME, 'CONSULTAS-MAS-CARAS.md');
  const valla = '```';

  const cuerpo = salida
    .split('\n')
    .filter((/** @type {string} */ linea) => linea.trim() !== '')
    .map((/** @type {string} */ linea, /** @type {number} */ indice) => {
      const corte = linea.indexOf('|');
      const encabezado = `### ${String(indice + 1)}. ${linea.slice(0, corte)}`;
      return `${encabezado}\n\n${valla}sql\n${linea.slice(corte + 1)}\n${valla}\n`;
    })
    .join('\n');

  const cabecera = [
    '# P15 · las diez consultas mas caras del volumen',
    '',
    '> Generado por `npm run bench` desde `pg_stat_statements`, ordenado por',
    '> tiempo TOTAL: una consulta de 3 ms que corre mil veces pesa mas que una',
    '> de 200 ms que corre una. Los parametros salen como `$1` porque',
    '> `pg_stat_statements` normaliza, que es justo lo que permite agrupar.',
    '',
    '',
  ].join('\n');

  writeFileSync(destino, cabecera + cuerpo, 'utf8');
  process.stdout.write(`  escrito en ${destino}\n`);
}

function main() {
  process.loadEnvFile?.(resolve(RAIZ, '.env'));

  const superusuario = conexionDeSuperusuario();
  const administrativa = apuntandoA(superusuario, 'postgres');
  const supervisora = apuntandoA(superusuario, BASE_BENCH);
  const migrador = apuntandoA(exigir('MIGRATION_DATABASE_URL'), BASE_BENCH);
  const aplicacion = apuntandoA(exigir('DATABASE_URL'), BASE_BENCH);

  let contrasena = '';
  crearLaBase({ administrativa, supervisora });

  try {
    migrar(migrador);
    sembrar(migrador);
    contrasena = ponerContrasena(migrador);

    consultar({ conexion: supervisora, sql: SQL_REINICIAR_ESTADISTICAS });
    const dentroDePresupuesto = medir({ aplicacion, contrasena });

    escribirInforme(consultar({ conexion: supervisora, sql: SQL_MAS_CARAS }));
    if (!dentroDePresupuesto) process.exitCode = SALIDA_CON_ERROR;
  } finally {
    // NI UN `return` NI UN `throw` AQUI DENTRO: los dos se tragarian el error
    // que venga de arriba, y perder la causa de un fallo para dejar una base en
    // pie seria un mal cambio.
    cerrar({ administrativa, aplicacion, contrasena });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
}
