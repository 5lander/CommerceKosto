/**
 * `npm run importar` — la migración de un catálogo, operada desde la terminal.
 *
 * **POR QUÉ UN COMANDO Y NO UNA PANTALLA.** Con un cliente, cargar su catálogo
 * es algo que pasa una vez. Construir subida, previsualización y confirmación en
 * dos pasos para eso sería construir un producto que nadie ha pedido todavía
 * (OPTIMIZACION.md §1). Lo que sí se construyó entero es lo que no caduca: la
 * escritura en lote atómica, que sirve igual a la pantalla del día que exista.
 *
 * **LA SESIÓN SE ABRE CON LA CONTRASEÑA DEL USUARIO, POR EL MISMO CAMINO QUE EL
 * LOGIN.** Es la decisión de seguridad de este archivo, y la alternativa era
 * peor: un atajo que fabricara una sesión sin credenciales sería una puerta que
 * no existe en ningún otro sitio del sistema, y bastaría con que alguien la
 * expusiera un día por HTTP. Así no hay puerta nueva — hay el mismo `IniciarSesion`
 * que usa el navegador, con su bloqueo por intentos y su registro en `audit_log`.
 *
 * **NO CORRE CONTRA PRODUCCIÓN SIN DECIRLO EN VOZ ALTA.** Ver `exigirEntorno`.
 *
 * Se ejecuta desde `dist/`, nunca desde el fuente: `apps/api` es
 * `"type": "commonjs"` con imports sin extensión, y Node trata un `.ts` como
 * ESM. Es INC-017, y es la misma razón por la que el parser acabó en `.mjs`.
 */

import 'reflect-metadata';

import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';

import { AppModule } from './app.module';
import { escribir, imprimirAnalisis, imprimirDesenlace } from './cli/informe';
import { leerOpciones, USO, type OpcionesDeImportacion } from './cli/opciones';
import { ImportarArchivo } from './modules/imports/application/casos-de-uso/importar';
import { IniciarSesion } from './modules/iam/application/casos-de-uso/iniciar-sesion';
import {
  ValidarSesion,
  type SesionActiva,
} from './modules/iam/application/casos-de-uso/validar-sesion';
import { loadConfiguration } from './shared/infrastructure/config/environment';
import type { CompanyId, LocationId } from './shared/domain/identity/identificadores';

const PERMISO_DE_IMPORTACION = 'import.write';

const VARIABLE_DE_CONTRASENA = 'COSTEO_IMPORT_PASSWORD';

const ENTORNO_DE_PRODUCCION = 'production';

/** El mediodía UTC: el mismo día natural en toda América (INC-013). */
const MEDIODIA_UTC = 'T12:00:00.000Z';

const SALIDA_CON_ERROR = 1;

/** `node dist/cli.js` ocupa los dos primeros de `argv`; lo demas es del usuario. */
const ARGUMENTOS_DEL_USUARIO = 2;

function cargarArchivoDeEntorno(): void {
  try {
    process.loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));
  } catch {
    // Sin `.env`: se usan las variables que ya estén en el entorno.
  }
}

/**
 * **LA GUARDA DE PRODUCCIÓN.**
 *
 * Un importador que escribe cientos de filas de golpe no debe poder correr
 * contra la base de un cliente por descuido — un `--company` copiado del portal
 * equivocado basta. Pero el catálogo del cliente hay que cargarlo *en*
 * producción, así que negarse siempre no es una política: es un problema
 * aplazado hasta el día del despliegue.
 *
 * La salida es explícita y ruidosa: `--operacion-supervisada` levanta la
 * negativa, exige además `--confirmar`, e imprime contra qué base va a escribir
 * antes de hacerlo. El procedimiento está en `docs/runbooks/despliegue.md`.
 */
function exigirEntorno(opciones: OpcionesDeImportacion, urlDeLaBase: string): void {
  if (process.env['NODE_ENV'] !== ENTORNO_DE_PRODUCCION) return;

  if (!opciones.operacionSupervisada) {
    throw new Error(
      'Este comando no corre contra producción por defecto. Si es lo que quieres, añade ' +
        '--operacion-supervisada y lee antes docs/runbooks/despliegue.md.',
    );
  }

  escribir('');
  escribir('*** OPERACIÓN SUPERVISADA CONTRA PRODUCCIÓN ***');
  escribir(`Base:    ${sinCredenciales(urlDeLaBase)}`);
  escribir(`Company: ${opciones.company}`);
  escribir(`Usuario: ${opciones.usuario}`);
}

/** La cadena de conexión sin usuario ni contraseña: se imprime, y se lee. */
function sinCredenciales(url: string): string {
  return url.replace(/\/\/[^@]*@/u, '//');
}

async function abrirSesion(
  app: INestApplicationContext,
  opciones: OpcionesDeImportacion,
): Promise<SesionActiva> {
  const contrasena = process.env[VARIABLE_DE_CONTRASENA];
  if (contrasena === undefined || contrasena === '') {
    throw new Error(`Falta la variable de entorno ${VARIABLE_DE_CONTRASENA}.`);
  }

  const abierta = await app.get(IniciarSesion).ejecutar({
    email: opciones.usuario,
    contrasena,
    ip: null,
    userAgent: null,
  });

  const sesion = await app.get(ValidarSesion).ejecutar(abierta.token);

  if (sesion.companyId !== (opciones.company as CompanyId)) {
    throw new Error('El usuario no pertenece a esa company.');
  }
  if (!sesion.permisos.includes(PERMISO_DE_IMPORTACION)) {
    throw new Error(`El usuario no tiene el permiso ${PERMISO_DE_IMPORTACION}.`);
  }

  return sesion;
}

async function importar(
  app: INestApplicationContext,
  sesion: SesionActiva,
  opciones: OpcionesDeImportacion,
): Promise<void> {
  const ruta = resolve(process.cwd(), opciones.archivo);
  const bytes = await readFile(ruta);

  const resultado = await app.get(ImportarArchivo).ejecutar(sesion, {
    tipo: opciones.tipo,
    bytes,
    nombreOriginal: basename(ruta),
    // El archivo no se guarda: vive en el disco del operador y su nombre queda
    // en `original_name`. La clave es la identidad del trabajo, no un puntero.
    claveDeAlmacenamiento: randomUUID(),
    locationId: opciones.ubicacion as LocationId,
    confirmar: opciones.confirmar,
    confirmarPrecios: opciones.confirmarPrecios,
    vigenciaDesde: vigenciaDe(opciones),
  });

  imprimirAnalisis(resultado.analisis, resultado.id);
  imprimirDesenlace(resultado.filasEscritas);
}

function vigenciaDe(opciones: OpcionesDeImportacion): Date {
  if (opciones.vigenciaDesde === undefined) return new Date();
  return new Date(`${opciones.vigenciaDesde}${MEDIODIA_UTC}`);
}

async function main(): Promise<void> {
  cargarArchivoDeEntorno();

  const opciones = leerOpciones(process.argv.slice(ARGUMENTOS_DEL_USUARIO));
  const config = loadConfiguration(process.env);
  exigirEntorno(opciones, config.databaseUrl);

  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), {
    // El contexto no monta HTTP, así que tampoco monta las cabeceras de
    // seguridad, el timeout ni el filtro de errores. Es deliberado: aquí no hay
    // petición que proteger, y el error sale por la terminal, no por el cable.
    logger: false,
  });

  try {
    const sesion = await abrirSesion(app, opciones);
    await importar(app, sesion, opciones);
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  escribir('');
  escribir(error instanceof Error ? error.message : String(error));
  escribir('');
  escribir(USO);
  process.exitCode = SALIDA_CON_ERROR;
});
