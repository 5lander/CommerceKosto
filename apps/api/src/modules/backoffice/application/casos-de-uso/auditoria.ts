/**
 * Leer los dos registros: el del tenant y el del propio back office.
 *
 * **`audit_log` SE ESCRIBÍA DESDE P0 Y NADIE PODÍA LEERLO.** La política
 * `audit_log_app_no_lee` (`USING false`) es deliberada —la aplicación cliente
 * solo inserta— pero no existía ningún otro rol, así que el registro que
 * SEGURIDAD.md §10 exige llevaba diez paquetes acumulando evidencia sin lector.
 * Cumplía la letra y no el propósito. Esto es lo que P11 cierra.
 *
 * **LEER LA AUDITORÍA DE UN TENANT ES UN ACCESO CROSS-TENANT, y pide motivo
 * como cualquier otro.** Las líneas traen IPs y `actor_id` de personas reales.
 *
 * **`accesosRecientes` NO PIDE MOTIVO, y es la única excepción del módulo.** Es
 * el log del propio back office: quien lo consulta está auditando a los
 * operadores, no mirando datos de un cliente. Pedir motivo para revisar quién
 * miró convertiría la vigilancia en un trámite, y un trámite se rellena solo.
 */

import type { CompanyId } from '../../../../shared/domain/identity/identificadores';
import type {
  AccesoRegistrado,
  LineaDeAuditoria,
  RepositorioDeBackoffice,
} from '../ports/repositorio-de-backoffice.port';
import { exigirMotivoSuficiente } from '../../domain/motivo';
import type { PeticionDeOperador } from './companies';

/**
 * Cuántas líneas como mucho.
 *
 * Hay tope y no paginación **a propósito**: quien investiga un incidente quiere
 * las últimas, y una paginación sobre una tabla que solo crece invita a barrerla
 * entera. El día que haga falta recorrerla toda, se hace con un volcado y no por
 * la API del back office.
 */
const MAXIMO_DE_LINEAS = 200;

export interface DependenciasDeAuditoria {
  readonly repositorio: RepositorioDeBackoffice;
}

export class LeerAuditoria {
  public constructor(private readonly deps: DependenciasDeAuditoria) {}

  /** @throws {MotivoInsuficienteError} */
  public async ejecutar(
    peticion: PeticionDeOperador,
    companyId: CompanyId | null,
  ): Promise<readonly LineaDeAuditoria[]> {
    return this.deps.repositorio.leerAuditoria({
      companyId,
      limite: MAXIMO_DE_LINEAS,
      acceso: {
        operatorId: peticion.operador.operatorId,
        motivo: exigirMotivoSuficiente(peticion.motivo),
        ip: peticion.ip,
      },
    });
  }
}

export class LeerAccesosDelBackoffice {
  public constructor(private readonly deps: DependenciasDeAuditoria) {}

  public async ejecutar(): Promise<readonly AccesoRegistrado[]> {
    return this.deps.repositorio.accesosRecientes(MAXIMO_DE_LINEAS);
  }
}
