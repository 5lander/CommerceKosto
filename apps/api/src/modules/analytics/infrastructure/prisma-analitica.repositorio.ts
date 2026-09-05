/**
 * El puerto de analítica, sobre PostgreSQL. **Solo sus dos tablas.**
 *
 * Las dos escrituras son por **reemplazo**: `deleteMany` + `createMany` dentro
 * de la misma transacción de tenant. Es lo que hace posible guardar una grilla
 * —lo que el usuario ve al guardar es lo que queda— sin averiguar qué fila
 * cambió. El `GRANT` de la migración concede `DELETE` y **no** `UPDATE`, para
 * que no exista la forma de dejar media grilla del mes pasado mezclada con la
 * de este.
 */

import { Injectable } from '@nestjs/common';

import { ALMACENAMIENTO } from '../../../shared/domain/decimal/escalas';
import {
  productId as aProductId,
  type CompanyId,
  type PeriodId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type { ClasificacionDeCosto } from '../domain/punto-de-equilibrio';
import type {
  CostoLeido,
  RepositorioDeAnalitica,
  VentaLeida,
} from '../application/ports/repositorio-de-analitica.port';

interface Decimal {
  toFixed: (decimales?: number) => string;
}

/** Misma escala que el resto de la API. Ver `prisma-inventario.repositorio.ts`. */
function aEscala(valor: Decimal): string {
  return valor.toFixed(ALMACENAMIENTO);
}

@Injectable()
export class PrismaAnaliticaRepositorio implements RepositorioDeAnalitica {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async ventasDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly VentaLeida[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.productSales.findMany({
        where: { companyId: entrada.companyId, periodId: entrada.periodId },
        select: { productId: true, units: true },
      });

      return filas.map((fila) => ({
        productId: aProductId(fila.productId),
        unidades: aEscala(fila.units),
      }));
    });
  }

  public async reemplazarVentas(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly ventas: readonly VentaLeida[];
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.productSales.deleteMany({
        where: { companyId: entrada.companyId, periodId: entrada.periodId },
      });
      if (entrada.ventas.length === 0) return;

      await tx.productSales.createMany({
        data: entrada.ventas.map((venta) => ({
          companyId: entrada.companyId,
          periodId: entrada.periodId,
          productId: venta.productId,
          units: venta.unidades,
          createdBy: entrada.userId,
        })),
      });
    });
  }

  public async costosDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly CostoLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.fixedCost.findMany({
        where: { companyId: entrada.companyId, periodId: entrada.periodId },
        select: { concept: true, classification: true, amount: true },
        orderBy: { concept: 'asc' },
      });

      return filas.map((fila) => ({
        concepto: fila.concept,
        clasificacion: fila.classification as ClasificacionDeCosto,
        importe: aEscala(fila.amount),
      }));
    });
  }

  public async reemplazarCostos(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly costos: readonly CostoLeido[];
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.fixedCost.deleteMany({
        where: { companyId: entrada.companyId, periodId: entrada.periodId },
      });
      if (entrada.costos.length === 0) return;

      await tx.fixedCost.createMany({
        data: entrada.costos.map((costo) => ({
          companyId: entrada.companyId,
          periodId: entrada.periodId,
          concept: costo.concepto,
          classification: costo.clasificacion,
          amount: costo.importe,
          createdBy: entrada.userId,
        })),
      });
    });
  }
}
