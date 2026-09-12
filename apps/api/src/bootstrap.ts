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
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import type { Configuration } from './shared/infrastructure/config/environment';
import { CABECERA_DE_CSRF } from './shared/infrastructure/http/csrf';
import { CABECERA_DE_REINTENTO } from './shared/infrastructure/http/error.filter';
import { CORRELATION_HEADER } from './shared/infrastructure/observability/logger.options';
import { securityHeaders } from './shared/infrastructure/http/security-headers';

/** Diez minutos. Ver `maxAge` abajo. */
const SEGUNDOS_DE_PREFLIGHT = 600;

export async function createApplication(config: Configuration): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    // Los logs del arranque se guardan y se emiten cuando el logger definitivo
    // esta puesto: sin esto, todo lo anterior a `useLogger` sale con el formato
    // por defecto de Nest y el agregador ve dos formatos distintos.
    bufferLogs: true,
    // SOLO JSON. Nest monta por defecto DOS analizadores de cuerpo, `json` y
    // `urlencoded`, y el segundo es el que un `<form>` de cualquier sitio del
    // mundo sabe emitir sin preflight. Esta API no tiene un solo endpoint que
    // reciba un formulario, asi que apagarlo no quita nada y quita el unico
    // camino por el que una pagina cruzada puede mandar un cuerpo que este
    // servidor entienda. Se apagan los dos aqui y se vuelve a encender `json`
    // abajo, porque la opcion de Nest es un booleano y no una lista.
    //
    // LO QUE ESTO CIERRA ES EL LOGIN CSRF (P16-A2, ADR-021). Las cuatro rutas
    // publicas quedan fuera del guard de CSRF, y para tres de ellas da igual;
    // el login NO usa una credencial, la CREA: un formulario cruzado que
    // acierte el `POST /auth/login` deja al navegador de la victima con la
    // sesion del ATACANTE instalada —`SameSite` gobierna el ENVIO, no el
    // almacenamiento— y todo lo que la victima escriba despues acaba dentro de
    // la company del atacante. Exigiendo `application/json` el ataque necesita
    // un preflight, y el preflight lo decide la lista blanca de CORS.
    bodyParser: false,
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
            // Solo los metodos que la aplicacion usa. `DELETE` entra en P16-A2
            // porque el comentario anterior —«una API que no borra nada»— dejo
            // de ser cierto: `DELETE /usuarios/roles` existe desde P1, y desde
            // el navegador era inalcanzable porque el preflight lo rechazaba.
            // Ninguna prueba lo veia: `supertest` no hace preflight.
            methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            // DECLARADAS, NO REFLEJADAS. Sin esta linea el paquete `cors`
            // devuelve lo que el navegador haya pedido en
            // `Access-Control-Request-Headers`, asi que `X-CSRF-Token` pasaba
            // por reflejo y no por contrato: la lista blanca de cabeceras era,
            // en la practica, `*`. Con la lista escrita, anadir una cabecera a
            // la API obliga a anadirla aqui — y `Content-Type` esta primero
            // porque sin el se rompe cualquier `POST` con cuerpo JSON.
            allowedHeaders: ['Content-Type', CABECERA_DE_CSRF],
            // Lo que el JavaScript de la pagina PUEDE LEER de la respuesta. Por
            // defecto son siete cabeceras fijas y ninguna de las nuestras: el
            // mensaje de los 5xx pide literalmente citar `x-correlation-id` y
            // el navegador no podia leerlo, y `Retry-After` (D-16.64) llegaba
            // sin que el cliente pudiera decir cuanto esperar.
            exposedHeaders: [CORRELATION_HEADER, CABECERA_DE_REINTENTO],
            // El navegador guarda el preflight este tiempo. Sin el, TODA
            // mutacion son dos viajes, y esta aplicacion se usa de pie en una
            // bodega con mala conexion (CLAUDE.md §10). Diez minutos es corto a
            // proposito: un cambio de esta politica se propaga en minutos, no
            // al dia siguiente.
            maxAge: SEGUNDOS_DE_PREFLIGHT,
          },
  });

  // El unico analizador de cuerpo del sistema. Ver `bodyParser: false` arriba.
  app.useBodyParser('json');

  app.useLogger(app.get(Logger));

  // Antes que cualquier ruta y antes que cualquier manejador: tienen que salir
  // tambien en las respuestas que ningun controlador llega a ver.
  app.use(...securityHeaders());

  // Cierra el pool de la base al recibir SIGTERM en vez de dejar conexiones
  // colgando en PostgreSQL hasta que expire su timeout.
  app.enableShutdownHooks();

  return app;
}
