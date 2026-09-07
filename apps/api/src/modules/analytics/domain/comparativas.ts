/**
 * Comparar el mismo producto y el mismo insumo entre ubicaciones.
 *
 * ES LA PREGUNTA QUE SOLO TIENE SENTIDO CON VARIOS LOCALES: «el mismo plato,
 * ¿cuesta lo mismo en los dos?», «¿por que este local paga el tomate un 40 %
 * mas caro?». El consolidado suma; esto **separa**, que es lo contrario y hace
 * falta igual.
 *
 * DOS FUENTES DISTINTAS, Y LA SEGUNDA NO ES LA OBVIA.
 *
 *   - **El producto** se compara con lo que el costeo ya calcula por ubicacion:
 *     PVP, food cost, margen y unidades. Salen de `product_location` y de la
 *     receta de esa ubicacion, que son distintas por diseno (SPEC §9).
 *
 *   - **El precio de compra NO se compara con `reference_price`.** Esa tabla es
 *     de company y no tiene ubicacion: compararla entre locales daria el mismo
 *     numero siempre, que es una comparativa que no compara nada. Lo que si
 *     varia por ubicacion es **lo que cada una pago de verdad**, y eso vive en
 *     el libro de inventario: `total_cost ÷ quantity` de los movimientos de
 *     COMPRA, con su `purchase_article_id` para distinguir marcas. P6 dejo ese
 *     campo puesto exactamente para esto.
 *
 * LO QUE SE PUBLICA ES LA DISPERSION, no una lista que haya que leer entera.
 * Con diez ubicaciones y doscientos productos son dos mil filas, y nadie las
 * mira. Lo accionable es «en este producto el margen va del 12 % al 61 %», asi
 * que cada fila trae su minimo, su maximo y la brecha entre ambos, y quien
 * consulta ordena por brecha.
 *
 * ES DOMINIO PURO. Entran observaciones por ubicacion, salen filas comparadas.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import type {
  ItemId,
  LocationId,
  ProductId,
} from '../../../shared/domain/identity/identificadores';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

/** Lo que una ubicación dice de un producto suyo. */
export interface ObservacionDeProducto {
  readonly productId: ProductId;
  readonly nombre: string;
  readonly locationId: LocationId;
  readonly ubicacion: string;
  readonly activo: boolean;
  readonly pvp: Money | null;
  readonly costoPorPorcion: Money | null;
  readonly foodCostPct: Ratio | null;
  readonly margenUnitario: Money | null;
  readonly unidades: Count;
}

export interface ComparativaDeProducto {
  readonly productId: ProductId;
  readonly nombre: string;
  readonly enUbicaciones: readonly ObservacionDeProducto[];
  /** Cuántas lo tienen activo. Un producto en una sola no se compara con nada. */
  readonly activoEn: number;
  readonly unidadesTotales: Count;

  readonly pvpMinimo: Money | null;
  readonly pvpMaximo: Money | null;
  /** `máximo − mínimo`. Es por lo que se ordena: manda la dispersión. */
  readonly brechaDePvp: Money | null;

  readonly foodCostMinimo: Ratio | null;
  readonly foodCostMaximo: Ratio | null;
  readonly brechaDeFoodCost: Ratio | null;
}

/** Una compra real, tal como la registró el libro. */
export interface CompraObservada {
  readonly itemId: ItemId;
  readonly item: string;
  readonly locationId: LocationId;
  readonly ubicacion: string;
  readonly purchaseArticleId: string | null;
  readonly articulo: string | null;
  /** `Σ total_cost` de las compras del período en esa ubicación y artículo. */
  readonly importe: Money;
  /** `Σ quantity` en unidad de uso del ítem. */
  readonly cantidad: Ratio;
}

export interface PrecioPagado {
  readonly locationId: LocationId;
  readonly ubicacion: string;
  readonly purchaseArticleId: string | null;
  readonly articulo: string | null;
  readonly importe: Money;
  readonly cantidad: Ratio;
  /** `importe ÷ cantidad`. `null` si no se compró nada: no hay precio. */
  readonly precioUnitario: Money | null;
}

export interface ComparativaDeCompra {
  readonly itemId: ItemId;
  readonly item: string;
  readonly pagos: readonly PrecioPagado[];
  readonly precioMinimo: Money | null;
  readonly precioMaximo: Money | null;
  readonly brecha: Money | null;
  /** `(máximo − mínimo) ÷ mínimo`. Lo que se ahorra comprando como el mejor. */
  readonly brechaPct: Ratio | null;
}

export function compararProductos(
  observaciones: readonly ObservacionDeProducto[],
): readonly ComparativaDeProducto[] {
  const porProducto = agrupar(observaciones, (o) => o.productId);

  // `flatMap` con la guarda en vez de `map` con un `!`: un grupo vacio no
  // puede existir —sale de agrupar observaciones que existen— pero afirmarlo
  // con una asercion seria pedirle al lector que confie. Descartarlo cuesta
  // una linea y no pide confianza a nadie.
  return [...porProducto.values()].flatMap((grupo) => {
    const primera = grupo[0];
    return primera === undefined ? [] : [filaDeProducto(primera, grupo)];
  });
}

export function compararCompras(
  compras: readonly CompraObservada[],
): readonly ComparativaDeCompra[] {
  const porItem = agrupar(compras, (c) => c.itemId);

  return [...porItem.values()].flatMap((grupo) => {
    const primera = grupo[0];
    return primera === undefined ? [] : [filaDeCompra(primera, grupo)];
  });
}

function filaDeProducto(
  primera: ObservacionDeProducto,
  grupo: readonly ObservacionDeProducto[],
): ComparativaDeProducto {
  const activos = grupo.filter((o) => o.activo);

  const pvps = definidos(activos.map((o) => o.pvp));
  const fcs = definidos(activos.map((o) => o.foodCostPct));

  return {
    productId: primera.productId,
    nombre: primera.nombre,
    enUbicaciones: grupo,
    activoEn: activos.length,
    unidadesTotales: grupo.reduce((suma, o) => suma.plus(o.unidades), Count.CERO),
    pvpMinimo: menor(pvps),
    pvpMaximo: mayor(pvps),
    brechaDePvp: diferencia(pvps),
    foodCostMinimo: menor(fcs),
    foodCostMaximo: mayor(fcs),
    brechaDeFoodCost: diferencia(fcs),
  };
}

function filaDeCompra(
  primera: CompraObservada,
  grupo: readonly CompraObservada[],
): ComparativaDeCompra {
  const pagos = grupo.map((compra) => ({
    locationId: compra.locationId,
    ubicacion: compra.ubicacion,
    purchaseArticleId: compra.purchaseArticleId,
    articulo: compra.articulo,
    importe: compra.importe,
    cantidad: compra.cantidad,
    // Sin cantidad no hay precio unitario: `null`, nunca una division por cero
    // disfrazada de cero.
    precioUnitario: compra.cantidad.isZero()
      ? null
      : compra.importe.dividedBy(compra.cantidad, DIVISION),
  }));

  const precios = definidos(pagos.map((p) => p.precioUnitario));
  const minimo = menor(precios);
  const maximo = mayor(precios);

  return {
    itemId: primera.itemId,
    item: primera.item,
    pagos,
    precioMinimo: minimo,
    precioMaximo: maximo,
    brecha: diferencia(precios),
    brechaPct:
      minimo === null || maximo === null || minimo.isZero()
        ? null
        : maximo.minus(minimo).ratioTo(minimo, DIVISION),
  };
}

interface Comparable<T> {
  lessThan(otro: T): boolean;
  minus(otro: T): T;
}

function agrupar<T, C>(valores: readonly T[], clave: (valor: T) => C): Map<C, T[]> {
  const grupos = new Map<C, T[]>();

  for (const valor of valores) {
    const k = clave(valor);
    const existente = grupos.get(k);
    if (existente === undefined) grupos.set(k, [valor]);
    else existente.push(valor);
  }

  return grupos;
}

function definidos<T>(valores: readonly (T | null)[]): readonly T[] {
  return valores.filter((valor): valor is T => valor !== null);
}

function menor<T extends Comparable<T>>(valores: readonly T[]): T | null {
  return valores.reduce<T | null>(
    (mejor, actual) => (mejor === null || actual.lessThan(mejor) ? actual : mejor),
    null,
  );
}

function mayor<T extends Comparable<T>>(valores: readonly T[]): T | null {
  return valores.reduce<T | null>(
    (mejor, actual) => (mejor === null || mejor.lessThan(actual) ? actual : mejor),
    null,
  );
}

/** `máximo − mínimo`, o `null` si no hay al menos dos cosas que comparar. */
function diferencia<T extends Comparable<T>>(valores: readonly T[]): T | null {
  const DOS = 2;
  if (valores.length < DOS) return null;

  const minimo = menor(valores);
  const maximo = mayor(valores);
  return minimo === null || maximo === null ? null : maximo.minus(minimo);
}
