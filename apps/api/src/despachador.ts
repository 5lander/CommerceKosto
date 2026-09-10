/**
 * EL DESPACHADOR DE CORREO. Tercer binario del sistema, y a proposito
 * (D-16.23, ADR-025).
 *
 * ============================================================================
 * POR QUE UN PROCESO APARTE Y NO UN `setInterval` DENTRO DE LA API
 * ============================================================================
 *
 * La API encola con `costeo_app`, que sobre `email_outbox` solo puede
 * `INSERT` y leer sin `datos`. Marcar un correo como enviado, reemplazar su
 * enlace por el saneado y borrar los golpes viejos del limite de tasa son
 * privilegios de OTRO rol, `costeo_despachador`, que no puentea RLS pero ve
 * la cola entera. Si ese rol viviera en el proceso de la API, un endpoint
 * cualquiera podria —por un `@Inject` mal puesto— cerrar correos o vaciar el
 * limite de tasa. Con dos procesos, el de la aplicacion no tiene ni la
 * variable: `DESPACHADOR_DATABASE_URL` solo la lee este archivo, y el esquema
 * de entorno de este proceso no acepta `DATABASE_URL`.
 *
 * Y es la misma asimetria que `backoffice.ts`: aqui no hay HTTP, ni guard, ni
 * filtro de errores. Es un bucle: una pasada por la cola, una espera, otra
 * pasada. Lo que si hay es un LATIDO en un archivo despues de cada pasada que
 * termina, que es lo que mira el `healthcheck` del contenedor: un despachador
 * vivo pero incapaz de completar una pasada —la base caida, el rol sin
 * privilegios— deja de latir y Docker lo marca `unhealthy`.
 *
 * ============================================================================
 * QUE PASA CUANDO ALGO FALLA
 * ============================================================================
 *
 *   un correo no sale     se marca con su error y su siguiente intento; el
 *                         resto de la pasada sigue (`DespacharCorreo`)
 *   una pasada revienta   se escribe en `stderr` y se espera al siguiente
 *                         turno; el latido no se escribe, asi que si persiste
 *                         el contenedor pasa a `unhealthy`
 *   SIGTERM / SIGINT      se termina la pasada en curso, se cierra el pool y
 *                         se sale con 0. `docker stop` da diez segundos
 *   configuracion mala    no arranca: `morirCon` con el mensaje, sin la pila
 *
 * ============================================================================
 * POR QUE NO SE LLAMA A `enableShutdownHooks()` — Y `audit:forbidden` LO VIGILA
 * ============================================================================
 *
 * Los ganchos de Nest hacen justo lo contrario de lo que este proceso
 * necesita: al recibir la senal ejecutan `onModuleDestroy` —el `$disconnect()`
 * del pool— MIENTRAS la pasada puede estar a medias, y despues re-emiten la
 * senal con `process.kill(process.pid, senal)` sin ningun receptor, con lo que
 * el proceso muere en el acto sin volver al bucle. El resultado era un correo
 * ya aceptado por el proveedor y todavia `PENDIENTE` en la base, que la
 * reserva dejaba volver a enviar a los cinco minutos: el doble envio, y en el
 * caso rutinario de un redespliegue. Aqui la senal solo hace `detener()`; el
 * bucle termina la pasada en curso, y solo entonces se cierra el contexto (que
 * es lo que ejecuta `onModuleDestroy`) y se sale con 0. La regla
 * `despachador-sin-ganchos-de-nest` (`correo.rules.mjs`) impide que vuelva.
 */

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';

import { DespacharCorreo, type ResumenDePasada } from './modules/correo/application/despachar-correo';
import { BucleDePasadas } from './modules/correo/infrastructure/bucle';
import { CorreoModule } from './modules/correo/infrastructure/correo.module';
import {
  cargarConfiguracionDelDespachador,
  type ConfiguracionDelDespachador,
} from './modules/correo/infrastructure/entorno-del-despachador';
import { morirCon } from './shared/infrastructure/proceso/morir-con';

/**
 * Carga el `.env` de la raiz, igual que `backoffice.ts` y `cli.ts`.
 *
 * EXPLICITO Y NO HEREDADO: un binario que dependa de que alguien mas lo haya
 * cargado antes funciona hasta el dia que se lanza solo. En produccion no hay
 * `.env` y las variables vienen del contenedor: por eso la ausencia del
 * archivo no es un error.
 */
function cargarArchivoDeEntorno(): void {
  try {
    process.loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));
  } catch {
    // Sin `.env`: se usan las variables que ya esten en el entorno.
  }
}

const SALIDA_LIMPIA = 0;

function mensajeDe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function huboTrabajo(resumen: ResumenDePasada): boolean {
  return resumen.tomados > 0 || resumen.purgados > 0;
}

/**
 * Una pasada, con su latido. Solo escribe una linea cuando hubo algo que
 * contar: a cinco segundos por pasada, un log que dijera «nada» cada vez
 * seria el ruido detras del que se esconde el primer fallo real.
 */
async function pasada(despacho: DespacharCorreo, latido: string): Promise<void> {
  try {
    const resumen = await despacho.ejecutar();
    await writeFile(latido, `${new Date().toISOString()}\n`);
    if (huboTrabajo(resumen)) {
      process.stdout.write(
        `[correo] tomados ${String(resumen.tomados)} · enviados ${String(resumen.enviados)} · ` +
          `fallidos ${String(resumen.fallidos)} · cedidos ${String(resumen.cedidos)} · ` +
          `golpes purgados ${String(resumen.purgados)}\n`,
      );
    }
  } catch (error: unknown) {
    process.stderr.write(`[correo] pasada fallida: ${mensajeDe(error)}\n`);
  }
}

function presentacion(config: ConfiguracionDelDespachador): string {
  return (
    `despachador de correo: adaptador ${config.mailAdapter}, una pasada cada ` +
    `${String(config.intervaloMs)} ms, lote de ${String(config.lote)}, latido en ${config.latido}\n`
  );
}

async function main(): Promise<void> {
  cargarArchivoDeEntorno();
  const config = cargarConfiguracionDelDespachador(process.env);

  // Con un adaptador que no puede cumplirse —`resend` sin clave— esto lanza y
  // el proceso muere ANTES de tocar la cola (`mailer.provider.ts`).
  const contexto = await NestFactory.createApplicationContext(CorreoModule.forRoot(config), {
    logger: ['error', 'warn'],
  });
  const despacho = contexto.get(DespacharCorreo);

  const bucle = new BucleDePasadas();
  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(senal, () => {
      process.stdout.write(`[correo] ${senal}: se termina la pasada en curso y se sale\n`);
      bucle.detener();
    });
  }

  process.stdout.write(presentacion(config));

  await bucle.correr(() => pasada(despacho, config.latido), config.intervaloMs);

  // Solo aqui, con la ultima pasada terminada, se cierra el pool.
  await contexto.close();
  process.exitCode = SALIDA_LIMPIA;
}

main().catch(morirCon);
