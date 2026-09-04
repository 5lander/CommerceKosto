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
 * DOS CAMINOS SEGUN HAYA TENANT O NO, y no es una comodidad: son dos politicas
 * RLS distintas sobre la misma tabla. Un evento con `companyId` tiene que
 * escribirse CON el tenant fijado, porque su politica exige
 * `company_id = current_company()`; uno de sistema tiene que escribirse SIN el,
 * porque la suya exige `company_id IS NULL`. Enviar uno por el camino del otro
 * no produce un dato mal puesto: produce un rechazo de la base.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { AuditEvent, AuditLogPort } from '../../application/ports/audit-log.port';
import { currentRequestContext } from '../observability/request-context';
import type { ClienteDeTransaccion } from './prisma-connection';
import { TenantTransaction } from './tenant-transaction';

@Injectable()
export class PrismaAuditLogRepository implements AuditLogPort {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async record(event: AuditEvent): Promise<void> {
    const escribir = async (tx: ClienteDeTransaccion): Promise<void> => {
      // `createMany` Y NO `create`, y no es una preferencia de estilo.
      //
      // `create` emite `INSERT ... RETURNING`, y bajo RLS el `RETURNING` exige
      // que la fila pase tambien la politica de SELECT. La de `audit_log` es
      // `USING (false)`: la aplicacion escribe el log y NO lo lee
      // (SEGURIDAD.md §10). Con `create`, toda insercion moria con
      // "new row violates row-level security policy" — un mensaje que acusa a
      // la politica de INSERT, que es justamente la que si lo permitia.
      // Ver docs/incidencias/INC-010.
      //
      // `createMany` inserta sin `RETURNING` y devuelve el numero de filas.
      await tx.auditLog.createMany({ data: [this.fila(event)] });
    };

    if (event.companyId === null) {
      await this.transaccion.runWithoutTenant(
        'evento de auditoria de sistema: por definicion no tiene tenant (SEGURIDAD.md §10)',
        escribir,
      );
      return;
    }

    await this.transaccion.run(event.companyId, escribir);
  }

  private fila(event: AuditEvent): {
    eventType: string;
    outcome: string;
    actorType: string;
    actorId: string | null;
    companyId: string | null;
    ip: string | null;
    userAgent: string | null;
    correlationId: string;
    detail: Record<string, string | number | boolean>;
  } {
    return {
      eventType: event.eventType,
      outcome: event.outcome,
      actorType: event.actorType,
      actorId: event.actorId,
      companyId: event.companyId,
      ip: event.ip,
      userAgent: event.userAgent,
      // Fuera de una peticion —arranque, trabajos en segundo plano— no hay
      // contexto. Se genera uno: perder el evento por no tener con que
      // correlacionarlo seria el peor de los dos males, y la columna es NOT NULL.
      correlationId: currentRequestContext()?.correlationId ?? randomUUID(),
      detail: { ...event.detail },
    };
  }
}
