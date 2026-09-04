/**
 * Ubicaciones — SPEC §2.
 *
 * DOS CASOS DE USO Y DOS REGLAS, cada una en su sitio:
 *
 *   crear   el limite del plan. Se comprueba DENTRO de la transaccion que
 *           inserta (ver el puerto): contar fuera y crear despues deja la
 *           puerta abierta a que dos peticiones simultaneas se salten el plan.
 *
 *   listar  el ALCANCE. RLS garantiza que solo se vean ubicaciones de la propia
 *           company; no sabe nada de que un `GERENTE_LOCAL` solo puede ver la
 *           suya. Esa segunda mitad se decide aqui, con `sesion.alcance`, que
 *           es una union: o "company entera" o "esta lista". No hay un caso
 *           por defecto que se pueda leer al reves.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import { LimiteDelPlanError } from '../../domain/errores';
import type {
  RepositorioDeOrganizacion,
  TipoDeUbicacion,
  Ubicacion,
} from '../ports/repositorio-de-organizacion.port';
import type { SesionActiva } from './validar-sesion';

export interface DependenciasDeUbicaciones {
  readonly organizacion: RepositorioDeOrganizacion;
  readonly auditoria: AuditLogPort;
}

export interface DatosDeUbicacion {
  readonly nombre: string;
  readonly tipo: TipoDeUbicacion;
}

export class CrearUbicacion {
  public constructor(private readonly deps: DependenciasDeUbicaciones) {}

  /** @throws {LimiteDelPlanError} */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeUbicacion): Promise<Ubicacion> {
    const resultado = await this.deps.organizacion.crearUbicacionSiCabe({
      companyId: sesion.companyId,
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
    });

    if (resultado.clase === 'limite') {
      throw new LimiteDelPlanError('ubicaciones', resultado.maximo);
    }

    await this.deps.auditoria.record({
      eventType: 'location.created',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { locationId: resultado.id, tipo: datos.tipo },
    });

    return { id: resultado.id, nombre: datos.nombre.trim(), tipo: datos.tipo, estado: 'ACTIVE' };
  }
}

export class ListarUbicaciones {
  public constructor(private readonly deps: DependenciasDeUbicaciones) {}

  public async ejecutar(sesion: SesionActiva): Promise<readonly Ubicacion[]> {
    // Un usuario de ubicacion SIN ninguna asignada ve una lista vacia, no la
    // company entera. Es el mismo criterio que el de RLS: ante la ausencia de
    // permiso, cero filas.
    const ids = sesion.alcance.clase === 'company' ? 'todas' : sesion.alcance.ids;

    return this.deps.organizacion.listarUbicaciones({ companyId: sesion.companyId, ids });
  }
}
