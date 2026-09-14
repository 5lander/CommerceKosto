/**
 * Lo que devuelven `GET /costeo` y `GET /costeo/:productId` — la forma, sin
 * ningún cálculo.
 *
 * **LO USAN LA TABLA DE COSTEO Y LA FICHA DEL PRODUCTO**, y por eso vive aquí y
 * no en una de las dos: son la misma respuesta, y dos copias del tipo acaban
 * diciendo cosas distintas del mismo campo.
 *
 * **CADA IMPORTE LLEGA EN DOS ESCALAS** (`mostrar` y `exacto`) y como cadena.
 * Las pantallas enseñan `mostrar`; ninguna suma.
 */

export interface ImporteDto {
  readonly mostrar: string;
  readonly exacto: string;
}

interface VentaDto {
  readonly vendible: true;
  readonly ventaNeta: ImporteDto;
  readonly margenContribucion: ImporteDto;
  readonly mcPct: string;
  readonly foodCostPct: string;
  readonly multiplicador: string | null;
}

interface SinVentaDto {
  readonly vendible: false;
  readonly motivo: string;
}

export type Venta = VentaDto | SinVentaDto;

/** El color lo decide la API con los umbrales de la company (D-16.105). */
export type Semaforo = 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';

/** Una línea del desglose de SPEC §13; `null` en `lineas` sin `recipe.read` (D-16.106). */
export interface LineaDeCosto {
  readonly itemId: string;
  readonly nombre: string;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly estado: 'ACTIVA' | 'INACTIVA';
  readonly costo: ImporteDto;
  readonly participacion: string;
}

export interface ProductoCosteado {
  readonly productId: string;
  readonly semaforoFoodCost: Semaforo;
  readonly nombre: string;
  readonly categoria: string | null;
  readonly costos: {
    readonly costoBrutoLote: ImporteDto;
    readonly costoNetoLote: ImporteDto;
    readonly costoPorPorcion: ImporteDto;
    readonly costoConMerma: ImporteDto;
    readonly empaqueNeto: ImporteDto;
    readonly costoTotalUnidad: ImporteDto;
    readonly lineas: readonly LineaDeCosto[] | null;
  };
  readonly venta: Venta;
  readonly itemsSinCosto: readonly string[];
  /** Sin receta en esta sucursal: sus ceros no son un costo (P16-D, D-16.146). */
  readonly sinReceta: boolean;
}
