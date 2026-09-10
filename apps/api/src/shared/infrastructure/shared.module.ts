/**
 * Cableado de los puertos transversales — CLAUDE.md §2 y §12.
 *
 * AQUI, Y SOLO AQUI, SE ELIGE LA IMPLEMENTACION. Los casos de uso reciben
 * `AuditLogPort`, `MailerPort` y `FileStoragePort` por constructor y no saben
 * cual les toco. Es lo que permite que el sistema entero se levante y se pruebe
 * de punta a punta con `MAIL_ADAPTER=fake` y `STORAGE_ADAPTER=fake`, sin una
 * sola credencial real — criterio de aceptacion de P0, no comodidad.
 *
 * UN SELECTOR EN `real` SIN ADAPTADOR REAL NO ARRANCA. La alternativa —caer al
 * falso con un aviso— significa que una configuracion equivocada en produccion
 * se traga los correos en silencio. Fallo ruidoso antes que fallo silencioso,
 * el mismo criterio que gobierna los DEFAULT PRIVILEGES de la base.
 */

import { type DynamicModule, Global, Module, type Provider } from '@nestjs/common';

import { LimitadorDeTasa } from '../application/limite-de-tasa/limitador';
import { AUDIT_LOG_PORT, type AuditLogPort } from '../application/ports/audit-log.port';
import { FILE_STORAGE_PORT } from '../application/ports/file-storage.port';
import { MAILER_PORT } from '../application/ports/mailer.port';
import { REGISTRO_DE_LIMITES, type RegistroDeLimites } from '../application/ports/registro-de-limites.port';
import { CONFIGURATION, type Configuration } from './config/environment';
import { mailerProvider } from './correo/mailer.provider';
import { FakeFileStorage } from './fakes/fake-file-storage';
import { PrismaAuditLogRepository } from './persistence/prisma-audit-log.repository';
import { PrismaConnection } from './persistence/prisma-connection';
import { PrismaRegistroDeLimites } from './persistence/prisma-registro-de-limites';
import { TenantTransaction } from './persistence/tenant-transaction';

class AdapterNotImplementedError extends Error {
  public constructor(variable: string, valor: string, paquete: string) {
    super(
      `${variable}=${valor}, pero ese adaptador no existe todavia (llega en ${paquete}). ` +
        'Pon `fake` o implementalo: la aplicacion no arranca con un selector que no puede cumplir.',
    );
    this.name = 'AdapterNotImplementedError';
  }
}

function fileStorageProvider(config: Configuration): Provider {
  if (config.storageAdapter === 'real') {
    throw new AdapterNotImplementedError('STORAGE_ADAPTER', config.storageAdapter, 'P10');
  }
  return { provide: FILE_STORAGE_PORT, useClass: FakeFileStorage };
}

@Global()
@Module({})
export class SharedModule {
  public static forRoot(config: Configuration): DynamicModule {
    const configuration: Provider = { provide: CONFIGURATION, useValue: config };
    const auditLog: Provider = { provide: AUDIT_LOG_PORT, useClass: PrismaAuditLogRepository };
    const registroDeLimites: Provider = { provide: REGISTRO_DE_LIMITES, useClass: PrismaRegistroDeLimites };
    // Un caso de uso de `application`: sin decorador, construido aqui con sus
    // dos puertos, como los de `iam.module.ts`. Es transversal (lo usan cuatro
    // endpoints de `iam`) y por eso vive en `shared` y se exporta.
    const limitador: Provider = {
      provide: LimitadorDeTasa,
      inject: [REGISTRO_DE_LIMITES, AUDIT_LOG_PORT],
      useFactory: (registro: RegistroDeLimites, auditoria: AuditLogPort): LimitadorDeTasa =>
        new LimitadorDeTasa({ registro, auditoria }),
    };

    return {
      module: SharedModule,
      providers: [
        configuration,
        PrismaConnection,
        TenantTransaction,
        auditLog,
        registroDeLimites,
        limitador,
        // La API no envia correo desde P16-A1 (ADR-025): encola. El selector se
        // honra igual, con la MISMA eleccion que usa el despachador, para que un
        // `.env` que pida `resend` sin clave falle aqui tambien y no solo alla.
        mailerProvider({ mailAdapter: config.mailAdapter, resend: config.resend, isProduction: config.isProduction }),
        fileStorageProvider(config),
      ],
      exports: [
        CONFIGURATION,
        PrismaConnection,
        TenantTransaction,
        AUDIT_LOG_PORT,
        MAILER_PORT,
        FILE_STORAGE_PORT,
        LimitadorDeTasa,
      ],
    };
  }
}
