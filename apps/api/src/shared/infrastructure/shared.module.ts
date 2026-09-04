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

import { AUDIT_LOG_PORT } from '../application/ports/audit-log.port';
import { FILE_STORAGE_PORT } from '../application/ports/file-storage.port';
import { MAILER_PORT } from '../application/ports/mailer.port';
import { CONFIGURATION, type Configuration } from './config/environment';
import { FakeFileStorage } from './fakes/fake-file-storage';
import { FakeMailer } from './fakes/fake-mailer';
import { PrismaAuditLogRepository } from './persistence/prisma-audit-log.repository';
import { PrismaConnection } from './persistence/prisma-connection';

class AdapterNotImplementedError extends Error {
  public constructor(variable: string, paquete: string) {
    super(
      `${variable}=real, pero el adaptador real no existe todavia (llega en ${paquete}). ` +
        'Pon `fake` o implementalo: la aplicacion no arranca con un selector que no puede cumplir.',
    );
    this.name = 'AdapterNotImplementedError';
  }
}

function mailerProvider(config: Configuration): Provider {
  if (config.mailAdapter === 'real') {
    throw new AdapterNotImplementedError('MAIL_ADAPTER', 'P1');
  }
  return { provide: MAILER_PORT, useClass: FakeMailer };
}

function fileStorageProvider(config: Configuration): Provider {
  if (config.storageAdapter === 'real') {
    throw new AdapterNotImplementedError('STORAGE_ADAPTER', 'P10');
  }
  return { provide: FILE_STORAGE_PORT, useClass: FakeFileStorage };
}

@Global()
@Module({})
export class SharedModule {
  public static forRoot(config: Configuration): DynamicModule {
    const configuration: Provider = { provide: CONFIGURATION, useValue: config };
    const auditLog: Provider = { provide: AUDIT_LOG_PORT, useClass: PrismaAuditLogRepository };

    return {
      module: SharedModule,
      providers: [
        configuration,
        PrismaConnection,
        auditLog,
        mailerProvider(config),
        fileStorageProvider(config),
      ],
      exports: [CONFIGURATION, PrismaConnection, AUDIT_LOG_PORT, MAILER_PORT, FILE_STORAGE_PORT],
    };
  }
}
