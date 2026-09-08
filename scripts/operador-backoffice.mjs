/**
 * `npm run operador:backoffice -- <correo>` — da de alta un operador.
 *
 * NO HAY ENDPOINT DE ALTA, y es la decisión de seguridad de este script. Un
 * back office que puede crear operadores desde su propia API es un back office
 * donde una sesión robada se convierte en acceso permanente: el atacante se crea
 * el suyo y ya no necesita la sesión. Aquí el alta exige estar en la máquina y
 * tener las credenciales de superusuario de PostgreSQL.
 *
 * LA CONTRASEÑA SE LEE POR STDIN Y NO SE IMPRIME. Pasarla como argumento la
 * dejaría en el historial del shell y en la tabla de procesos, donde la ve
 * cualquiera que corra `ps`.
 *
 * EL HASH LO CALCULA `dist/hashear.js`, que usa el `Argon2Hasher` real: los
 * parámetros de Argon2 viven en un solo sitio. Duplicarlos aquí sería tener dos,
 * y una acabaría siendo la débil.
 */

import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

import { RAIZ, conexionDeSuperusuario, exigir } from './lib/entorno.mjs';
import { hashDe } from './lib/hashear.mjs';
import { consultar } from './lib/psql.mjs';

const SALIDA_CON_ERROR = 1;


/** El mismo mínimo que SEGURIDAD.md §2.1 exige a un usuario de la aplicación. */
const MINIMO_DE_CONTRASENA = 12;

const SQL_ALTA = `
  INSERT INTO backoffice_user (email, password_hash, status)
  VALUES (:'correo', :'hash', 'ACTIVE')
`;

const USO = 'Uso: npm run operador:backoffice -- <correo>';

/** @returns {Promise<string>} */
async function leerContrasena() {
  const lector = createInterface({ input: process.stdin });
  process.stdout.write('Contrasena del operador (no se muestra en el historial): ');

  for await (const linea of lector) {
    lector.close();
    return linea.trim();
  }
  return '';
}

async function main() {
  process.loadEnvFile?.(resolve(RAIZ, '.env'));

  const correo = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (correo === undefined || !correo.includes('@')) {
    throw new Error(USO);
  }

  const contrasena = await leerContrasena();
  if (contrasena.length < MINIMO_DE_CONTRASENA) {
    throw new Error(
      `La contrasena necesita al menos ${String(MINIMO_DE_CONTRASENA)} caracteres. ` +
        'Es la llave de todos los tenants a la vez.',
    );
  }

  // Como SUPERUSUARIO y no como `costeo_backoffice`: ese rol tiene SELECT sobre
  // `backoffice_user`, no INSERT, y es a proposito — el back office no se da de
  // alta a si mismo.
  const conexion = new URL(conexionDeSuperusuario());
  conexion.pathname = `/${exigir('POSTGRES_DB')}`;

  consultar({
    conexion: conexion.toString(),
    sql: SQL_ALTA,
    variables: { correo: correo.toLowerCase(), hash: hashDe(contrasena) },
  });

  process.stdout.write(`\nOperador ${correo.toLowerCase()} dado de alta.\n`);
  process.stdout.write('Puede entrar en el back office; ve TODOS los tenants (ADR-017).\n');
}

main().catch((/** @type {unknown} */ error) => {
  process.stderr.write(`\n${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = SALIDA_CON_ERROR;
});
