/**
 * Las operaciones del back office sobre la cartera de clientes.
 *
 * **TODAS PIDEN MOTIVO, INCLUIDA LA LISTA.** Listar no entra en ningún tenant
 * —devuelve nombres, planes y recuentos, no datos de negocio— y aun así deja
 * rastro. La razón es que la pregunta que un registro de acceso privilegiado
 * responde no es solo «¿quién vio los datos de este cliente?» sino también
 * «¿quién estuvo mirando la cartera?». Un log con huecos deliberados es un log
 * en el que no se puede confiar para nada.
 *
 * **EL MOTIVO SE VALIDA AQUÍ Y LO EXIGE LA BASE.** El dominio da un 400 con el
 * número de caracteres que faltan; el `CHECK` de la tabla es la red por debajo,
 * para el día que alguien añada un caso de uso y se olvide (INC-012).
 *
 * **NINGÚN CASO DE USO DEVUELVE DATOS ANTES DE ESCRIBIR EL ACCESO.** No es una
 * cuestión de orden en el código: el repositorio hace las dos cosas en la misma
 * transacción, así que no existe la forma de leer sin dejar rastro.
 *
 * **Y NADA DE ESTO ESCRIBE EN `audit_log`, a propósito.** Son dos registros con
 * dos dueños: `audit_log` es el rastro del TENANT, escrito por su aplicación y
 * leído —desde P11— por soporte; `backoffice_access_log` es el rastro del
 * OPERADOR, con su motivo obligatorio. Escribir cada acción en los dos daría dos
 * verdades sobre el mismo hecho, y obligaría a conceder `INSERT` sobre
 * `audit_log` al único rol que puentea RLS. Menos privilegio y un solo relato.
 */

import type { CompanyId } from '../../../../shared/domain/identity/identificadores';
import {
  CompanyNoEncontradaError,
  EstadoDesconocidoError,
  PlanDesconocidoError,
  PlanNoAlcanzaError,
} from '../../domain/errores';
import { exigirMotivoSuficiente } from '../../domain/motivo';
import type {
  Acceso,
  CompanyDetallada,
  CompanyEnLista,
  PlanLeido,
  RepositorioDeBackoffice,
} from '../ports/repositorio-de-backoffice.port';
import type { OperadorActivo } from './sesion';

/** Estados que un operador puede fijar. `CLOSED` no está: cerrar es otra cosa. */
const ESTADOS_OPERABLES: readonly string[] = ['ACTIVE', 'SUSPENDED'];

export interface DependenciasDeCompanies {
  readonly repositorio: RepositorioDeBackoffice;
}

/** Lo que llega de fuera en toda operación: quién, por qué y desde dónde. */
export interface PeticionDeOperador {
  readonly operador: OperadorActivo;
  readonly motivo: string;
  readonly ip: string | null;
}

/** @throws {MotivoInsuficienteError} */
function accesoDe(peticion: PeticionDeOperador): Acceso {
  return {
    operatorId: peticion.operador.operatorId,
    motivo: exigirMotivoSuficiente(peticion.motivo),
    ip: peticion.ip,
  };
}

export class ListarCompanies {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  public async ejecutar(peticion: PeticionDeOperador): Promise<readonly CompanyEnLista[]> {
    return this.deps.repositorio.listarCompanies(accesoDe(peticion));
  }
}

export class ListarPlanes {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  /**
   * NO PIDE MOTIVO: los planes son el catálogo del propio producto, no datos de
   * ningún cliente. Exigir motivo aquí entrenaría a escribir motivos vacíos.
   */
  public async ejecutar(): Promise<readonly PlanLeido[]> {
    return this.deps.repositorio.listarPlanes();
  }
}

export class VerCompany {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  /** @throws {CompanyNoEncontradaError} · {@link MotivoInsuficienteError} */
  public async ejecutar(
    peticion: PeticionDeOperador,
    companyId: CompanyId,
  ): Promise<CompanyDetallada> {
    const ficha = await this.deps.repositorio.leerCompany({
      companyId,
      acceso: accesoDe(peticion),
    });

    if (ficha === null) throw new CompanyNoEncontradaError();
    return ficha;
  }
}

export interface DatosDeAlta {
  readonly nombre: string;
  readonly plan: string;
  readonly emailDelDueno: string;
}

export class CrearCompany {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  /**
   * El alta de un tenant, con su semilla de parámetros (D3).
   *
   * **LA SEMILLA NO SE ESCRIBE AQUÍ.** El trigger `company_nace_con_ajustes`
   * la pone desde P3, así que una company no puede existir sin sus parámetros
   * de costeo ni un instante. Duplicar esa escritura en el back office sería
   * tener dos sitios donde vive el valor por defecto del IVA.
   *
   * @throws {PlanDesconocidoError} · {@link MotivoInsuficienteError}
   */
  public async ejecutar(peticion: PeticionDeOperador, datos: DatosDeAlta): Promise<CompanyId> {
    await this.exigirPlanConocido(datos.plan);

    const id = await this.deps.repositorio.crearCompany({
      datos: {
        nombre: datos.nombre.trim(),
        plan: datos.plan,
        emailDelDueno: datos.emailDelDueno.trim().toLowerCase(),
      },
      acceso: accesoDe(peticion),
    });

    return id;
  }

  /** @throws {PlanDesconocidoError} */
  private async exigirPlanConocido(codigo: string): Promise<void> {
    const planes = await this.deps.repositorio.listarPlanes();
    if (!planes.some((plan) => plan.code === codigo)) {
      throw new PlanDesconocidoError(codigo);
    }
  }
}

export class CambiarPlan {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  /** @throws {PlanNoAlcanzaError} · {@link CompanyNoEncontradaError} */
  public async ejecutar(
    peticion: PeticionDeOperador,
    cambio: { readonly companyId: CompanyId; readonly plan: string },
  ): Promise<void> {
    const resultado = await this.deps.repositorio.cambiarPlan({
      companyId: cambio.companyId,
      plan: cambio.plan,
      acceso: accesoDe(peticion),
    });

    // BAJAR DE PLAN POR DEBAJO DE LO QUE LA COMPANY YA TIENE SE RECHAZA. No
    // rompe nada hoy: rompe el día que el cliente intente crear la siguiente
    // ubicación y nadie recuerde por qué no puede.
    if (resultado.clase === 'no_cabe') {
      throw new PlanNoAlcanzaError(resultado.recurso, resultado.tiene, resultado.maximo);
    }
  }
}

export class CambiarEstadoDeCompany {
  public constructor(private readonly deps: DependenciasDeCompanies) {}

  /**
   * Suspender surte efecto EN LA SIGUIENTE PETICIÓN de cualquiera de sus
   * usuarios: `ValidarSesion` comprueba el estado de la company en cada una
   * (desde P1). No hace falta revocar sesiones a mano.
   *
   * @throws {CompanyNoEncontradaError}
   */
  public async ejecutar(
    peticion: PeticionDeOperador,
    cambio: { readonly companyId: CompanyId; readonly estado: string },
  ): Promise<void> {
    // `CLOSED` no está entre los operables: cerrar una company no es cambiarle
    // el estado, es una decisión con consecuencias de retención de datos que
    // este paquete no resuelve. Mejor no ofrecerla que ofrecerla a medias.
    if (!ESTADOS_OPERABLES.includes(cambio.estado)) {
      throw new EstadoDesconocidoError(cambio.estado);
    }

    const cambiada = await this.deps.repositorio.cambiarEstado({
      companyId: cambio.companyId,
      estado: cambio.estado,
      acceso: accesoDe(peticion),
    });

    if (!cambiada) throw new CompanyNoEncontradaError();
  }
}
