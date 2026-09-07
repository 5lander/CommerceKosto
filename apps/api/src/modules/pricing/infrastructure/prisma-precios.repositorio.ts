/**
 * El puerto de precios, sobre PostgreSQL.
 *
 * `resolver` LLEVA LA CONDICIÓN EN EL `WHERE`, no en un `if` previo, y es la
 * parte que importa de este archivo. Dos administradores que confirman el mismo
 * precio a la vez compiten por la misma fila: `updateMany` con
 * `status: 'SUGGESTED'` deja que gane exactamente uno, y el otro recibe `count
 * = 0` y se entera. Leer primero y decidir después tendría una ventana entre
 * las dos operaciones, y en esa ventana los dos creerían haber ganado.
 *
 * TODO DECIMAL SALE COMO CADENA, con `toFixed()`. Nunca `number`.
 */

import { Injectable } from '@nestjs/common';

import {
  itemId as aItemId,
  purchaseArticleId as aArticleId,
  referencePriceId as aPriceId,
  type CompanyId,
  type ItemId,
  type ReferencePriceId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  AjustesDeCompany,
  DatosDePrecioEnLote,
  DatosParaSugerir,
  DecisionSobrePrecio,
  PrecioLeido,
  RepositorioDePrecios,
  ResultadoDeResolucion,
} from '../application/ports/repositorio-de-precios.port';
import { ESTADO_CONFIRMADO } from '../domain/vigencia';

const SUGERIDO = 'SUGGESTED';
const CONFIRMADO = ESTADO_CONFIRMADO;

interface Decimal {
  toFixed: () => string;
}

const CAMPOS_DE_PRECIO = {
  id: true,
  itemId: true,
  purchaseArticleId: true,
  price: true,
  ivaCompra: true,
  origin: true,
  status: true,
  validFrom: true,
  createdAt: true,
  note: true,
} as const;

@Injectable()
export class PrismaPreciosRepositorio implements RepositorioDePrecios {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async ajustes(companyId: CompanyId): Promise<AjustesDeCompany | null> {
    return this.transaccion.run(companyId, async (tx) => {
      const fila = await tx.companySettings.findFirst({ where: { companyId } });
      return fila === null ? null : comoAjustes(fila);
    });
  }

  public async guardarAjustes(entrada: {
    readonly companyId: CompanyId;
    readonly ajustes: AjustesDeCompany;
  }): Promise<void> {
    const { companyId, ajustes } = entrada;

    await this.transaccion.run(companyId, async (tx) => {
      // `updateMany` y no `update`: sin `RETURNING`, y con el tenant repetido
      // en el WHERE aunque RLS ya lo filtre.
      await tx.companySettings.updateMany({
        where: { companyId },
        data: {
          ivaVenta: ajustes.ivaVenta,
          ivaCompra: ajustes.ivaCompra,
          ivaCompraRecuperable: ajustes.ivaCompraRecuperable,
          provisionMerma: ajustes.provisionMerma,
          foodCostObjetivo: ajustes.foodCostObjetivo,
          foodCostMaximo: ajustes.foodCostMaximo,
          foodCostUmbralVerde: ajustes.foodCostUmbralVerde,
          primeCostMaximo: ajustes.primeCostMaximo,
          reglaPopularidad: ajustes.reglaPopularidad,
          diasOperativosMes: ajustes.diasOperativosMes,
          diasCobertura: ajustes.diasCobertura,
        },
      });
    });
  }

  public async sugerir(datos: DatosParaSugerir): Promise<ReferencePriceId> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const fila = await tx.referencePrice.create({
        data: {
          companyId: datos.companyId,
          itemId: datos.itemId,
          purchaseArticleId: datos.purchaseArticleId,
          price: datos.precio,
          ivaCompra: datos.ivaCompra,
          origin: datos.origen,
          status: SUGERIDO,
          validFrom: datos.validFrom,
          createdBy: datos.createdBy,
          note: datos.nota,
        },
        select: { id: true },
      });

      return aPriceId(fila.id);
    });
  }

  /**
   * TODO EL LOTE O NADA — un solo `run()`, una sola transaccion, y los precios
   * escritos con `createMany` en UNA sentencia.
   *
   * `confirmedBy` y `confirmedAt` se rellenan aqui cuando `confirmar` es cierto,
   * en la misma escritura: no hay un segundo paso que pudiera quedarse a medias
   * y dejar la mitad del catalogo con precio vigente y la otra mitad sin el.
   */
  public async sugerirEnLote(datos: {
    readonly companyId: CompanyId;
    readonly precios: readonly DatosDePrecioEnLote[];
    readonly validFrom: Date;
    readonly createdBy: UserId;
    readonly confirmar: boolean;
    readonly ahora: Date;
  }): Promise<number> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      await tx.referencePrice.createMany({
        data: datos.precios.map((precio) => ({
          companyId: datos.companyId,
          itemId: precio.itemId,
          purchaseArticleId: precio.purchaseArticleId,
          price: precio.precio,
          ivaCompra: precio.ivaCompra,
          origin: precio.origen,
          status: datos.confirmar ? CONFIRMADO : SUGERIDO,
          validFrom: datos.validFrom,
          createdBy: datos.createdBy,
          confirmedBy: datos.confirmar ? datos.createdBy : null,
          confirmedAt: datos.confirmar ? datos.ahora : null,
          note: precio.nota,
        })),
      });

      return datos.precios.length;
    });
  }

  public async resolver(entrada: {
    readonly companyId: CompanyId;
    readonly precioId: ReferencePriceId;
    readonly userId: UserId;
    readonly ahora: Date;
    readonly decision: DecisionSobrePrecio;
  }): Promise<ResultadoDeResolucion> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const confirmado = entrada.decision === 'CONFIRMED';

      const resultado = await tx.referencePrice.updateMany({
        // `status: SUGERIDO` es lo que cierra la carrera: gana quien llegue
        // primero, y el segundo ve `count = 0`.
        where: { id: entrada.precioId, companyId: entrada.companyId, status: SUGERIDO },
        data: {
          status: entrada.decision,
          // La restricción `reference_price_confirmacion_coherente` exige que
          // autor y fecha vayan con el estado, y que NO estén si se rechaza.
          confirmedBy: confirmado ? entrada.userId : null,
          confirmedAt: confirmado ? entrada.ahora : null,
        },
      });

      if (resultado.count > 0) {
        return 'resuelto';
      }

      const existe = await tx.referencePrice.findFirst({
        where: { id: entrada.precioId, companyId: entrada.companyId },
        select: { id: true },
      });

      return existe === null ? 'no_encontrado' : 'ya_resuelto';
    });
  }

  public async historial(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId;
  }): Promise<readonly PrecioLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.referencePrice.findMany({
        where: { companyId: entrada.companyId, itemId: entrada.itemId },
        select: CAMPOS_DE_PRECIO,
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      return filas.map(comoPrecio);
    });
  }

  public async confirmadosHasta(entrada: {
    readonly companyId: CompanyId;
    readonly hasta: Date;
  }): Promise<readonly PrecioLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.referencePrice.findMany({
        // El filtro por estado va en el WHERE y no en memoria: los sugeridos y
        // los rechazados no tienen por que viajar. Aun asi, cual de los
        // confirmados esta vigente lo decide el dominio (R5).
        where: {
          companyId: entrada.companyId,
          status: CONFIRMADO,
          validFrom: { lte: entrada.hasta },
        },
        select: CAMPOS_DE_PRECIO,
        // Sirve al indice `(company_id, item_id, valid_from DESC)` de §5.
        orderBy: [{ itemId: 'asc' }, { validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      return filas.map(comoPrecio);
    });
  }
}

function comoPrecio(fila: {
  id: string;
  itemId: string;
  purchaseArticleId: string | null;
  price: Decimal;
  ivaCompra: Decimal;
  origin: string;
  status: string;
  validFrom: Date;
  createdAt: Date;
  note: string | null;
}): PrecioLeido {
  return {
    id: aPriceId(fila.id),
    itemId: aItemId(fila.itemId),
    purchaseArticleId: fila.purchaseArticleId === null ? null : aArticleId(fila.purchaseArticleId),
    precio: fila.price.toFixed(),
    ivaCompra: fila.ivaCompra.toFixed(),
    origen: fila.origin,
    estado: fila.status,
    validFrom: fila.validFrom,
    createdAt: fila.createdAt,
    nota: fila.note,
  };
}

function comoAjustes(fila: {
  ivaVenta: Decimal;
  ivaCompra: Decimal;
  ivaCompraRecuperable: boolean;
  provisionMerma: Decimal;
  foodCostObjetivo: Decimal;
  foodCostMaximo: Decimal;
  foodCostUmbralVerde: Decimal;
  primeCostMaximo: Decimal;
  reglaPopularidad: Decimal;
  diasOperativosMes: number;
  diasCobertura: number;
}): AjustesDeCompany {
  return {
    ivaVenta: fila.ivaVenta.toFixed(),
    ivaCompra: fila.ivaCompra.toFixed(),
    ivaCompraRecuperable: fila.ivaCompraRecuperable,
    provisionMerma: fila.provisionMerma.toFixed(),
    foodCostObjetivo: fila.foodCostObjetivo.toFixed(),
    foodCostMaximo: fila.foodCostMaximo.toFixed(),
    foodCostUmbralVerde: fila.foodCostUmbralVerde.toFixed(),
    primeCostMaximo: fila.primeCostMaximo.toFixed(),
    reglaPopularidad: fila.reglaPopularidad.toFixed(),
    diasOperativosMes: fila.diasOperativosMes,
    diasCobertura: fila.diasCobertura,
  };
}
