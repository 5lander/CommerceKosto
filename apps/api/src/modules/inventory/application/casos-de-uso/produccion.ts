/**
 * El registro de un lote producido — R10.
 *
 * **LOS INSUMOS LOS DECLARA QUIEN PRODUJO, no se derivan de la receta.** Es la
 * decisión que hace que la varianza signifique algo: si los insumos fueran
 * siempre «la receta por la cantidad», el consumo real y el teórico coincidirían
 * por construcción y la varianza operativa —haber usado 2,2 kg donde la receta
 * dice 2— sería invisible. La receta sirve para **precargar** el formulario;
 * eso es trabajo del frontend (P12), no del dominio.
 *
 * **EL COSTO ESTÁNDAR ES EL PRECIO DE REFERENCIA CONFIRMADO**, tal como R10 lo
 * escribe. Conviene saber que esto se aparta de lo que el motor de costeo de P5
 * hace con el mismo ítem: allí, si la preparación tiene receta, manda la receta
 * (ADR-008). Aquí no, y por una razón que solo aparece cuando hay un libro
 * delante: **el valor de un inventario no puede cambiar porque alguien edite
 * una receta.** Valorar el libro con la receta vigente reescribiría el valor de
 * lotes producidos hace meses. El precio de referencia es una fila con vigencia
 * que nadie sobrescribe (R5), y por eso es la única base estable.
 *
 * El desajuste entre ambos no se pierde: **es la varianza**, y esa es
 * exactamente la señal que R10 quiere conservar — «tu costo estándar para esta
 * preparación se quedó viejo».
 *
 * **UNA PREPARACIÓN SIN PRECIO CONFIRMADO NO SE PUEDE PRODUCIR.** Sin costo
 * estándar no hay contra qué medir, y valorar el alta al costo real es
 * precisamente lo que R10 prohíbe.
 */

import type {
  ItemId,
  LocationId,
  ProductionId,
} from '../../../../shared/domain/identity/identificadores';
import { Money, Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso, type UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { CostosDeItems } from '../../../pricing/application/casos-de-uso/costos-de-items';
import { ItemDelLibroNoEncontradoError, ItemNoProducibleError } from '../../domain/errores';
import {
  producirLote,
  type InsumoDelLote,
  type LoteProducido,
  type MovimientoValorizado,
} from '../../domain/produccion';
import type {
  DatosDeProduccionRegistrada,
  MovimientoParaGuardar,
} from '../ports/repositorio-de-inventario.port';
import {
  exigirLibroEscribible,
  registrarEvento,
  type DependenciasDeInventario,
} from './movimientos';

export interface DependenciasDeProduccion extends DependenciasDeInventario {
  readonly costosDeItems: CostosDeItems;
}

export interface InsumoDeclarado {
  readonly itemId: ItemId;
  /** Magnitud positiva de lo que realmente se consumió. */
  readonly cantidad: string;
}

export interface DatosDeProduccion {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly insumos: readonly InsumoDeclarado[];
  readonly occurredAt: Date;
  readonly note: string | null;
}

export class RegistrarProduccion {
  public constructor(private readonly deps: DependenciasDeProduccion) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {ItemNoProducibleError}
   * @throws {ItemDelLibroNoEncontradoError} @throws {ProduccionSinInsumosError}
   * @throws {FechaFuturaError} @throws {SignoIncoherenteError}
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeProduccion): Promise<ProductionId> {
    await exigirLibroEscribible({
      deps: this.deps,
      sesion,
      locationId: datos.locationId,
      ocurridoEn: datos.occurredAt,
    });

    const [items, costos] = await Promise.all([
      this.deps.listarItems.ejecutar(sesion, false),
      this.deps.costosDeItems.ejecutar(sesion, datos.occurredAt),
    ]);
    const porId = new Map(items.map((item) => [item.id, item]));

    const preparacion = exigirPreparacionConStock(porId, datos.itemId);
    const estandar = costos.porItem.get(datos.itemId);
    if (estandar === undefined) throw new ItemNoProducibleError(SIN_ESTANDAR);

    const lote = producirLote({
      locationId: datos.locationId,
      itemId: datos.itemId,
      cantidadProducida: Quantity.of(datos.cantidad, unidadDeUso(preparacion.unidadDeUso)),
      costoEstandarDeUso: estandar.costoNetoDeUso,
      insumos: datos.insumos.map((insumo) => resolver(insumo, porId, costos.porItem)),
      ocurridoEn: datos.occurredAt,
    });

    const productionId = await this.deps.repositorio.registrarProduccion(
      comoLote({ sesion, datos, lote, costoEstandarDeUso: estandar.costoNetoDeUso }),
    );

    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.production.recorded',
      detail: {
        productionId,
        itemId: datos.itemId,
        locationId: datos.locationId,
        // La varianza va EN EL EVENTO, y lo pide SEGURIDAD.md §10 por su nombre.
        varianza: lote.varianza.toStorageString(),
      },
    });

    return productionId;
  }
}

/** La cabecera del lote, con los DOS costos que R10 separa. */
function comoLote(entrada: {
  readonly sesion: SesionActiva;
  readonly datos: DatosDeProduccion;
  readonly lote: LoteProducido;
  readonly costoEstandarDeUso: Money;
}): DatosDeProduccionRegistrada {
  const { sesion, datos, lote } = entrada;

  return {
    companyId: sesion.companyId,
    userId: sesion.userId,
    locationId: datos.locationId,
    itemId: datos.itemId,
    cantidad: lote.movimientos[0]?.movimiento.cantidad.toStorageString() ?? datos.cantidad,
    costoEstandarDeUso: entrada.costoEstandarDeUso.toStorageString(),
    totalEstandar: lote.costoEstandarDelLote.toStorageString(),
    totalReal: lote.costoRealDelLote.toStorageString(),
    occurredAt: datos.occurredAt,
    note: datos.note,
    movimientos: lote.movimientos.map((valorizado) => comoFila(valorizado, datos.note)),
  };
}

const SIN_ESTANDAR =
  'no tiene precio de referencia confirmado a esa fecha, y sin costo estándar no hay ' +
  'nada contra lo que medir la varianza del lote (R10).';

const NO_ES_PRODUCIDO = 'es un ítem comprado, no una preparación. Un ítem comprado se compra.';

const NO_LLEVA_STOCK =
  'es una preparación sin stock propio: al vender se explota su receta, así que no ' +
  'pasa por inventario. Cámbiale el interruptor de stock si quieres producirla en lote.';

function exigirPreparacionConStock(
  porId: ReadonlyMap<ItemId, ItemLeido>,
  itemId: ItemId,
): ItemLeido {
  const item = porId.get(itemId);
  if (item === undefined) throw new ItemDelLibroNoEncontradoError();
  if (item.tipo !== 'PRODUCIDO') throw new ItemNoProducibleError(NO_ES_PRODUCIDO);
  if (item.llevaStock !== true) throw new ItemNoProducibleError(NO_LLEVA_STOCK);
  return item;
}

/**
 * Un insumo sin precio confirmado entra al lote con costo CERO.
 *
 * Es deliberado y tiene consecuencia visible: abarata el costo real y por tanto
 * la varianza sale negativa, que es la señal de «faltan precios» y no la de «se
 * produjo barato». Rechazar la producción entera sería peor —bloquearía la
 * operación de la cocina por un dato de administración— pero el hueco no se
 * puede esconder, así que el evento de auditoría lleva la varianza dentro.
 */
function resolver(
  insumo: InsumoDeclarado,
  porId: ReadonlyMap<ItemId, ItemLeido>,
  costos: ReadonlyMap<ItemId, { readonly costoNetoDeUso: Money }>,
): InsumoDelLote {
  const item = porId.get(insumo.itemId);
  if (item === undefined) throw new ItemDelLibroNoEncontradoError();

  return {
    itemId: insumo.itemId,
    cantidad: Quantity.of(insumo.cantidad, unidadDe(item)),
    costoNetoDeUso: costos.get(insumo.itemId)?.costoNetoDeUso ?? Money.CERO,
  };
}

function unidadDe(item: ItemLeido): UnidadDeUso {
  return unidadDeUso(item.unidadDeUso);
}

function comoFila(valorizado: MovimientoValorizado, note: string | null): MovimientoParaGuardar {
  return {
    locationId: valorizado.movimiento.locationId,
    itemId: valorizado.movimiento.itemId,
    tipo: valorizado.movimiento.tipo,
    cantidad: valorizado.movimiento.cantidad.toStorageString(),
    costoTotal: valorizado.costoTotal.toStorageString(),
    purchaseArticleId: null,
    reversesMovementId: null,
    occurredAt: valorizado.movimiento.ocurridoEn,
    note,
  };
}
