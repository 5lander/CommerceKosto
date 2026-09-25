/**
 * EL PROCESO DEL BACK OFFICE. Segundo binario del sistema, y a propósito.
 *
 * ============================================================================
 * POR QUÉ UN PROCESO APARTE Y NO UN MÓDULO MÁS DE LA API
 * ============================================================================
 *
 * SPEC §1 lo exige con estas palabras: «la conexión privilegiada vive **solo**
 * en el proceso del back office, inalcanzable desde la aplicación cliente por
 * cualquier ruta». Montarlo dentro de `AppModule` con un guard delante haría que
 * la conexión que puentea RLS estuviera **en el mismo contenedor de inyección**
 * que todos los controladores del cliente. Bastaría un `@Inject` mal puesto —o
 * un módulo que reexporta de más— para que un endpoint de la aplicación tuviera
 * en la mano un cliente que lo ve todo. El guard sería lo único entre eso y una
 * fuga total, y un guard es código que alguien puede olvidarse de poner.
 *
 * Con dos procesos, la separación no depende de que nadie se equivoque: el
 * proceso de la aplicación **no tiene** la variable `BACKOFFICE_DATABASE_URL`, y
 * aunque la tuviera, no importa el módulo que la usaría.
 *
 * Y ES LA MISMA ASIMETRÍA QUE `cli.ts`, ya documentada: aquí no se monta el
 * limitador de peticiones de la app cliente —no hay tráfico anónimo que limitar
 * en un puerto que solo escucha en loopback— pero sí las cabeceras de seguridad,
 * el filtro de errores y el timeout, porque esto sí sirve HTML a un navegador
 * (P13) y sí puede devolver un 500.
 *
 * ============================================================================
 * DÓNDE ESCUCHA
 * ============================================================================
 *
 * En **loopback**, siempre. `BACKOFFICE_PORT` decide el puerto; la interfaz no
 * es configurable a propósito. Al back office se llega por túnel SSH
 * (`docs/runbooks/despliegue.md`), y una variable de entorno que permitiera
 * `0.0.0.0` sería una variable que algún día alguien pone a `0.0.0.0`.
 *
 * Sin CORS: no hay ningún origen legítimo que llame a esto desde un navegador
 * que no sea el suyo propio, servido por el mismo túnel.
 */

import { morirCon } from './shared/infrastructure/proceso/morir-con';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { BackofficeModule } from './modules/backoffice/backoffice.module';
import { guionDeLaInterfaz } from './modules/backoffice/infrastructure/http/backoffice.controller';

const PUERTO_POR_DEFECTO = 3101;

/** El mayor puerto TCP. */
const PUERTO_MAXIMO = 65_535;

/**
 * SOLO LOOPBACK, y no es configurable.
 *
 * Ver la cabecera. Si algún día hay que exponerlo, se hace con un proxy delante
 * y autenticación de cliente, no cambiando esta constante por una variable.
 */
const INTERFAZ = '127.0.0.1';

function puerto(): number {
  const crudo = process.env['BACKOFFICE_PORT'];
  if (crudo === undefined || crudo.trim() === '') return PUERTO_POR_DEFECTO;

  const valor = Number.parseInt(crudo, 10);
  if (!Number.isInteger(valor) || valor <= 0 || valor > PUERTO_MAXIMO) {
    throw new Error(`BACKOFFICE_PORT no es un puerto válido: "${crudo}".`);
  }
  return valor;
}

/**
 * Carga el `.env` de la raiz, igual que `cli.ts`.
 *
 * EXPLICITO Y NO HEREDADO. `prisma.config.ts` lo carga para el CLI de Prisma y
 * `main.ts` lo recibe del entorno del contenedor; un binario que dependa de que
 * alguien mas lo haya cargado antes funciona hasta el dia que se lanza solo. En
 * produccion no hay `.env` y las variables vienen del gestor de secretos: por
 * eso la ausencia del archivo no es un error.
 */
function cargarArchivoDeEntorno(): void {
  try {
    process.loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));
  } catch {
    // Sin `.env`: se usan las variables que ya esten en el entorno.
  }
}

async function main(): Promise<void> {
  cargarArchivoDeEntorno();

  // ANTES DE NADA: si la interfaz no está compilada, no se arranca. Servir una
  // página en blanco es peor que no arrancar — el segundo se arregla en el acto.
  guionDeLaInterfaz();

  const app = await NestFactory.create(BackofficeModule, { cors: false });

  // Las cabeceras de seguridad ya las aplica `BackofficeModule` como middleware:
  // van con el modulo, no con este lanzador, para que una prueba que lo monte
  // mida exactamente lo que sirve este proceso.
  app.enableShutdownHooks();

  await app.listen(puerto(), INTERFAZ);

  process.stdout.write(
    `back office escuchando en http://${INTERFAZ}:${String(puerto())}\n` +
      'NO se publica a internet: se llega por túnel SSH.\n',
  );
}

main().catch(morirCon);
