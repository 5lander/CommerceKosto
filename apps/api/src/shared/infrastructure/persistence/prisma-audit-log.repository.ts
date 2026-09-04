/**
 * Implementacion del puerto de auditoria sobre `audit_log` — SEGURIDAD.md §10.
 *
 * DOS CAMPOS QUE NO ACEPTA DE QUIEN LLAMA, A PROPOSITO:
 *
 *   `at`              lo pone la base (`DEFAULT now()`), y la restriccion
 *                     `audit_log_at_no_es_futuro` rechaza cualquier intento de
 *                     fechar evidencia por delante del reloj del servidor.
 *
 *   `correlationId`   sale del contexto de la peticion, no del emisor. Asi
 *                     todas las lineas de una misma peticion —log incluido—
 *                     comparten identificador sin que nadie tenga que
 *                     acordarse de propagarlo.
 *
 * Fuera de una peticion (arranque, migraciones, trabajos en segundo plano) no
 * hay contexto y se genera uno nuevo: un evento sin correlacion no seria
 * insertable, porque la columna es NOT NULL, y perder el evento por no tener
 * con que correlacionarlo seria el peor de los dos males.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuditEvent, AuditLogPort } from '../../application/ports/audit-log.port';
import { currentRequestContext } from '../observability/request-context';
import { PrismaConnection } from './prisma-connection';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogPort {
  public constructor(private readonly connection: PrismaConnection) {}

  public async record(event: AuditEvent): Promise<void> {
    await this.connection.client.auditLog.create({
      data: {
        eventType: event.eventType,
        outcome: event.outcome,
        actorType: event.actorType,
        actorId: event.actorId,
        companyId: event.companyId,
        ip: event.ip,
        userAgent: event.userAgent,
        correlationId: currentRequestContext()?.correlationId ?? randomUUID(),
        detail: { ...event.detail },
      },
    });
  }
}
