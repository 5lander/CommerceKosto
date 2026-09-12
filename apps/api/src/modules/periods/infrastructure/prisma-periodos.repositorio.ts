/**
 * El puerto de períodos, sobre PostgreSQL.
 *
 * **`hayCerradoQueContiene` ES UNA COMPARACIÓN DE INSTANTES, NO ARITMÉTICA DE
 * FECHAS.** `starts_at <= x < ends_at` sobre columnas `timestamptz`, sin
 * `date_trunc`, sin `AT TIME ZONE` y sin extraer el mes de nada. La zona
 * horaria se resolvió una vez, al abrir el período, y por eso esta consulta
 * puede usar el índice `(company_id, location_id, starts_at)` en vez de
 * calcular una expresión por fila.
 *
 * Es exactamente la misma comparación que hace el trigger
 * `inventory_movement_respeta_periodo_cerrado`, y hay una prueba que las pone
 * de acuerdo en el instante frontera: la guarda y la garantía tienen que
 * rechazar los mismos movimientos, o una de las dos miente.
 */

import { Injectable } from '@nestjs/common';

import {
  locationId as aLocationId,
  periodId as aPeriodId,
  userId as aUserId,
  type CompanyId,
  type LocationId,
  type PeriodId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import { CERRADO, type EstadoDePeriodo } from '../domain/cierre';
import type {
  PeriodoLeido,
  RepositorioDePeriodos,
} from '../application/ports/repositorio-de-periodos.port';

const CAMPOS = {
  id: true,
  locationId: true,
  year: true,
  month: true,
  startsAt: true,
  endsAt: true,
  status: true,
  closedAt: true,
  closedBy: true,
  reopenedAt: true,
  reopenedBy: true,
  version: true,
} as const;

/** Lo que las tres búsquedas pueden filtrar. Siempre con el tenant delante. */
interface FiltroDePeriodo {
  readonly companyId: string;
  readonly id?: string;
  readonly locationId?: string;
  readonly year?: number;
  readonly month?: number;
  readonly status?: string;
  readonly startsAt?: { readonly lte: Date };
  readonly endsAt?: { readonly gt: Date };
}

interface FilaDePeriodo {
  readonly id: string;
  readonly locationId: string;
  readonly year: number;
  readonly month: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: string;
  readonly closedAt: Date | null;
  readonly closedBy: string | null;
  readonly reopenedAt: Date | null;
  readonly reopenedBy: string | null;
  readonly version: number;
}

function comoPeriodo(fila: FilaDePeriodo): PeriodoLeido {
  return {
    id: aPeriodId(fila.id),
    locationId: aLocationId(fila.locationId),
    anio: fila.year,
    mes: fila.month,
    inicioEn: fila.startsAt,
    finEn: fila.endsAt,
    estado: fila.status as EstadoDePeriodo,
    cerradoEn: fila.closedAt,
    cerradoPor: fila.closedBy === null ? null : aUserId(fila.closedBy),
    reabiertoEn: fila.reopenedAt,
    reabiertoPor: fila.reopenedBy === null ? null : aUserId(fila.reopenedBy),
    version: fila.version,
  };
}

/**
 * Cerrar conserva el rastro; reabrir lo añade sin borrarlo.
 *
 * Un período reabierto sigue diciendo cuándo se selló y quién lo hizo. La
 * historia completa de idas y venidas está en `audit_log`, que sí es
 * append-only: esta fila guarda el estado, no la crónica.
 */
function marcaDelCambio(entrada: {
  readonly estado: EstadoDePeriodo;
  readonly userId: UserId;
  readonly ahora: Date;
}): Record<string, string | Date> {
  return entrada.estado === CERRADO
    ? { status: entrada.estado, closedAt: entrada.ahora, closedBy: entrada.userId }
    : { status: entrada.estado, reopenedAt: entrada.ahora, reopenedBy: entrada.userId };
}

@Injectable()
export class PrismaPeriodosRepositorio implements RepositorioDePeriodos {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async asegurar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly anio: number;
    readonly mes: number;
    readonly inicioEn: Date;
    readonly finEn: Date;
  }): Promise<PeriodoLeido> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.period.upsert({
        where: {
          companyId_locationId_year_month: {
            companyId: entrada.companyId,
            locationId: entrada.locationId,
            year: entrada.anio,
            month: entrada.mes,
          },
        },
        // Si ya existe se devuelve tal cual: la frontera que manda es la que se
        // escribió al abrirlo, no la que la zona horaria de hoy produciría.
        update: {},
        create: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          year: entrada.anio,
          month: entrada.mes,
          startsAt: entrada.inicioEn,
          endsAt: entrada.finEn,
          status: 'ABIERTO',
        },
        select: CAMPOS,
      });
      return comoPeriodo(fila);
    });
  }

  public async buscar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly anio: number;
    readonly mes: number;
  }): Promise<PeriodoLeido | null> {
    return this.uno(entrada.companyId, {
      companyId: entrada.companyId,
      locationId: entrada.locationId,
      year: entrada.anio,
      month: entrada.mes,
    });
  }

  public async buscarPorId(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<PeriodoLeido | null> {
    return this.uno(entrada.companyId, { id: entrada.periodId, companyId: entrada.companyId });
  }

  public async listar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly PeriodoLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.period.findMany({
        where: { companyId: entrada.companyId, locationId: entrada.locationId },
        select: CAMPOS,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      });
      return filas.map(comoPeriodo);
    });
  }

  public async hayCerradoQueContiene(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly instante: Date;
  }): Promise<PeriodoLeido | null> {
    return this.uno(entrada.companyId, {
      companyId: entrada.companyId,
      locationId: entrada.locationId,
      status: CERRADO,
      // Semiabierto: el instante final ya es del mes siguiente.
      startsAt: { lte: entrada.instante },
      endsAt: { gt: entrada.instante },
    });
  }

  /** Las tres búsquedas de un período solo se diferencian en el filtro. */
  private async uno(
    companyId: CompanyId,
    filtro: FiltroDePeriodo,
  ): Promise<PeriodoLeido | null> {
    return this.transaccion.run(companyId, async (tx) => {
      const fila = await tx.period.findFirst({ where: filtro, select: CAMPOS });
      return fila === null ? null : comoPeriodo(fila);
    });
  }

  public async cambiarEstado(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly estado: EstadoDePeriodo;
    readonly ahora: Date;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.period.update({
        where: { id: entrada.periodId },
        data: marcaDelCambio(entrada),
        select: { id: true },
      });
    });
  }
}
