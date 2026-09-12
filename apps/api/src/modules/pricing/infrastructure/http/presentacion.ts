/**
 * Del resultado de `CostosDeItems` al DTO de `GET /precios/costos`.
 *
 * Los importes salen con su escala de almacenamiento, como `CostoVigente`: son
 * costos de USO, que se multiplican por la cantidad de cada línea de receta, y
 * redondearlos aquí a dos decimales perdería lo que la multiplicación necesita.
 */

import type { CostosDeLaCompany } from '../../application/casos-de-uso/costos-de-items';

export interface CostoDeItemDto {
  readonly itemId: string;
  readonly precioNeto: string;
  readonly costoBrutoDeUso: string;
  readonly costoNetoDeUso: string;
  readonly sobrecostoDeMerma: string;
}

export interface CostosAUnaFechaDto {
  readonly fecha: string;
  readonly costos: readonly CostoDeItemDto[];
  /** Ítems sin precio confirmado a esa fecha: no cuestan cero, no se sabe cuánto cuestan. */
  readonly sinPrecio: readonly string[];
}

export function comoCostosAUnaFecha(fecha: Date, resultado: CostosDeLaCompany): CostosAUnaFechaDto {
  return {
    fecha: fecha.toISOString(),
    costos: [...resultado.porItem].map(([itemId, costo]) => ({
      itemId,
      precioNeto: costo.precioNeto.toStorageString(),
      costoBrutoDeUso: costo.costoBrutoDeUso.toStorageString(),
      costoNetoDeUso: costo.costoNetoDeUso.toStorageString(),
      sobrecostoDeMerma: costo.sobrecostoDeMerma.toStorageString(),
    })),
    sinPrecio: [...resultado.sinPrecio],
  };
}
