/**
 * La transferencia entre ubicaciones — R2.
 *
 * **EL ALCANCE SE EXIGE EN LAS DOS PUNTAS.** Un `GERENTE_LOCAL` que solo
 * gestiona el local A no puede sacar mercancía de la bodega B ni meterla en el
 * local C. Comprobar solo el origen dejaría abierta la mitad más peligrosa: la
 * de mover stock ajeno hacia el propio.
 *
 * **LA CABECERA Y LAS DOS PATAS SE ESCRIBEN EN UNA TRANSACCIÓN.** Media
 * transferencia —la salida sin la entrada— haría desaparecer mercancía de la
 * company, que es exactamente lo que el criterio de aceptación de P6 prohíbe.
 */

import type {
  ItemId,
  LocationId,
  TransferId,
} from '../../../../shared/domain/identity/identificadores';
import { Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { construirTransferencia } from '../../domain/transferencia';
import type { MovimientoParaGuardar } from '../ports/repositorio-de-inventario.port';
import {
  exigirItem,
  registrarEvento,
  exigirLibroEscribible,
  type DependenciasDeInventario,
} from './movimientos';

export interface DatosDeTransferencia {
  readonly origen: LocationId;
  readonly destino: LocationId;
  readonly itemId: ItemId;
  /** Magnitud positiva: el sentido lo pone el par. */
  readonly cantidad: string;
  readonly occurredAt: Date;
  readonly note: string | null;
}

export class RegistrarTransferencia {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {ItemDelLibroNoEncontradoError}
   * @throws {TransferenciaSinDestinoError} @throws {SignoIncoherenteError}
   * @throws {FechaFuturaError}
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeTransferencia): Promise<TransferId> {
    // LAS DOS UBICACIONES, y las dos por su propio período: mover mercancía
    // desde un almacén cuyo mes ya se cerró alteraría un inventario final que
    // ya se informó, aunque el local de destino tenga el suyo abierto.
    for (const ubicacion of [datos.origen, datos.destino]) {
      await exigirLibroEscribible({
        deps: this.deps,
        sesion,
        locationId: ubicacion,
        ocurridoEn: datos.occurredAt,
      });
    }

    const item = await exigirItem(this.deps, sesion, datos.itemId);

    const par = construirTransferencia({
      origen: datos.origen,
      destino: datos.destino,
      itemId: datos.itemId,
      cantidad: Quantity.of(datos.cantidad, unidadDeUso(item.unidadDeUso)),
      ocurridoEn: datos.occurredAt,
    });

    const transferId = await this.deps.repositorio.registrarTransferencia({
      companyId: sesion.companyId,
      userId: sesion.userId,
      fromLocationId: datos.origen,
      toLocationId: datos.destino,
      occurredAt: datos.occurredAt,
      note: datos.note,
      movimientos: par.map((movimiento) => comoFila(movimiento, datos.note)),
    });

    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.transfer.completed',
      detail: {
        transferId,
        origen: datos.origen,
        destino: datos.destino,
        itemId: datos.itemId,
      },
    });

    return transferId;
  }
}

/**
 * Una transferencia no lleva importe.
 *
 * El inventario se valora al costo estándar del ítem (SPEC §16 y §18), no al
 * que traía cada movimiento: mover mercancía entre dos almacenes de la misma
 * company no cambia lo que vale, así que un importe aquí sería un número sin
 * consumidor. Y `total_cost` nulo es lo que el `CHECK` de la base espera para
 * todo lo que no sea `COMPRA` ni `PRODUCCION`.
 */
function comoFila(
  movimiento: ReturnType<typeof construirTransferencia>[number],
  note: string | null,
): MovimientoParaGuardar {
  return {
    locationId: movimiento.locationId,
    itemId: movimiento.itemId,
    tipo: movimiento.tipo,
    cantidad: movimiento.cantidad.toStorageString(),
    costoTotal: null,
    purchaseArticleId: null,
    reversesMovementId: null,
    occurredAt: movimiento.ocurridoEn,
    note,
  };
}
