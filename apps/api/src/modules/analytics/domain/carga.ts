/**
 * Las dos cargas de datos del mes: unidades vendidas y costos fijos.
 *
 * **SON LOTES, NO ALTAS.** D9 lo fija —«el caso de uso recibe un lote de
 * (producto, ubicación, período, unidades) sin importar si viene de digitación,
 * importación o un sistema externo»— y el SPEC explica por qué importa: de las
 * unidades vendidas dependen tres de las seis vistas, y «digitar 48 productos
 * por local cada mes es donde el sistema se abandona». Una API que obligue a
 * una petición por producto hace imposible la grilla que lo hace tolerable.
 *
 * Lo que este archivo comprueba es lo que un lote puede traer mal y la base
 * rechazaría con un `23505` sin explicar: **el mismo producto dos veces, el
 * mismo concepto dos veces.**
 */

import type { ProductId } from '../../../shared/domain/identity/identificadores';
import type { Count, Money } from '../../../shared/domain/money/tipos-monetarios';
import { ConceptoRepetidoError, ProductoRepetidoEnVentasError } from './errores';
import type { ClasificacionDeCosto } from './punto-de-equilibrio';

export interface VentaDeProducto {
  readonly productId: ProductId;
  readonly unidades: Count;
}

export interface CostoDelMes {
  readonly concepto: string;
  readonly clasificacion: ClasificacionDeCosto;
  readonly importe: Money;
}

/** @throws {ProductoRepetidoEnVentasError} */
export function exigirVentasValidas(
  ventas: readonly VentaDeProducto[],
): readonly VentaDeProducto[] {
  const vistos = new Set<ProductId>();

  for (const venta of ventas) {
    if (vistos.has(venta.productId)) throw new ProductoRepetidoEnVentasError();
    vistos.add(venta.productId);
  }
  return ventas;
}

/**
 * Los conceptos se comparan **normalizados**: sin espacios de sobra y sin
 * distinguir mayúsculas.
 *
 * «Arriendo» y «arriendo » son el mismo gasto escrito dos veces, y el índice
 * único de la base —que compara byte a byte— los dejaría pasar. El resultado
 * sería un mes con el arriendo contado dos veces y una utilidad operativa
 * plausible y equivocada. Aquí la comprobación es más estricta que la base a
 * propósito.
 *
 * @throws {ConceptoRepetidoError}
 */
export function exigirCostosValidos(costos: readonly CostoDelMes[]): readonly CostoDelMes[] {
  const vistos = new Set<string>();

  for (const costo of costos) {
    const clave = costo.concepto.trim().toLocaleLowerCase();
    if (vistos.has(clave)) throw new ConceptoRepetidoError(costo.concepto);
    vistos.add(clave);
  }
  return costos;
}
