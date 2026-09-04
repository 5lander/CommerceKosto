/**
 * El puerto de conteos, sobre PostgreSQL.
 *
 * **`confirmar` ES UNA SOLA TRANSACCIÓN**, y las tres escrituras que hace van
 * en un orden que no es casual:
 *
 *   1. se borran las líneas del borrador
 *   2. se escriben las líneas congeladas —incluidas las de lo que nadie contó—
 *   3. se marca la cabecera como `CONFIRMADO`
 *
 * La cabecera va **la última** porque el trigger
 * `physical_count_line_solo_en_borrador` rechaza tocar las líneas de un conteo
 * ya confirmado. Invertir el orden lo haría fallar contra su propia guarda.
 *
 * **NO SE ESCRIBE NINGÚN MOVIMIENTO AL CONFIRMAR.** El conteo no ajusta el
 * libro: si lo hiciera, `diferencia = conteo − stock_teorico` (SPEC §18) daría
 * cero siempre y el hallazgo desaparecería en el mismo acto de registrarlo.
 */

import { Injectable } from '@nestjs/common';

import { ALMACENAMIENTO } from '../../../shared/domain/decimal/escalas';
import {
  itemId as aItemId,
  locationId as aLocationId,
  periodId as aPeriodId,
  physicalCountId as aPhysicalCountId,
  type CompanyId,
  type LocationId,
  type PeriodId,
  type PhysicalCountId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import { BORRADOR, CONFIRMADO, type EstadoDeConteo } from '../domain/conteo';
import type {
  ConteoLeido,
  DatosDeConfirmacion,
  LineaLeida,
  LineaParaGuardar,
  RepositorioDeConteos,
} from '../application/ports/repositorio-de-conteos.port';

interface Decimal {
  toFixed: (decimales?: number) => string;
}

/** Misma escala que el resto de la API. Ver `prisma-inventario.repositorio.ts`. */
function aEscala(valor: Decimal | null): string | null {
  return valor === null ? null : valor.toFixed(ALMACENAMIENTO);
}

const CAMPOS = {
  id: true,
  periodId: true,
  status: true,
  cutoffAt: true,
  theoreticalValue: true,
  coveredValue: true,
  physicalValue: true,
  createdAt: true,
  confirmedAt: true,
  note: true,
  periodo: { select: { locationId: true, year: true, month: true } },
} as const;

interface FilaDeConteo {
  readonly id: string;
  readonly periodId: string;
  readonly status: string;
  readonly cutoffAt: Date;
  readonly theoreticalValue: Decimal | null;
  readonly coveredValue: Decimal | null;
  readonly physicalValue: Decimal | null;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly note: string | null;
  readonly periodo: { readonly locationId: string; readonly year: number; readonly month: number };
}

function comoConteo(fila: FilaDeConteo): ConteoLeido {
  return {
    id: aPhysicalCountId(fila.id),
    periodId: aPeriodId(fila.periodId),
    locationId: aLocationId(fila.periodo.locationId),
    anio: fila.periodo.year,
    mes: fila.periodo.month,
    estado: fila.status as EstadoDeConteo,
    corteEn: fila.cutoffAt,
    valorTeorico: aEscala(fila.theoreticalValue),
    valorCubierto: aEscala(fila.coveredValue),
    valorFisico: aEscala(fila.physicalValue),
    creadoEn: fila.createdAt,
    confirmadoEn: fila.confirmedAt,
    note: fila.note,
  };
}

@Injectable()
export class PrismaConteosRepositorio implements RepositorioDeConteos {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async crear(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly corteEn: Date;
    readonly note: string | null;
  }): Promise<PhysicalCountId> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.physicalCount.create({
        data: {
          companyId: entrada.companyId,
          periodId: entrada.periodId,
          status: BORRADOR,
          cutoffAt: entrada.corteEn,
          createdBy: entrada.userId,
          note: entrada.note,
        },
        select: { id: true },
      });
      return aPhysicalCountId(fila.id);
    });
  }

  public async buscar(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
  }): Promise<ConteoLeido | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.physicalCount.findFirst({
        where: { id: entrada.countId, companyId: entrada.companyId },
        select: CAMPOS,
      });
      return fila === null ? null : comoConteo(fila);
    });
  }

  public async listarPorUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly ConteoLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.physicalCount.findMany({
        where: { companyId: entrada.companyId, periodo: { locationId: entrada.locationId } },
        select: CAMPOS,
        orderBy: { cutoffAt: 'desc' },
      });
      return filas.map(comoConteo);
    });
  }

  public async confirmadoDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<ConteoLeido | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.physicalCount.findFirst({
        where: {
          companyId: entrada.companyId,
          periodId: entrada.periodId,
          status: CONFIRMADO,
        },
        select: CAMPOS,
      });
      return fila === null ? null : comoConteo(fila);
    });
  }

  public async lineas(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
  }): Promise<readonly LineaLeida[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.physicalCountLine.findMany({
        where: { companyId: entrada.companyId, countId: entrada.countId },
        select: { itemId: true, quantity: true, theoreticalQuantity: true, unitCost: true },
      });

      return filas.map((fila) => ({
        itemId: aItemId(fila.itemId),
        cantidad: aEscala(fila.quantity),
        teorico: aEscala(fila.theoreticalQuantity),
        costoUnitario: aEscala(fila.unitCost),
      }));
    });
  }

  /**
   * Reescribe la hoja entera: borra y vuelve a insertar.
   *
   * Es lo que hace posible el guardado de una grilla —lo que el usuario ve es
   * lo que queda— sin tener que averiguar qué línea es nueva, cuál cambió y
   * cuál desapareció. La tabla no es append-only: el libro sí, la hoja de
   * conteo no.
   */
  public async reemplazarLineas(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
    readonly lineas: readonly LineaParaGuardar[];
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.physicalCountLine.deleteMany({
        where: { companyId: entrada.companyId, countId: entrada.countId },
      });

      if (entrada.lineas.length === 0) return;

      await tx.physicalCountLine.createMany({
        data: entrada.lineas.map((linea) => ({
          companyId: entrada.companyId,
          countId: entrada.countId,
          itemId: linea.itemId,
          quantity: linea.cantidad,
        })),
      });
    });
  }

  public async confirmar(datos: DatosDeConfirmacion): Promise<void> {
    await this.transaccion.run(datos.companyId, async (tx) => {
      await tx.physicalCountLine.deleteMany({
        where: { companyId: datos.companyId, countId: datos.countId },
      });

      await tx.physicalCountLine.createMany({
        data: datos.lineas.map((linea) => ({
          companyId: datos.companyId,
          countId: datos.countId,
          itemId: linea.itemId,
          quantity: linea.cantidad,
          theoreticalQuantity: linea.teorico,
          unitCost: linea.costoUnitario,
        })),
      });

      // La cabecera, la ULTIMA: el trigger de las lineas mira su estado.
      await tx.physicalCount.update({
        where: { id: datos.countId },
        data: {
          status: CONFIRMADO,
          confirmedPeriodId: datos.periodId,
          theoreticalValue: datos.valorTeorico,
          coveredValue: datos.valorCubierto,
          physicalValue: datos.valorFisico,
          confirmedAt: datos.ahora,
          confirmedBy: datos.userId,
        },
        select: { id: true },
      });
    });
  }
}
