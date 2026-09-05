/**
 * Abrir, cerrar, reabrir y consultar un mes contable — D6.
 *
 * **`ExigirPeriodoAbierto` ES LA PIEZA QUE USA EL RESTO DEL SISTEMA.** La
 * llaman las cinco escrituras del libro de inventario, y su único trabajo es
 * convertir «hay un período cerrado que cubre esta fecha» en un error de
 * dominio con mensaje, antes de que la base lo rechace con un `P0001` que
 * saldría como `INTERNAL_ERROR 500` (INC-012).
 *
 * **NO ES LA GARANTÍA, ES LA EXPLICACIÓN.** La garantía es el trigger
 * `inventory_movement_respeta_periodo_cerrado`, que cubre por construcción las
 * cinco rutas de escritura y las que se escriban mañana. Una guarda de
 * aplicación protege contra el usuario; el trigger protege contra nosotros.
 */

import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { LocationId, PeriodId } from '../../../../shared/domain/identity/identificadores';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import { ABIERTO, CERRADO, exigirCerrable, exigirReabrible } from '../../domain/cierre';
import { PeriodoCerradoError, PeriodoNoEncontradoError } from '../../domain/errores';
import { CalendarioDePeriodos, Periodo } from '../../domain/periodo';
import type { PeriodoLeido, RepositorioDePeriodos } from '../ports/repositorio-de-periodos.port';

export interface DependenciasDePeriodos {
  readonly repositorio: RepositorioDePeriodos;
  readonly calendario: CalendarioDePeriodos;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

export interface MesPedido {
  readonly locationId: LocationId;
  readonly anio: number;
  readonly mes: number;
}

/**
 * Crea la fila del mes si no existía, con su frontera ya resuelta.
 *
 * @throws {UbicacionFueraDeAlcanceError} @throws {MesInvalidoError}
 */
export class AsegurarPeriodo {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesPedido): Promise<PeriodoLeido> {
    return asegurarMes(this.deps, sesion, pedido);
  }
}

async function asegurarMes(
  deps: DependenciasDePeriodos,
  sesion: SesionActiva,
  pedido: MesPedido,
): Promise<PeriodoLeido> {
  exigirUbicacionEnAlcance(sesion, pedido.locationId);
  const periodo = deps.calendario.de(pedido.anio, pedido.mes);

  return deps.repositorio.asegurar({
    companyId: sesion.companyId,
    locationId: pedido.locationId,
    anio: periodo.anio,
    mes: periodo.mes,
    inicioEn: periodo.inicioEn,
    finEn: periodo.finEn,
  });
}

/**
 * Cierra el mes de una ubicación. A partir de aquí es de solo lectura (D6).
 *
 * **QUIEN LO LLAMA ES `inventory`**, al confirmar el conteo físico, porque eso
 * es lo que D6 describe: «se cierra manualmente al cargar el conteo físico».
 * No hay un endpoint de cierre suelto, y la razón no es de gusto: un mes que se
 * sella sin el conteo que lo mide no puede producir food cost real, y el
 * sistema se quedaría con un mes cerrado y ciego.
 */
export class CerrarPeriodo {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {PeriodoYaCerradoError}
   * @throws {PeriodoNoTerminadoError}
   */
  public async ejecutar(sesion: SesionActiva, pedido: MesPedido): Promise<PeriodId> {
    const fila = await asegurarMes(this.deps, sesion, pedido);
    const ahora = this.deps.reloj.ahora();

    exigirCerrable({ periodo: comoPeriodo(fila), estadoActual: fila.estado, ahora });

    await this.deps.repositorio.cambiarEstado({
      companyId: sesion.companyId,
      periodId: fila.id,
      userId: sesion.userId,
      estado: CERRADO,
      ahora,
    });

    await registrarEventoDePeriodo({ deps: this.deps, sesion, eventType: 'period.closed', fila });
    return fila.id;
  }
}

/**
 * Reabre un mes cerrado. **Solo el `OWNER`**, y queda registrado (D6).
 *
 * El permiso `period.reopen` no se concede a ningún otro rol. Reabrir un mes
 * permite mover cifras que ya se informaron, así que la restricción es de
 * control interno antes que de seguridad.
 */
export class ReabrirPeriodo {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  /**
   * @throws {PeriodoNoEncontradoError} @throws {UbicacionFueraDeAlcanceError}
   * @throws {PeriodoNoCerradoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly periodId: PeriodId; readonly motivo: string },
  ): Promise<void> {
    const fila = await this.deps.repositorio.buscarPorId({
      companyId: sesion.companyId,
      periodId: entrada.periodId,
    });
    if (fila === null) throw new PeriodoNoEncontradoError();

    exigirUbicacionEnAlcance(sesion, fila.locationId);
    exigirReabrible({ periodo: comoPeriodo(fila), estadoActual: fila.estado });

    await this.deps.repositorio.cambiarEstado({
      companyId: sesion.companyId,
      periodId: fila.id,
      userId: sesion.userId,
      estado: ABIERTO,
      ahora: this.deps.reloj.ahora(),
    });

    await registrarEventoDePeriodo({
      deps: this.deps,
      sesion,
      eventType: 'period.reopened',
      fila,
      motivo: entrada.motivo,
    });
  }
}

/**
 * Un mes concreto, sin crearlo si no existe.
 *
 * **NO USA `AsegurarPeriodo`, Y LA DIFERENCIA IMPORTA:** asegurar ESCRIBE una
 * fila. Una lectura que crea filas como efecto colateral convierte cualquier
 * `GET` en una escritura, y basta con consultar un año hacia atrás para
 * sembrar la tabla de meses que nadie abrió.
 */
export class ConsultarPeriodo {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  /** @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(sesion: SesionActiva, pedido: MesPedido): Promise<PeriodoLeido | null> {
    exigirUbicacionEnAlcance(sesion, pedido.locationId);
    return this.deps.repositorio.buscar({
      companyId: sesion.companyId,
      locationId: pedido.locationId,
      anio: pedido.anio,
      mes: pedido.mes,
    });
  }
}

export class ConsultarPeriodos {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  /** @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId },
  ): Promise<readonly PeriodoLeido[]> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);
    return this.deps.repositorio.listar({
      companyId: sesion.companyId,
      locationId: entrada.locationId,
    });
  }
}

/**
 * La guarda que llaman las escrituras del libro. Ver la cabecera del archivo.
 *
 * **NO COMPRUEBA EL ALCANCE DE UBICACIÓN A PROPÓSITO.** Quien la llama ya lo
 * ha hecho —es lo primero que hace toda escritura del libro— y repetirlo aquí
 * daría el error equivocado: un `GERENTE_LOCAL` que escribe en su propia
 * ubicación en un mes cerrado tiene que leer «el período está cerrado», no
 * «esa ubicación no es tuya».
 */
export class ExigirPeriodoAbierto {
  public constructor(private readonly deps: DependenciasDePeriodos) {}

  /** @throws {PeriodoCerradoError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId; readonly ocurridoEn: Date },
  ): Promise<void> {
    const cerrado = await this.deps.repositorio.hayCerradoQueContiene({
      companyId: sesion.companyId,
      locationId: entrada.locationId,
      instante: entrada.ocurridoEn,
    });

    if (cerrado !== null) {
      throw new PeriodoCerradoError(comoPeriodo(cerrado).etiqueta);
    }
  }
}

function comoPeriodo(fila: PeriodoLeido): Periodo {
  return Periodo.reconstruir({
    anio: fila.anio,
    mes: fila.mes,
    inicioEn: fila.inicioEn,
    finEn: fila.finEn,
  });
}

/** El evento de auditoría de un cambio de estado (SEGURIDAD.md §10). */
interface EventoDePeriodo {
  readonly deps: DependenciasDePeriodos;
  readonly sesion: SesionActiva;
  readonly eventType: string;
  readonly fila: PeriodoLeido;
  readonly motivo?: string;
}

async function registrarEventoDePeriodo(evento: EventoDePeriodo): Promise<void> {
  const { sesion, fila } = evento;

  await registrarEventoDeUsuario({
    auditoria: evento.deps.auditoria,
    actorId: sesion.userId,
    companyId: sesion.companyId,
    eventType: evento.eventType,
    detail: {
      periodId: fila.id,
      locationId: fila.locationId,
      periodo: comoPeriodo(fila).etiqueta,
      ...(evento.motivo === undefined ? {} : { motivo: evento.motivo }),
    },
  });
}
