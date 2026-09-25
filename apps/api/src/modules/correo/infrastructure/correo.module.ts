/**
 * El modulo del despachador de correo. **`AppModule` NO lo importa, y nunca
 * debe** (D-16.23, ADR-025).
 *
 * Es la misma asimetria que `BackofficeModule`, y por la misma razon: este
 * modulo trae `DespachadorConnection`, un `PrismaClient` con OTRO rol. Que
 * este en el contenedor de la aplicacion cliente convertiria un `@Inject` mal
 * puesto en una aplicacion que marca correos como enviados o borra golpes del
 * limite de tasa. Lo que lo impide: `correo.rules.mjs` en `audit:forbidden`,
 * dos reglas de `audit:arch`, y una prueba de integracion que construye
 * `AppModule` y comprueba que no estan ni la conexion ni el modulo.
 *
 * **NO IMPORTA `SharedModule`.** Seria la via por la que `PrismaConnection`
 * —el pool de `costeo_app`— entraria en este proceso, y el esquema de entorno
 * del despachador ni siquiera acepta `DATABASE_URL`. Lo que hace falta de
 * `shared` —el reloj y la eleccion del adaptador de correo— se declara aqui.
 *
 * `forRoot(config)` Y NO UN MODULO ESTATICO: el lote, el adaptador y la
 * cadena vienen del esquema del proceso, y las pruebas montan el modulo con
 * la configuracion que necesitan (`fake`, lote pequeno) sin tocar el entorno.
 */

import { type DynamicModule, Module } from '@nestjs/common';

import { MAILER_PORT, type MailerPort } from '../../../shared/application/ports/mailer.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import { mailerProvider } from '../../../shared/infrastructure/correo/mailer.provider';
import { RelojDelSistema } from '../../../shared/infrastructure/time/reloj-del-sistema';
import { DespacharCorreo } from '../application/despachar-correo';
import { COLA_DE_CORREO, type ColaDeCorreo } from '../application/ports/cola-de-correo.port';
import { DespachadorConnection } from './despachador-connection';
import { CONFIGURACION_DEL_DESPACHADOR, type ConfiguracionDelDespachador } from './entorno-del-despachador';
import { PrismaColaDeCorreo } from './prisma-cola-de-correo';

@Module({})
export class CorreoModule {
  public static forRoot(config: ConfiguracionDelDespachador): DynamicModule {
    return {
      module: CorreoModule,
      providers: [
        { provide: CONFIGURACION_DEL_DESPACHADOR, useValue: config },
        DespachadorConnection,
        { provide: COLA_DE_CORREO, useClass: PrismaColaDeCorreo },
        { provide: RELOJ, useClass: RelojDelSistema },
        mailerProvider({ mailAdapter: config.mailAdapter, resend: config.resend, isProduction: config.isProduction }),
        {
          provide: DespacharCorreo,
          inject: [COLA_DE_CORREO, MAILER_PORT, RELOJ],
          useFactory: (cola: ColaDeCorreo, mailer: MailerPort, reloj: Reloj): DespacharCorreo =>
            new DespacharCorreo({ cola, mailer, reloj, lote: config.lote }),
        },
      ],
    };
  }
}
