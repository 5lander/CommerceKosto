/**
 * El consumo que genera una venta — el interruptor de stock, en funcionamiento.
 *
 * Recibe unidades vendidas por producto y escribe una salida por ítem. Lo que
 * decide **hasta dónde baja** es `llevaStock` de cada preparación:
 *
 *   · con stock propio → se consume la preparación (ya se produjo en lote)
 *   · sin stock propio → se explota su receta y se consumen los insumos
 *
 * Descender por una preparación que sí está en el inventario descontaría dos
 * veces lo mismo: una al producirla y otra al venderla.
 *
 * **TODAS LAS SALIDAS ENTRAN EN UNA TRANSACCIÓN.** Media venta descontada deja
 * un inventario que no cuadra con nada y que, por ser append-only, hay que
 * corregir a mano movimiento por movimiento.
 *
 * **NO GUARDA LAS UNIDADES VENDIDAS.** Aquí se registra su CONSECUENCIA sobre
 * el stock. La cifra de ventas del mes —que P8 necesita para la venta neta y el
 * food cost— es un dato distinto, con su propio período, y su tabla llega con
 * las vistas analíticas. Anotado en `ESTADO.md`.
 */

import type {
  ItemId,
  LocationId,
  MovementId,
  ProductId,
} from '../../../../shared/domain/identity/identificadores';
import { Quantity, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { CartaDeUbicacion, LeerCarta } from '../../../recipes/application/casos-de-uso/carta';
import type { RecetaLeida } from '../../../recipes/application/ports/repositorio-de-recetas.port';
import { ItemDelLibroNoEncontradoError } from '../../domain/errores';
import {
  explotarConsumo,
  type CatalogoDeConsumo,
  type ItemConsumible,
  type LineaDeConsumo,
} from '../../domain/explosion';
import { conSignoDelTipo } from '../../domain/movimiento';
import type { MovimientoParaGuardar } from '../ports/repositorio-de-inventario.port';
import {
  exigirLibroEscribible,
  registrarEvento,
  type DependenciasDeInventario,
} from './movimientos';

export interface DependenciasDeConsumo extends DependenciasDeInventario {
  readonly leerCarta: LeerCarta;
}

export interface VentaDeProducto {
  readonly productId: ProductId;
  /** Unidades vendidas. Puede ser decimal: media porción es una venta legítima. */
  readonly unidades: string;
}

export interface DatosDeConsumo {
  readonly locationId: LocationId;
  readonly ventas: readonly VentaDeProducto[];
  readonly occurredAt: Date;
  readonly note: string | null;
}

export class RegistrarConsumoPorVenta {
  public constructor(private readonly deps: DependenciasDeConsumo) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {FechaFuturaError}
   * @throws {CicloEnConsumoError} @throws {ItemDelLibroNoEncontradoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: DatosDeConsumo,
  ): Promise<readonly MovementId[]> {
    await exigirLibroEscribible({
      deps: this.deps,
      sesion,
      locationId: datos.locationId,
      ocurridoEn: datos.occurredAt,
    });

    const [carta, items] = await Promise.all([
      this.deps.leerCarta.ejecutar(sesion, {
        locationId: datos.locationId,
        fecha: datos.occurredAt,
      }),
      this.deps.listarItems.ejecutar(sesion, false),
    ]);

    const consumo = totalConsumido(datos.ventas, carta, catalogoDeConsumo(items, carta));
    const movimientos = [...consumo]
      // Un ítem cuyo consumo suma CERO —todas sus líneas inactivas, o una
      // cantidad de receta a cero— no genera movimiento. La base rechaza las
      // filas de cantidad nula, y con razón: no son un hecho.
      .filter(([, cantidad]) => !cantidad.isZero())
      .map(([itemId, cantidad]) => salida({ itemId, cantidad, items, datos }));

    if (movimientos.length === 0) return [];

    const ids = await this.deps.repositorio.registrarVarios({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimientos,
    });

    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.movement.recorded',
      detail: {
        tipo: 'CONSUMO_POR_VENTA',
        locationId: datos.locationId,
        items: String(ids.length),
      },
    });

    return ids;
  }
}

/** Suma el consumo de todos los productos vendidos en un solo mapa. */
function totalConsumido(
  ventas: readonly VentaDeProducto[],
  carta: CartaDeUbicacion,
  catalogo: CatalogoDeConsumo,
): ReadonlyMap<ItemId, Ratio> {
  const total = new Map<ItemId, Ratio>();

  for (const venta of ventas) {
    const receta = carta.recetasDeProducto.get(venta.productId);
    if (receta === undefined) continue;

    const parcial = explotarConsumo({
      receta: receta.lineas.map(comoLineaDeConsumo),
      unidadesVendidas: Ratio.fromDecimalString(venta.unidades),
      catalogo,
    });

    for (const [itemId, cantidad] of parcial) {
      const previo = total.get(itemId);
      total.set(itemId, previo === undefined ? cantidad : previo.plus(cantidad));
    }
  }

  return total;
}

/**
 * Una línea `INACTIVA` no consume nada, igual que no cuesta nada (SPEC §13).
 *
 * Se filtra aquí y no en el dominio porque el dominio recibe el grafo ya
 * resuelto: la explosión no sabe de estados de línea, sabe de cantidades.
 */
function comoLineaDeConsumo(linea: RecetaLeida['lineas'][number]): LineaDeConsumo {
  return {
    itemId: linea.itemId,
    cantidad:
      linea.estado === 'ACTIVA' ? Ratio.fromDecimalString(linea.cantidad) : Ratio.CERO,
  };
}

function catalogoDeConsumo(
  items: readonly ItemLeido[],
  carta: CartaDeUbicacion,
): CatalogoDeConsumo {
  const catalogo = new Map<ItemId, ItemConsumible>();

  for (const item of items) {
    const receta = carta.recetasDeItem.get(item.id);
    catalogo.set(item.id, {
      // `llevaStock` es null en los ítems COMPRADOS, que son hojas de todas
      // formas: sin receta no hay por dónde bajar.
      llevaStock: item.llevaStock === true,
      receta: receta === undefined ? null : receta.lineas.map(comoLineaDeConsumo),
    } satisfies ItemConsumible);
  }

  return catalogo;
}

function salida(entrada: {
  readonly itemId: ItemId;
  readonly cantidad: Ratio;
  readonly items: readonly ItemLeido[];
  readonly datos: DatosDeConsumo;
}): MovimientoParaGuardar {
  const item = entrada.items.find((candidato) => candidato.id === entrada.itemId);
  if (item === undefined) throw new ItemDelLibroNoEncontradoError();

  const magnitud = Quantity.of(entrada.cantidad.toExactString(), unidadDeUso(item.unidadDeUso));

  return {
    locationId: entrada.datos.locationId,
    itemId: entrada.itemId,
    tipo: 'CONSUMO_POR_VENTA',
    cantidad: conSignoDelTipo('CONSUMO_POR_VENTA', magnitud).toStorageString(),
    costoTotal: null,
    purchaseArticleId: null,
    reversesMovementId: null,
    occurredAt: entrada.datos.occurredAt,
    note: entrada.datos.note,
  };
}
