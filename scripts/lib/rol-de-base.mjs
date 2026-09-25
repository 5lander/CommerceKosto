/**
 * El ritual de crear un rol de PostgreSQL en un cluster que YA existe, una
 * sola vez para los dos scripts que lo necesitan (`rol:backoffice` y
 * `rol:despachador`).
 *
 * POR QUE HACE FALTA UN SCRIPT Y NO BASTA `roles.sql`. Los roles son del
 * CLUSTER, no de la base, y `roles.sql` corre una sola vez: cuando el volumen
 * de datos esta vacio. Un cluster que ya estaba en pie —el de desarrollo, y el
 * del VPS en cuanto tenga un solo dato— no vuelve a ejecutarlo nunca. Sin
 * esto, el unico camino seria borrar el volumen.
 *
 * POR QUE NO LO CREA LA MIGRACION. `costeo_migrator` es `NOCREATEROLE`, y
 * ampliarlo seria dar capacidad de crear roles al dueno de todas las tablas
 * para ahorrarse un comando. Cada migracion que estrena un rol comprueba que
 * existe y **falla en alto** si no; estos scripts son la respuesta a ese fallo.
 *
 * ES IDEMPOTENTE, y con un matiz que importa: si el rol ya existe, **no le
 * cambia la contrasena**. Un script de creacion que reescribe credenciales cada
 * vez que se ejecuta es un script que rompe produccion al correrlo por
 * costumbre. Para rotar la contrasena esta `docs/runbooks/rotacion-secretos.md`.
 *
 * La contrasena NO se genera aqui ni se imprime: sale de la variable de
 * entorno que cada script nombra, y viaja como variable de psql (`:'clave'`),
 * nunca interpolada.
 *
 * EL BLOQUE `CREATE ROLE` DE CADA SCRIPT ES EL MISMO QUE EL DE `roles.sql`, y
 * esa duplicacion es deliberada. Leer `roles.sql` y ejecutarlo entero volveria
 * a crear los roles que ya existen y fallaria; partirlo en archivos por rol
 * dejaria el bootstrap del contenedor dependiendo de varios ficheros en orden.
 * `audit:duplication` no lo ve porque son lenguajes distintos: por eso cada
 * script dice en voz alta que si uno cambia, cambia el otro.
 */

import { conexionDeSuperusuario, exigir } from './entorno.mjs';
import { consultar } from './psql.mjs';

const SALIDA_CON_ERROR = 1;

/**
 * @param {{
 *   rol: string,
 *   variableDeClave: string,
 *   sqlCrear: string,
 *   notaAlCrear: string,
 *   notaFinal: string,
 * }} peticion
 */
export function crearRolSiFalta({ rol, variableDeClave, sqlCrear, notaAlCrear, notaFinal }) {
  // El `.env` de la raiz lo carga `entorno.mjs` al importarse, SOLO si existe.
  // Cargarlo aqui otra vez sin esa guarda reventaba con ENOENT en el VPS, donde
  // los secretos viven en /etc/costeo/.env y llegan ya exportados por
  // `desplegar.sh`; el paso de roles de ese script depende de esto.
  const clave = exigir(variableDeClave);
  const base = exigir('POSTGRES_DB');
  const conexion = conexionDeSuperusuario();

  // El nombre del rol es una constante del script que llama, no entrada de
  // usuario; aun asi va como variable de psql, que lo entrecomilla.
  const existe = "SELECT count(*) FROM pg_roles WHERE rolname = :'rol'";
  const yaEsta = consultar({ conexion, sql: existe, variables: { rol } }).trim() !== '0';

  if (yaEsta) {
    process.stdout.write(`${rol} ya existe. No se toca su contrasena.\n`);
  } else {
    consultar({ conexion, sql: sqlCrear, variables: { clave } });
    process.stdout.write(`${rol} creado. ${notaAlCrear}\n`);
  }

  // Conectar a la base concede acceso a nada por si solo: los GRANT de tabla
  // los concede la migracion que estrena el rol.
  const conectar = 'GRANT CONNECT ON DATABASE :"base" TO :"rol"';
  consultar({ conexion, sql: conectar, variables: { base, rol } });
  process.stdout.write(`CONNECT sobre ${base} concedido.\n`);
  process.stdout.write(`${notaFinal}\n`);
}

/** @param {() => void} main */
export function ejecutar(main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = SALIDA_CON_ERROR;
  }
}
