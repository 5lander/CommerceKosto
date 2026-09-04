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
    // CORS DESACTIVADO. SEGURIDAD.md §4.4 exige lista blanca exacta de origenes
    // y jamas `*`. En P0 no hay frontend: la lista blanca vacia —es decir, no
    // habilitarlo— es la opcion mas restrictiva, que es como se resuelve toda
    // duda de seguridad en este proyecto (CLAUDE.md §4).
    cors: false,
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
