/**
 * Modulo raiz. Se construye con la configuracion YA VALIDADA, que llega por
 * parametro en vez de leerse de `process.env` aqui dentro.
 *
 * Eso no es ceremonia: es lo que permite que una prueba de integracion levante
 * la aplicacion con una configuracion suya —otra base, otro timeout, el
 * limitador en 2 peticiones— sin tocar variables de entorno del proceso, que
 * son estado global compartido entre pruebas y la primera fuente de suites que
 * pasan sueltas y fallan juntas.
 *
 * LAS TRES PROTECCIONES GLOBALES SE REGISTRAN AQUI, NO EN `main.ts`, para que
 * la aplicacion de las pruebas sea la MISMA que la de produccion. Una defensa
 * cableada en `main.ts` no existe en los tests, y entonces el test de que
 * existe no prueba nada:
 *
 *   APP_GUARD        limitador de peticiones (SEGURIDAD.md §2.1)
 *   APP_INTERCEPTOR  timeout de peticion
 *   APP_FILTER       formato unico de error `{ code, message }`
 *
 * Las cabeceras de seguridad son la excepcion deliberada: van como middleware
 * de plataforma en `bootstrap()` porque tienen que salir tambien en las
 * respuestas que NO llegan a un manejador (404, 429, cuerpo malformado). Ver
 * `http/security-headers.ts`.
 */

import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { TerminusModule } from '@nestjs/terminus';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';

import { CatalogModule } from './modules/catalog/catalog.module';
import { CostingModule } from './modules/costing/costing.module';
import { IamModule } from './modules/iam/iam.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { RecipesModule } from './modules/recipes/recipes.module';
import type { Configuration } from './shared/infrastructure/config/environment';
import { DatabaseHealthIndicator } from './shared/infrastructure/health/database.health';
import { HealthController } from './shared/infrastructure/health/health.controller';
import { ErrorFilter } from './shared/infrastructure/http/error.filter';
import { TimeoutInterceptor } from './shared/infrastructure/http/timeout.interceptor';
import { loggerOptions } from './shared/infrastructure/observability/logger.options';
import { SharedModule } from './shared/infrastructure/shared.module';

@Module({})
export class AppModule {
  public static forRoot(config: Configuration): DynamicModule {
    return {
      module: AppModule,
      imports: [
        LoggerModule.forRoot(loggerOptions(config)),
        // En P0 el contador vive en memoria del proceso: con una sola replica
        // es exacto. Pasa a Redis en P1, cuando el limite tenga que ser el
        // mismo para todas las replicas — un limitador por proceso multiplica
        // el limite real por el numero de replicas, que es como un limite deja
        // de limitar sin que nadie lo note.
        ThrottlerModule.forRoot([{ ttl: config.rateLimit.windowMs, limit: config.rateLimit.max }]),
        TerminusModule,
        SharedModule.forRoot(config),
        IamModule,
        CatalogModule,
        PricingModule,
        RecipesModule,
        CostingModule,
        InventoryModule,
      ],
      controllers: [HealthController],
      providers: [
        DatabaseHealthIndicator,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_INTERCEPTOR, useClass: TimeoutInterceptor },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
