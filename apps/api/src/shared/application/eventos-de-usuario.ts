/**
 * El evento de auditoría de una acción de usuario, en un solo sitio.
 *
 * **ES LA CUARTA REPETICIÓN, QUE ES EL UMBRAL DE `OPTIMIZACION.md` §1.** El
 * mismo bloque —`outcome: 'success'`, `actorType: 'USER'`, el actor y la
 * company de la sesión, `ip` y `userAgent` nulos— estaba copiado en `periods`,
 * en las dos escrituras de `inventory` y en las dos cargas de `analytics`. Lo
 * detectó `audit:duplication`.
 *
 * **NO RECIBE LA SESIÓN, SINO SUS DOS IDENTIFICADORES.** Vive en `shared`, y
 * `SesionActiva` es un tipo de `iam`: que `shared` dependiera de un módulo de
 * negocio invertiría la dirección de las dependencias por una comodidad de
 * firma.
 *
 * **`ip` Y `userAgent` VAN EN NULO A PROPÓSITO.** Los eventos de negocio se
 * emiten desde casos de uso, que no conocen la petición. Los eventos de acceso
 * —los que sí necesitan IP y dispositivo— los emite `iam` desde su propio
 * camino, con esos datos en la mano (SEGURIDAD.md §10).
 */

import type { CompanyId, UserId } from '../domain/identity/identificadores';
import type { AuditLogPort } from './ports/audit-log.port';

export interface EventoDeUsuario {
  readonly auditoria: AuditLogPort;
  readonly actorId: UserId;
  readonly companyId: CompanyId;
  readonly eventType: string;
  /** Solo IDs y escalares. Jamás datos personales en claro (SEGURIDAD.md §10). */
  readonly detail: Readonly<Record<string, string | number | boolean>>;
}

export async function registrarEventoDeUsuario(evento: EventoDeUsuario): Promise<void> {
  await evento.auditoria.record({
    eventType: evento.eventType,
    outcome: 'success',
    actorType: 'USER',
    actorId: evento.actorId,
    companyId: evento.companyId,
    ip: null,
    userAgent: null,
    detail: evento.detail,
  });
}
