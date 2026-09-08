/**
 * El costo por unidad de uso de TODOS los ítems de la company, a una fecha.
 *
 * **EXISTE POR EL PRESUPUESTO DE RENDIMIENTO.** `CostoDeItem` resuelve uno y
 * hace tres consultas para hacerlo: el ítem, su historial de precios y sus
 * artículos. Costear una carta de 200 productos con 300 insumos por esa vía son
 * novecientas consultas, y el presupuesto de CLAUDE.md §5 —400 ms para el
 * catálogo entero— no admite ni la décima parte. Aquí son **cuatro**, fijas, no
 * importa cuántos ítems haya.
 *
 * **NO DUPLICA LA CADENA DE COSTO**: llama a la misma `costoDelItem` de SPEC
 * §12 que usa `CostoDeItem`. Si hubiera dos implementaciones, el costo de un
 * plato dependería de por dónde se preguntó, que es el peor fallo posible en
 * este sistema.
 *
 * **`fecha` ES PARÁMETRO, NO «AHORA»** (criterio E8). Preguntar por el mes
 * pasado devuelve los precios que estaban vigentes entonces.
 *
 * VIVE EN `pricing` Y NO EN `costing` porque la cadena de costo del insumo es
 * de `pricing` (SPEC §12) y el catálogo se lee por sus puertos (CLAUDE.md §2).
 */

import type { ItemId, PurchaseArticleId } from '../../../../shared/domain/identity/identificadores';
import { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { costoDelItem, type CostoDelItem } from '../../domain/cadena-de-costo';
import { ItemSinPrecioError } from '../../domain/errores';
import { precioVigenteA } from '../../domain/vigencia';
import type { AjustesDeCompany, PrecioLeido } from '../ports/repositorio-de-precios.port';
import type { DependenciasDePrecios } from './precios';

export interface CostosDeLaCompany {
  /**
   * Solo los ítems que TIENEN precio confirmado a esa fecha.
   *
   * Un ítem ausente no cuesta cero: es que no se sabe cuánto cuesta. La
   * diferencia la conserva `sinPrecio`, y el motor de costeo la propaga hasta
   * la respuesta para que nadie tome un plato barato por un plato barato.
   */
  readonly porItem: ReadonlyMap<ItemId, CostoDelItem>;
  readonly sinPrecio: readonly ItemId[];
}

export class CostosDeItems {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  /** @throws {ItemSinPrecioError} si la company no tiene parámetros de costeo. */
  public async ejecutar(sesion: SesionActiva, fecha: Date): Promise<CostosDeLaCompany> {
    const [items, articulos, precios, ajustes] = await Promise.all([
      this.deps.listarItems.ejecutar(sesion, false),
      this.deps.listarArticulos.ejecutar(sesion, null),
      this.deps.repositorio.confirmadosHasta({ companyId: sesion.companyId, hasta: fecha }),
      this.deps.repositorio.ajustes(sesion.companyId),
    ]);

    if (ajustes === null) {
      throw new ItemSinPrecioError('La company no tiene parámetros de costeo configurados.');
    }

    const factores = new Map(articulos.map((a) => [a.id, a.factorDeConversion]));
    // AGRUPAR UNA VEZ, NO FILTRAR POR ITEM. Filtrar la lista completa de precios
    // dentro del bucle es O(items x precios): con 500 items y 500 precios son
    // 250.000 comparaciones y 500 arrays nuevos POR LLAMADA, y el consolidado de
    // diez ubicaciones llama a esto veinte veces. Lo encontro `npm run bench`
    // con volumen realista; con veinte filas no se ve.
    const preciosPorItem = agrupadosPorItem(precios);
    const porItem = new Map<ItemId, CostoDelItem>();
    const sinPrecio: ItemId[] = [];

    for (const item of items) {
      const vigente = precioVigenteA(preciosPorItem.get(item.id) ?? [], fecha);
      if (vigente === null) {
        sinPrecio.push(item.id);
        continue;
      }
      porItem.set(item.id, resolver({ vigente, rendimiento: item.rendimiento, factores, ajustes }));
    }

    return { porItem, sinPrecio };
  }
}

function agrupadosPorItem(
  precios: readonly PrecioLeido[],
): ReadonlyMap<ItemId, readonly PrecioLeido[]> {
  const porItem = new Map<ItemId, PrecioLeido[]>();

  for (const precio of precios) {
    const suyos = porItem.get(precio.itemId);
    if (suyos === undefined) porItem.set(precio.itemId, [precio]);
    else suyos.push(precio);
  }

  return porItem;
}

/**
 * Una preparación PRODUCIDA no tiene artículo: su precio ya está expresado por
 * unidad de uso (costo estándar, R10), así que el factor es 1 y no divide nada.
 *
 * Y un artículo que ya no está en el catálogo tampoco divide: el precio sigue
 * siendo válido, lo que se perdió es la presentación. Aquí se prefiere el
 * factor 1 a lanzar, porque costear una carta entera no puede reventar por un
 * artículo dado de baja hace un año.
 */
function factorDe(
  vigente: PrecioLeido,
  factores: ReadonlyMap<PurchaseArticleId, string>,
): Ratio {
  if (vigente.purchaseArticleId === null) {
    return Ratio.UNO;
  }
  const factor = factores.get(vigente.purchaseArticleId);
  return factor === undefined ? Ratio.UNO : Ratio.fromDecimalString(factor);
}

function resolver(entrada: {
  readonly vigente: PrecioLeido;
  readonly rendimiento: string;
  readonly factores: ReadonlyMap<PurchaseArticleId, string>;
  readonly ajustes: AjustesDeCompany;
}): CostoDelItem {
  return costoDelItem({
    precioDeCompra: Money.fromDatabase(entrada.vigente.precio),
    // La tasa es la DEL PRECIO, no la de la company: en Ecuador el alimento sin
    // procesar es 0 % y el detergente 15 %.
    ivaCompra: Ratio.fromDecimalString(entrada.vigente.ivaCompra),
    ivaRecuperable: entrada.ajustes.ivaCompraRecuperable,
    factorDeConversion: factorDe(entrada.vigente, entrada.factores),
    rendimiento: Ratio.fromDecimalString(entrada.rendimiento),
  });
}
