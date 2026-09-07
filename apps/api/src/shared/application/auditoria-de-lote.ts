/**
 * Un evento de auditoría por LOTE, escrito una sola vez para los cuatro
 * módulos que reciben lotes.
 *
 * **UN EVENTO POR LOTE, NO UNO POR FILA.** Doscientos `catalog.item.created`
 * seguidos no cuentan que hubo una importación: la esconden. El detalle de qué
 * entró vive en `import_job.analysis`; el log de auditoría guarda la ACCIÓN.
 *
 * **VIVE EN `shared` PORQUE LO ESCRIBIERON CUATRO VECES Y `audit:duplication`
 * LO PARÓ.** No es una generalización preventiva: es la cuarta copia de las
 * mismas quince líneas, que es exactamente el umbral de OPTIMIZACION.md §1.
 *
 * `sesion` se tipa por estructura y no como `SesionActiva`: ese tipo vive en
 * `iam`, y `shared` no debe depender de un módulo concreto.
 */

import type { CompanyId, UserId } from '../domain/identity/identificadores';
import type { AuditLogPort } from './ports/audit-log.port';

export async function auditarLote(entrada: {
  readonly auditoria: AuditLogPort;
  readonly sesion: { readonly userId: UserId; readonly companyId: CompanyId };
  readonly eventType: string;
  readonly filas: number;
}): Promise<void> {
  await entrada.auditoria.record({
    eventType: entrada.eventType,
    outcome: 'success',
    actorType: 'USER',
    actorId: entrada.sesion.userId,
    companyId: entrada.sesion.companyId,
    ip: null,
    userAgent: null,
    detail: { filas: entrada.filas },
  });
}
