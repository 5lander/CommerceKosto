/**
 * Cierre de sesion del lado del SERVIDOR — SEGURIDAD.md §2.2.
 *
 * "Logout del lado servidor (invalidacion real, no solo borrar la cookie)".
 * Borrar la cookie deja el token vivo en la base: quien lo hubiera copiado
 * —una extension del navegador, un proxy, un volcado de memoria— sigue dentro
 * hasta que caduque. Aqui se marca `revoked_at`, y la siguiente peticion con
 * ese token no pasa de `ValidarSesion`.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { RepositorioDeAutenticacion } from '../ports/repositorio-de-autenticacion.port';
import type { SesionActiva } from './validar-sesion';

export interface DependenciasDeCerrarSesion {
  readonly repositorio: RepositorioDeAutenticacion;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

export class CerrarSesion {
  public constructor(private readonly deps: DependenciasDeCerrarSesion) {}

  public async ejecutar(sesion: SesionActiva): Promise<void> {
    const ahora = this.deps.reloj.ahora();

    await this.deps.repositorio.revocarSesion({
      companyId: sesion.companyId,
      sessionId: sesion.sessionId,
      ahora,
    });

    await this.deps.auditoria.record({
      eventType: 'auth.logout',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { sessionId: sesion.sessionId },
    });
  }
}
