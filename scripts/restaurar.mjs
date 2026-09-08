#!/usr/bin/env node
/**
 * `npm run restaurar -- <archivo.dump>` — restaura un respaldo.
 *
 * ES EL COMANDO QUE SE EJECUTA A LAS ONCE DE LA NOCHE, y por eso hace tres
 * cosas que un `pg_restore` a pelo no hace:
 *
 *   1. **Nunca puede escribir sobre la base de produccion.** El destino es una
 *      constante. El error caro no es teclear mal el nombre del archivo: es
 *      restaurar sobre la base buena creyendo que se restauraba sobre una copia
 *   2. **Lee el indice del archivo ANTES de crear nada**: si esta truncado, se
 *      sabe sin haber tocado la base
 *   3. **Cuenta las filas de las tablas testigo al terminar** y las imprime. Un
 *      `pg_restore` silencioso que devuelve 0 no dice si dentro hay algo
 *
 * NO RESTAURA «ENCIMA». Si la base destino ya tiene tablas, `pg_restore` fallara
 * con `--exit-on-error` en el primer objeto duplicado. Es deliberado: mezclar
 * un respaldo con datos vivos produce una base que no es ni lo uno ni lo otro,
 * y ademas el libro de inventario es append-only y no se puede limpiar.
 * Para rehacer una base: tirala y vuelve a crearla.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { exigir, opcional } from './lib/entorno.mjs';
import { consultar } from './lib/psql.mjs';
import { listar, restaurar } from './lib/pgdump.mjs';
import { SQL_DE_RECUENTOS, TABLAS_TESTIGO, comoRecuentos } from './lib/testigos.mjs';

const SALIDA_CON_ERROR = 1;

/**
 * EL DESTINO ES FIJO, y eso es la decision de este archivo.
 *
 * Una version anterior aceptaba `--base=<nombre>`. Un nombre de base es un
 * IDENTIFICADOR: no se puede pasar como parametro en SQL, asi que aceptarlo del
 * usuario obliga a interpolarlo — que es inyeccion, y que `no-sql-interpolado`
 * caza con razon. Escaparlo a mano seria fingir que se arreglo.
 *
 * La respuesta de este proyecto a un identificador dinamico es **no tenerlo**.
 * Si hace falta otro nombre, se restaura aqui y se renombra despues:
 *
 *   ALTER DATABASE costeo_restaurado RENAME TO costeo_20260908;
 */
const BASE_RESTAURADA = 'costeo_restaurado';

const SQL_CREAR_RESTAURADA = 'CREATE DATABASE costeo_restaurado';

function conexionDeSuperusuario() {
  const usuario = opcional('POSTGRES_SUPERUSER', 'postgres');
  const contrasena = exigir('POSTGRES_SUPERUSER_PASSWORD');
  const credencial = `${encodeURIComponent(usuario)}:${encodeURIComponent(contrasena)}`;
  const host = opcional('POSTGRES_HOST', 'localhost');
  const puerto = opcional('POSTGRES_PORT', '5432');

  return `postgresql://${credencial}@${host}:${puerto}/${opcional('POSTGRES_DB', 'costeo')}`;
}

/** @param {string} conexion @param {string} base */
function apuntandoA(conexion, base) {
  const url = new URL(conexion);
  url.pathname = `/${base}`;
  return url.toString();
}

function main() {
  const archivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (archivo === undefined) {
    throw new Error('Falta el archivo.\n\nUso: npm run restaurar -- <archivo.dump> [--base=<destino>] [--si]');
  }

  const ruta = resolve(process.cwd(), archivo);
  if (!existsSync(ruta)) throw new Error(`No existe el archivo "${ruta}".`);

  const conexion = conexionDeSuperusuario();
  const volcado = readFileSync(ruta);
  console.log(`[restaurar] ${(volcado.byteLength / 1024).toFixed(0)} KiB leidos de ${archivo}`);

  // Se lee el indice ANTES de tocar la base: si el archivo esta corrupto, se
  // sabe sin haber creado nada.
  const entradas = listar({ volcado, conexion }).split('\n').length;
  console.log(`[restaurar] ${String(entradas)} entradas en el indice — el archivo se puede leer`);

  const administrativa = apuntandoA(conexion, 'postgres');
  consultar({ conexion: administrativa, sql: SQL_CREAR_RESTAURADA });
  console.log(`[restaurar] base ${BASE_RESTAURADA} creada`);

  restaurar({ volcado, conexion, base: BASE_RESTAURADA });

  const copia = apuntandoA(conexion, BASE_RESTAURADA);
  const recuentos = comoRecuentos(consultar({ conexion: copia, sql: SQL_DE_RECUENTOS }));
  for (const tabla of TABLAS_TESTIGO) {
    console.log(`[restaurar]   ${tabla}: ${recuentos.get(tabla) ?? '(ausente)'} filas`);
  }

  console.log(`[restaurar] listo — ${BASE_RESTAURADA} restaurada y contada`);
}

try {
  main();
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
}
