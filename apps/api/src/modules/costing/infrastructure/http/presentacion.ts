/**
 * Del resultado del motor al DTO.
 *
 * **ES LA ÚNICA SALIDA DE LOS TIPOS MONETARIOS HACIA JSON**, y por eso está
 * aparte del controlador: un `Money` que llegue al serializador sin pasar por
 * aquí acabaría en `toJSON()`, que da la escala exacta y no la de presentación.
 * Tenerlo en un sitio hace que la regla se pueda leer entera de una vez.
 */

import type { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type {
  CosteoDeLaCarta,
  CosteoDelProducto,
} from '../../application/casos-de-uso/costear';
import type { CostosDelProducto, ResultadoDeVenta } from '../../domain/costeo-de-producto';
import type {
  CosteoDeCartaDto,
  CostosDto,
  ImporteDto,
  ProductoCosteadoDto,
  SinVentaDto,
  VentaDto,
} from './costeo.dto';

function importe(valor: Money): ImporteDto {
  return { mostrar: valor.toDisplayString(), exacto: valor.toExactString() };
}

/**
 * Una proporción sale con su escala EXACTA, no redondeada a dos decimales.
 *
 * Un food cost de `0.3601277778` mostrado como `0.36` pierde la información con
 * la que se compara contra los umbrales de SPEC §11 —objetivo 0.25, verde 0.28,
 * máximo 0.32—, y sobre todo haría que la suma de control pareciera `1.00`
 * incluso el día en que dejara de ser exactamente 1. Quien la muestre decide
 * cuántos decimales pinta; quien la calcula no puede decidirlo por él.
 */
function proporcion(valor: Ratio): string {
  return valor.toExactString();
}

export function comoCarta(carta: CosteoDeLaCarta): CosteoDeCartaDto {
  return {
    locationId: carta.locationId,
    fecha: carta.fecha.toISOString(),
    productos: carta.productos.map(comoProducto),
  };
}

export function comoProducto(producto: CosteoDelProducto): ProductoCosteadoDto {
  return {
    productId: producto.productId,
    nombre: producto.nombre,
    tipo: producto.tipo,
    categoria: producto.categoria,
    activo: producto.activo,
    costos: comoCostos(producto.costeo.costos),
    venta: comoVenta(producto.costeo.venta),
    itemsSinCosto: [...producto.itemsSinCosto],
  };
}

function comoCostos(costos: CostosDelProducto): CostosDto {
  return {
    costoBrutoLote: importe(costos.costoBrutoLote),
    costoNetoLote: importe(costos.costoNetoLote),
    costoPorPorcion: importe(costos.costoPorPorcion),
    costoConMerma: importe(costos.costoConMerma),
    empaqueNeto: importe(costos.empaqueNeto),
    costoTotalUnidad: importe(costos.costoTotalUnidad),
    impactoMerma: costos.impactoMerma === null ? null : proporcion(costos.impactoMerma),
  };
}

function comoVenta(venta: ResultadoDeVenta): VentaDto | SinVentaDto {
  if (venta.clase !== 'vendible') {
    return { vendible: false, motivo: venta.motivo };
  }

  return {
    vendible: true,
    ventaNeta: importe(venta.ventaNeta),
    ivaEnPrecio: importe(venta.ivaEnPrecio),
    margenContribucion: importe(venta.margenContribucion),
    mcPct: proporcion(venta.mcPct),
    foodCostPct: proporcion(venta.foodCostPct),
    // Sale tal cual, sin redondear: R6 exige que sea exactamente 1, y
    // redondearlo aquí escondería el día en que dejara de serlo.
    sumaControl: proporcion(venta.sumaControl),
    multiplicador: venta.multiplicador === null ? null : proporcion(venta.multiplicador),
  };
}
