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

import type { Semaforo } from '../../../../shared/domain/indicadores/semaforo';
import { decimalPositivo } from '../../../../shared/infrastructure/http/decimales-del-borde';

/**
 * Los parámetros de consulta del costeo.
 *
 * **ES `.strict()` DESDE P16-A2**, como los otros siete `CONSULTA_*`. Este
 * comentario decía lo contrario, y por la misma razón que `CONSULTA_DE_RECETA`
 * —los parámetros de rastreo de un navegador—; la refutación completa está allí
 * y no se repite aquí. En una frase: ese rastreo se le añade a la URL de una
 * página, no a una llamada `fetch`, y a cambio un parámetro de más se descartaba
 * en silencio con un 200 (SEGURIDAD.md §3, asignación masiva).
 */
export const CONSULTA_DE_COSTEO = z
  .object({
    locationId: z.uuid(),
    /** ISO 8601. Ausente = hoy. Es el criterio E8: se puede preguntar por atrás. */
    fecha: z.iso.datetime().optional(),
  })
  .strict();

export type ConsultaDeCosteo = z.infer<typeof CONSULTA_DE_COSTEO>;

/**
 * `GET /costeo/:productId`: lo mismo, más el PVP a simular (D-16.107). Con IVA,
 * como el de verdad (R14), y mayor que cero: un PVP de cero no es un escenario,
 * es una división por cero.
 */
export const CONSULTA_DE_COSTEO_DE_PRODUCTO = CONSULTA_DE_COSTEO.extend({ pvp: decimalPositivo.optional() }).strict();

export type ConsultaDeCosteoDeProducto = z.infer<typeof CONSULTA_DE_COSTEO_DE_PRODUCTO>;

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
  /**
   * El desglose de SPEC §13. **`null` si la sesión no tiene `recipe.read`**
   * (D-16.106): con las cantidades de cada línea, esto ES la receta.
   */
  readonly lineas: readonly LineaDto[] | null;
}

export interface LineaDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly estado: 'ACTIVA' | 'INACTIVA';
  readonly costo: ImporteDto;
  readonly participacion: string;
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
  /** El color lo decide la API con los umbrales de la company (D-16.105). */
  readonly semaforoFoodCost: Semaforo;
}

/** Un producto costeado con un PVP que no es el suyo: nada se guardó. */
export interface ProductoSimuladoDto extends ProductoCosteadoDto {
  /** El PVP con el que se calculó `venta`, o `null` si es el configurado. */
  readonly pvpSimulado: string | null;
}

export interface CosteoDeCartaDto {
  readonly locationId: string;
  readonly fecha: string;
  readonly productos: readonly ProductoCosteadoDto[];
}
