/**
 * Construccion de la aplicacion, compartida por `main.ts` y por las pruebas de
 * integracion.
 *
 * ESTA COMPARTICION ES EL PUNTO. Si `main.ts` armara la aplicacion por su
 * cuenta, las pruebas de seguridad estarian midiendo una aplicacion parecida
 * pero distinta a la que se despliega, y una cabecera que se olvidara en
 * produccion seguiria pasando el test. Todo lo que protege la API —cabeceras,
 * limitador, timeout, filtro de error— se monta aqui dentro.
 */

import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import type { Configuration } from './shared/infrastructure/config/environment';
import { securityHeaders } from './shared/infrastructure/http/security-headers';

export async function createApplication(config: Configuration): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    // Los logs del arranque se guardan y se emiten cuando el logger definitivo
    // esta puesto: sin esto, todo lo anterior a `useLogger` sale con el formato
    // por defecto de Nest y el agregador ve dos formatos distintos.
    bufferLogs: true,
    // CORS CON LISTA BLANCA EXACTA (SEGURIDAD.md §4.4), jamas `*`.
    //
    // Hasta la Fase C no habia frontend y la lista vacia —no habilitarlo— era
    // la opcion mas restrictiva. Ahora `apps/web` llama desde el navegador, y
    // la lista sigue siendo exacta: los origenes salen de `CORS_ORIGENES`, que
    // el esquema de entorno valida uno a uno.
    //
    // `credentials: true` es obligatorio porque la sesion viaja en una cookie,
    // y es exactamente por eso que el origen NO puede ser `*`: el navegador
    // rechaza esa combinacion, y con razon — seria mandar la cookie a quien
    // pregunte. Con la lista vacia, `cors` queda en `false` y ningun navegador
    // puede llamar: el comportamiento anterior, intacto.
    cors:
      config.corsOrigenes.length === 0
        ? false
        : {
            origin: [...config.corsOrigenes],
            credentials: true,
            // Solo los metodos que la aplicacion usa. Un `DELETE` permitido en
            // CORS sobre una API que no borra nada es superficie regalada.
            methods: ['GET', 'POST', 'PUT', 'PATCH'],
          },
  });

  app.useLogger(app.get(Logger));

  // Antes que cualquier ruta y antes que cualquier manejador: tienen que salir
  // tambien en las respuestas que ningun controlador llega a ver.
  app.use(...securityHeaders());

  // Cierra el pool de la base al recibir SIGTERM en vez de dejar conexiones
  // colgando en PostgreSQL hasta que expire su timeout.
  app.enableShutdownHooks();

  return app;
}
