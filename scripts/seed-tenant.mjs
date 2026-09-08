#!/usr/bin/env node
/**
 * `npm run seed:tenant -- --archivo=<tenant.json>` — crea una company real.
 *
 * ES UN SCRIPT OPERADO, NO UN SEED VERSIONADO, y la diferencia importa:
 * **los datos del cliente no entran al repositorio**. El script vive aqui; el
 * archivo con el nombre de la company, sus ubicaciones y sus usuarios lo
 * escribes tu, fuera del clon, y se va contigo.
 *
 * POR QUE NO ES UN `INSERT` A MANO. Tres cosas que un `psql` no da:
 *
 *   1. **La contrasena se hashea con Argon2id**, el mismo `Argon2Hasher` que
 *      usa el login. Un hash generado de otra manera produce un usuario que no
 *      puede entrar, y se descubre delante del cliente
 *   2. **Comprueba que los roles existen** antes de escribir. `user_role` tiene
 *      clave foranea a `role`, y un rol mal escrito da un `23503` que no dice
 *      cual de las cinco filas estaba mal
 *   3. **Es idempotente por correo**: si el usuario ya existe, no lo duplica.
 *      Volver a lanzarlo tras un fallo a medias no rompe nada
 *
 * NO CREA LOS PARAMETROS DE COSTEO. Los pone el trigger
 * `company_nace_con_ajustes` con los valores semilla de D3 al insertar la
 * company. Insertarlos aqui choca con su clave primaria — y descubrirlo asi es
 * la senal de que la semilla vive donde debe.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { APP, exigir } from './lib/entorno.mjs';
import { correrCli } from './lib/proceso.mjs';
import { consultar } from './lib/psql.mjs';

const SALIDA_CON_ERROR = 1;

const SALTO = '\n';

const ROLES_VALIDOS = ['OWNER', 'ADMIN', 'GERENTE_LOCAL', 'BODEGA', 'LECTURA'];
const TIPOS_DE_UBICACION = ['LOCAL', 'BODEGA'];

/** Los roles que mandan en la company entera y NO llevan ubicacion. */
const ROLES_DE_COMPANY = ['OWNER', 'ADMIN', 'LECTURA'];

/** Lo minimo que la politica de contrasenas de P1 acepta. */
const LARGO_MINIMO = 12;

/** @param {string} nombre */
function argumento(nombre) {
  const prefijo = `--${nombre}=`;
  const encontrado = process.argv.find((a) => a.startsWith(prefijo));
  return encontrado === undefined ? undefined : encontrado.slice(prefijo.length);
}

/** La conexion del MIGRATOR: es quien puede escribir en `company` y `app_user`. */
function conexion() {
  return exigir('MIGRATION_DATABASE_URL');
}

/**
 * El hash Argon2id de una contrasena, producido por el MISMO codigo que el
 * login verifica.
 *
 * Se delega en `dist/hashear.js` y no se hashea aqui para no duplicar los
 * parametros de `Argon2Hasher` —64 MiB, 3 pasadas, 1 hilo, fijados a proposito—.
 * Copiarlos aqui crearia dos fuentes de verdad, y el dia que una cambiara los
 * usuarios sembrados quedarian con un coste distinto al que el login espera.
 *
 * La contrasena va por STDIN y no por argumento: `ps` muestra los argumentos de
 * cualquier proceso a cualquier usuario de la maquina.
 *
 * @param {string} contrasena
 * @returns {string}
 */
function hashear(contrasena) {
  const resultado = correrCli('node', ['dist/hashear.js'], {
    cwd: APP,
    input: contrasena,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (resultado.status !== 0) {
    throw new Error(`No se pudo hashear: ${String(resultado.stderr ?? '')}
Ejecuta antes: npm run build`);
  }
  return String(resultado.stdout).trim();
}

/**
 * El identificador que devuelve un `INSERT ... RETURNING`.
 *
 * `psql -t -A` imprime **tambien la etiqueta del comando** (`INSERT 0 1`) en una
 * segunda linea. Sin quedarse con la primera, el id sale con la etiqueta pegada
 * y la siguiente consulta falla con `invalid input syntax for type uuid` — que
 * apunta al sitio equivocado, porque el uuid esta bien y lo que sobra es el
 * texto de al lado.
 *
 * @param {string} salida
 * @returns {string}
 */
function primeraLinea(salida) {
  return salida.split(SALTO)[0]?.trim() ?? '';
}

/**
 * Los problemas de una UBICACION del archivo.
 * @param {number} i @param {Record<string, unknown>} u @returns {string[]}
 */
function problemasDeUbicacion(i, u) {
  const problemas = [];
  if (typeof u['nombre'] !== 'string' || u['nombre'].trim() === '') {
    problemas.push(`ubicaciones[${String(i)}]: falta "nombre"`);
  }
  if (!TIPOS_DE_UBICACION.includes(String(u['tipo']))) {
    problemas.push(`ubicaciones[${String(i)}]: "tipo" tiene que ser ${TIPOS_DE_UBICACION.join(' o ')}`);
  }
  return problemas;
}

/**
 * Los problemas de un USUARIO del archivo.
 *
 * Las dos ultimas comprobaciones son las que mas cuestan de depurar si faltan:
 * un rol de ubicacion SIN ubicacion es un usuario que no puede hacer nada, y uno
 * de company CON ubicacion es una contradiccion que la base acepta sin rechistar.
 *
 * @param {number} i @param {Record<string, unknown>} u @returns {string[]}
 */
function problemasDeUsuario(i, u) {
  const problemas = [];
  const rol = String(u['rol']);
  const deCompany = ROLES_DE_COMPANY.includes(rol);

  if (typeof u['correo'] !== 'string' || !u['correo'].includes('@')) {
    problemas.push(`usuarios[${String(i)}]: "correo" no es un correo`);
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    problemas.push(`usuarios[${String(i)}]: "rol" tiene que ser uno de ${ROLES_VALIDOS.join(', ')}`);
  }
  if (typeof u['contrasena'] !== 'string' || u['contrasena'].length < LARGO_MINIMO) {
    problemas.push(`usuarios[${String(i)}]: "contrasena" de al menos ${String(LARGO_MINIMO)} caracteres`);
  }
  if (!deCompany && typeof u['ubicacion'] !== 'string') {
    problemas.push(`usuarios[${String(i)}]: el rol ${rol} necesita "ubicacion"`);
  }
  if (deCompany && u['ubicacion'] !== undefined) {
    problemas.push(`usuarios[${String(i)}]: el rol ${rol} manda en toda la company y no lleva "ubicacion"`);
  }
  return problemas;
}

/**
 * Valida el archivo ANTES de escribir una sola fila.
 *
 * Es la misma forma que los lotes de P10: revisar todo, y solo despues tocar la
 * base. Un tenant creado a medias —company si, usuarios no— es peor que ninguno,
 * porque parece que funciono.
 *
 * @param {Record<string, unknown>} datos
 */
function exigirValido(datos) {
  const ubicaciones = Array.isArray(datos['ubicaciones']) ? datos['ubicaciones'] : [];
  const usuarios = Array.isArray(datos['usuarios']) ? datos['usuarios'] : [];

  const problemas = [
    typeof datos['company'] === 'string' && datos['company'].trim() !== ''
      ? []
      : ['falta "company" (el nombre comercial)'],
    ubicaciones.length === 0 ? ['falta "ubicaciones" con al menos una'] : [],
    usuarios.length === 0 ? ['falta "usuarios" con al menos uno'] : [],
    ...ubicaciones.map((u, i) => problemasDeUbicacion(i, u)),
    ...usuarios.map((u, i) => problemasDeUsuario(i, u)),
  ].flat();

  if (problemas.length > 0) {
    const detalle = problemas.map((p) => `  ${p}`).join(SALTO);
    throw new Error(`El archivo del tenant no es valido:${SALTO}${detalle}`);
  }
}

/**
 * LAS CUATRO CONSULTAS DE ESTE ARCHIVO PASAN LOS VALORES COMO VARIABLES DE
 * `psql`, con `:'nombre'`, y NUNCA interpolados en la cadena.
 *
 * Es el mismo patron que `docker/postgres/initdb/sql/roles.sql` usa desde P0:
 * psql entrecomilla y escapa la variable. Una version anterior escapaba a mano
 * con una funcion `literal()`, y `no-sql-interpolado` la paro — con razon:
 * escapar a mano es exactamente lo que esa regla existe para impedir. El nombre
 * de una company de un cliente puede llevar comillas, y el que lo escribe no
 * tiene por que pensar en SQL.
 *
 * @param {string} conn @param {string} nombre @returns {string}
 */
function crearCompany(conn, nombre) {
  const existente = consultar({
    conexion: conn,
    sql: "SELECT id::text FROM company WHERE name = :'nombre'",
    variables: { nombre },
  });
  if (existente !== '') return existente;

  return primeraLinea(
    consultar({
      conexion: conn,
      sql: "INSERT INTO company (name, status) VALUES (:'nombre', 'ACTIVE') RETURNING id::text",
      variables: { nombre },
    }),
  );
}

/** @param {{conexion: string, companyId: string, ubicacion: {nombre: string, tipo: string}}} p */
function crearUbicacion({ conexion: conn, companyId, ubicacion }) {
  const variables = { company: companyId, nombre: ubicacion.nombre, tipo: ubicacion.tipo };

  const existente = consultar({
    conexion: conn,
    sql: "SELECT id::text FROM location WHERE company_id = :'company'::uuid AND name = :'nombre'",
    variables,
  });
  if (existente !== '') return existente;

  return primeraLinea(
    consultar({
      conexion: conn,
      sql:
        'INSERT INTO location (company_id, name, type, status) VALUES ' +
        "(:'company'::uuid, :'nombre', :'tipo', 'ACTIVE') RETURNING id::text",
      variables,
    }),
  );
}

/** @param {{conexion: string, companyId: string, usuario: Record<string, string>, hash: string, ubicaciones: ReadonlyMap<string, string>}} p */
function crearUsuario({ conexion: conn, companyId, usuario, hash, ubicaciones }) {
  const correo = usuario['correo'] ?? '';
  const rol = usuario['rol'] ?? '';
  const deCompany = ROLES_DE_COMPANY.includes(rol);

  const existente = consultar({
    conexion: conn,
    sql: "SELECT id::text FROM app_user WHERE email = :'correo'",
    variables: { correo },
  });

  const userId =
    existente !== ''
      ? existente
      : primeraLinea(
          consultar({
            conexion: conn,
            sql:
              'INSERT INTO app_user (company_id, email, password_hash, status) VALUES ' +
              "(:'company'::uuid, :'correo', :'hash', 'ACTIVE') RETURNING id::text",
            variables: { company: companyId, correo, hash },
          }),
        );

  // `NULLIF(..., '')` es lo que convierte «sin ubicacion» en NULL sin tener que
  // construir dos sentencias distintas: un rol de company pasa cadena vacia.
  consultar({
    conexion: conn,
    sql:
      'INSERT INTO user_role (company_id, user_id, role_code, location_id, has_location) VALUES ' +
      "(:'company'::uuid, :'usuario'::uuid, :'rol', NULLIF(:'ubicacion', '')::uuid, :'conUbicacion'::boolean) " +
      'ON CONFLICT DO NOTHING',
    variables: {
      company: companyId,
      usuario: userId,
      rol,
      ubicacion: deCompany ? '' : (ubicaciones.get(usuario['ubicacion'] ?? '') ?? ''),
      conUbicacion: String(!deCompany),
    },
  });

  return userId;
}

/**
 * Crea las ubicaciones y devuelve el mapa de nombre a id, que es lo que los
 * usuarios necesitan para colgarse de la suya.
 *
 * @param {string} conn @param {string} companyId
 * @param {readonly {nombre: string, tipo: string}[]} lista
 * @returns {Map<string, string>}
 */
function crearUbicaciones(conn, companyId, lista) {
  const ubicaciones = new Map();

  for (const ubicacion of lista) {
    const id = crearUbicacion({ conexion: conn, companyId, ubicacion });
    ubicaciones.set(ubicacion.nombre, id);
    console.log(`[seed]   ubicacion ${ubicacion.nombre} (${ubicacion.tipo}) -> ${id}`);
  }

  return ubicaciones;
}

/**
 * @param {string} conn @param {string} companyId
 * @param {{usuarios: readonly Record<string, string>[], ubicaciones: ReadonlyMap<string, string>}} datos
 */
function crearUsuarios(conn, companyId, { usuarios, ubicaciones }) {
  for (const usuario of usuarios) {
    const hash = hashear(usuario['contrasena'] ?? '');
    const id = crearUsuario({ conexion: conn, companyId, usuario, hash, ubicaciones });
    console.log(`[seed]   usuario ${usuario['correo']} (${usuario['rol']}) -> ${id}`);
  }
}

function main() {
  const ruta = argumento('archivo');
  if (ruta === undefined) {
    throw new Error(
      'Falta el archivo.\n\n' +
        'Uso: npm run seed:tenant -- --archivo=<ruta>\n\n' +
        'La plantilla y el formato estan en docs/runbooks/despliegue.md.',
    );
  }

  const datos = JSON.parse(readFileSync(resolve(process.cwd(), ruta), 'utf8'));
  exigirValido(datos);

  const conn = conexion();
  const companyId = crearCompany(conn, datos.company);
  console.log(`[seed] company ${datos.company} -> ${companyId}`);

  const ubicaciones = crearUbicaciones(conn, companyId, datos.ubicaciones);
  crearUsuarios(conn, companyId, { usuarios: datos.usuarios, ubicaciones });

  console.log('\n[seed] listo. Anota el id de la company y el de cada ubicacion:');
  console.log(`  --company=${companyId}`);
  for (const [nombre, id] of ubicaciones) console.log(`  --ubicacion=${id}   # ${nombre}`);
  console.log('\nSon los que pide `npm run importar`.');
  console.log('BORRA el archivo del tenant: lleva contrasenas en claro.');
}

try {
  main();
} catch (error) {
  console.error(`
${error instanceof Error ? error.message : String(error)}
`);
  process.exitCode = SALIDA_CON_ERROR;
}
