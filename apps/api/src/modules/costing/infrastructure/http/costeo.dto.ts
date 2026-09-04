/**
 * La entrada y la salida de `/costeo`.
 *
 * **TODO DECIMAL SALE COMO CADENA.** Un `number` en JSON es un binario de doble
 * precisión, y `0.1 + 0.2` deja de ser `0.3` en cuanto alguien suma en el
 * cliente. Sale la escala de presentación —dos decimales, el `ROUND()` del
 * SPEC— junto a la exacta, para que un consumidor que necesite sumar tenga con
 * qué hacerlo sin perder nada.
 *
 * **EL LADO DE VENTA VIAJA COMO UNIÓN**, con `vendible: true|false`. Un
 * `foodCostPct: null` invitaría a pintarlo como `0 %`; un objeto ausente con su
 * motivo dentro obliga a decidir qué mostrar.
 */

import { z } from 'zod';

/**
 * Los parámetros de consulta del costeo.
 *
 * NO ES `.strict()`, por la misma razón que `CONSULTA_DE_RECETA`: un navegador
 * puede añadir parámetros de rastreo a una URL y rechazar la petición por eso
 * sería hostil sin ganar nada. Lo que importa es que los campos que sí se leen
 * estén validados, y lo están.
 */
export const CONSULTA_DE_COSTEO = z.object({
  locationId: z.uuid(),
  /** ISO 8601. Ausente = hoy. Es el criterio E8: se puede preguntar por atrás. */
  fecha: z.iso.datetime().optional(),
});

export type ConsultaDeCosteo = z.infer<typeof CONSULTA_DE_COSTEO>;

/** Un importe, en las dos escalas que hacen falta. */
export interface ImporteDto {
  /** Escala 2: el `ROUND(x, 2)` del SPEC. Para mostrar. */
  readonly mostrar: string;
  /** Escala nativa, sin pérdida. Para sumar sin acumular error. */
  readonly exacto: string;
}

export interface CostosDto {
  readonly costoBrutoLote: ImporteDto;
  readonly costoNetoLote: ImporteDto;
  readonly costoPorPorcion: ImporteDto;
  readonly costoConMerma: ImporteDto;
  readonly empaqueNeto: ImporteDto;
  readonly costoTotalUnidad: ImporteDto;
  /** `null` cuando el lote bruto es cero, tal como el SPEC lo escribe. */
  readonly impactoMerma: string | null;
}

export interface VentaDto {
  readonly vendible: true;
  readonly ventaNeta: ImporteDto;
  readonly ivaEnPrecio: ImporteDto;
  readonly margenContribucion: ImporteDto;
  readonly mcPct: string;
  readonly foodCostPct: string;
  readonly sumaControl: string;
  readonly multiplicador: string | null;
}

export interface SinVentaDto {
  readonly vendible: false;
  readonly motivo: string;
}

export interface ProductoCosteadoDto {
  readonly productId: string;
  readonly nombre: string;
  readonly tipo: string;
  readonly categoria: string | null;
  readonly activo: boolean;
  readonly costos: CostosDto;
  readonly venta: VentaDto | SinVentaDto;
  /** Ítems del plato sin precio confirmado a esa fecha. Vacío es lo normal. */
  readonly itemsSinCosto: readonly string[];
}

export interface CosteoDeCartaDto {
  readonly locationId: string;
  readonly fecha: string;
  readonly productos: readonly ProductoCosteadoDto[];
}
