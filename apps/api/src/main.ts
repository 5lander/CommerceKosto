/**
 * Punto de entrada del proceso de la API.
 *
 * Hace tres cosas y ninguna mas: cargar el entorno, validarlo, y levantar.
 * Toda la construccion esta en `bootstrap.ts` para que las pruebas monten
 * exactamente la misma aplicacion.
 */

import 'reflect-metadata';

import { resolve } from 'node:path';

import { createApplication } from './bootstrap';
import { loadConfiguration } from './shared/infrastructure/config/environment';

/**
 * `process.loadEnvFile` es nativo desde Node 20.6: una dependencia menos que
 * `dotenv` para cuatro lineas (CLAUDE.md §3).
 *
 * NO PISA LO QUE YA ESTE EN EL ENTORNO, y eso importa: en produccion las
 * variables vienen del gestor de secretos, y un `.env` olvidado en la imagen no
 * puede sobrescribirlas.
 */
function cargarArchivoDeEntorno(): void {
  try {
    process.loadEnvFile(resolve(__dirname, '..', '..', '..', '.env'));
  } catch {
    // Sin `.env`: se usan las variables que ya esten en el entorno.
  }
}

async function bootstrap(): Promise<void> {
  cargarArchivoDeEntorno();

  // Si esto lanza, el proceso muere aqui y no llega a escuchar. Es lo correcto:
  // una API mal configurada que acepta trafico es peor que una que no arranca.
  const config = loadConfiguration(process.env);

  const app = await createApplication(config);
  await app.listen(config.port);
}

void bootstrap();
