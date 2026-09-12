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
import type { LocationId } from '../../../../shared/domain/identity/identificadores';
import {
  LimiteDelPlanError,
  NombreDeUbicacionEnUsoError,
  UbicacionNoEncontradaError,
} from '../../domain/errores';
import type {
  RepositorioDeOrganizacion,
  TipoDeUbicacion,
  Ubicacion,
} from '../ports/repositorio-de-organizacion.port';
import { exigirUbicacionEnAlcance, type SesionActiva } from './validar-sesion';

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

/**
 * Editar una ubicación — P16-C, D-16.127. Nombre y tipo; sin estado (hoy
 * `INACTIVE` no tiene ningún efecto en el sistema) y sin versión (D-16.13).
 *
 * El alcance se comprueba aunque `location.update` sea de roles de company: la
 * regla de §4.4 no depende de qué roles tengan hoy el permiso.
 */
export class ActualizarUbicacion {
  public constructor(private readonly deps: DependenciasDeUbicaciones) {}

  /** @throws {UbicacionNoEncontradaError} @throws {NombreDeUbicacionEnUsoError} @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(sesion: SesionActiva, locationId: LocationId, datos: DatosDeUbicacion): Promise<Ubicacion> {
    exigirUbicacionEnAlcance(sesion, locationId);
    const nombre = datos.nombre.trim();

    const resultado = await this.deps.organizacion.actualizarUbicacion({
      companyId: sesion.companyId,
      locationId,
      nombre,
      tipo: datos.tipo,
    });
    if (resultado === 'no_encontrada') throw new UbicacionNoEncontradaError();
    if (resultado === 'nombre_en_uso') throw new NombreDeUbicacionEnUsoError(nombre);

    await this.deps.auditoria.record({
      eventType: 'location.updated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { locationId, tipo: datos.tipo },
    });

    const [actualizada] = await this.deps.organizacion.listarUbicaciones({ companyId: sesion.companyId, ids: [locationId] });
    if (actualizada === undefined) throw new UbicacionNoEncontradaError();
    return actualizada;
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
