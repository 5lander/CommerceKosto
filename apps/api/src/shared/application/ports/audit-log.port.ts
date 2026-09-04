/**
 * Puerto de auditoria — SEGURIDAD.md §10.
 *
 * Es una interfaz PURA: `application` no conoce NestJS, Prisma ni Express
 * (CLAUDE.md §2, verificado por la regla `application-sin-framework` de
 * `audit:arch`). El token de inyeccion se declara aqui porque pertenece al
 * contrato, no a ninguna de sus implementaciones.
 *
 * QUIEN ESCRIBE Y QUIEN LEE NO SON EL MISMO. La aplicacion cliente solo
 * INSERTA; leer el log es del back office (P11). Por eso el puerto no tiene
 * metodo de lectura: no es una omision, es la superficie completa que la
 * aplicacion tiene derecho a usar. La politica RLS de `audit_log` lo hace
 * cumplir aunque alguien anada el metodo.
 */

import type { CompanyId, UserId } from '../../domain/identity/identificadores';

/** Token de inyeccion. Ver `shared/infrastructure/persistence` para el binding. */
export const AUDIT_LOG_PORT = 'AUDIT_LOG_PORT';

/** Catalogo `audit_outcome`. */
export type AuditOutcome = 'success' | 'failure' | 'blocked';

/** Catalogo `audit_actor_type`. */
export type AuditActorType = 'USER' | 'SYSTEM' | 'BACKOFFICE' | 'ANONYMOUS';

/**
 * Un evento tal y como lo emite el dominio.
 *
 * `at` no esta: lo pone la base de datos. Si lo pusiera el emisor, un reloj mal
 * puesto —o un llamante malicioso— podria fechar evidencia fuera de orden, y la
 * restriccion `audit_log_at_no_es_futuro` existe justamente para impedirlo.
 *
 * `correlationId` tampoco: sale del contexto de la solicitud
 * (`shared/infrastructure/observability`), no de quien registra el evento. Asi
 * todas las lineas de una misma peticion comparten identificador sin que nadie
 * tenga que acordarse de propagarlo.
 */
export interface AuditEvent {
  readonly eventType: string;
  readonly outcome: AuditOutcome;
  readonly actorType: AuditActorType;
  readonly actorId: UserId | null;
  /**
   * `null` para los eventos de sistema, que por definicion no tienen tenant
   * (`system.*`, `auth.login.*` cuando el correo no existe).
   *
   * NO es un `string`: pasar aqui el identificador equivocado es exactamente
   * como se escribe una fuga entre tenants sin que el compilador diga nada.
   */
  readonly companyId: CompanyId | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  /** Solo IDs y escalares. Jamas datos personales en claro ni secretos. */
  readonly detail: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditLogPort {
  record(event: AuditEvent): Promise<void>;
}
