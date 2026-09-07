/**
 * El límite HTTP de analítica. Todos los esquemas `.strict()`.
 *
 * **EL SEMÁFORO DE REPOSICIÓN ES UN TIPO APARTE, NO UN SUBCONJUNTO.**
 * `FilaDeReposicionDto` tiene tres campos y ninguno es una cantidad: es lo que
 * SPEC §4 pide para `BODEGA` —«un semáforo `REPONER`/`OK` **sin la cantidad que
 * lo origina**»—. Que sea una interfaz distinta y no `Omit<ItemDto, …>` es
 * deliberado: con un `Omit`, añadir un campo a la vista de inventario lo
 * publicaría aquí también.
 *
 * **TODOS LOS DECIMALES SALEN COMO CADENA**, con su escala. Un `number` en un
 * food cost es exactamente lo que CLAUDE.md §8 prohíbe, y aquí el número viaja
 * hasta una pantalla donde alguien decide un precio.
 */

import { z } from 'zod';

const PRIMER_MES = 1;
const ULTIMO_MES = 12;
const PRIMER_ANIO = 2000;
const ULTIMO_ANIO = 2100;
const LARGO_MAXIMO_DE_DECIMAL = 40;
const LARGO_MAXIMO_DE_CONCEPTO = 200;
/** Una carta grande, con margen (SPEC §10 habla de 48 productos por local). */
const MAXIMO_DE_VENTAS = 1000;
const MAXIMO_DE_COSTOS = 200;

/** Magnitud: sin signo. Ni las ventas ni los costos fijos admiten negativos. */
const magnitud = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^\d+(\.\d+)?$/u, 'debe ser una cantidad positiva, por ejemplo "12.50"');

/** Entero sin signo: las unidades vendidas se cuentan (`Count`). */
const entero = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^\d+$/u, 'las unidades vendidas son un número entero');

/** El mes de una ubicacion: lo que TODO endpoint de analitica pide. */
const MES_DE_UBICACION = {
  locationId: z.uuid(),
  anio: z.number().int().min(PRIMER_ANIO).max(ULTIMO_ANIO),
  mes: z.number().int().min(PRIMER_MES).max(ULTIMO_MES),
};

/** En query string todo llega como texto, asi que aqui si se coacciona. */
export const CONSULTA_DEL_MES = z.object({
  ...MES_DE_UBICACION,
  anio: z.coerce.number().int().min(PRIMER_ANIO).max(ULTIMO_ANIO),
  mes: z.coerce.number().int().min(PRIMER_MES).max(ULTIMO_MES),
});

/**
 * El mes de la COMPANY: lo mismo sin `locationId`, y esa ausencia es el punto.
 *
 * Un consolidado que aceptara `locationId` seria una vista por ubicacion con
 * otro nombre. Aqui el alcance sale del permiso y de la sesion, nunca del
 * parametro — CLAUDE.md §4.1, barrera 3.
 */
export const CONSULTA_DEL_MES_DE_COMPANY = z.object({
  anio: z.coerce.number().int().min(PRIMER_ANIO).max(ULTIMO_ANIO),
  mes: z.coerce.number().int().min(PRIMER_MES).max(ULTIMO_MES),
});

export const CUERPO_DE_VENTAS = z
  .object({
    ...MES_DE_UBICACION,
    ventas: z
      .array(z.object({ productId: z.uuid(), unidades: entero }).strict())
      .max(MAXIMO_DE_VENTAS),
  })
  .strict();

export const CUERPO_DE_COSTOS = z
  .object({
    ...MES_DE_UBICACION,
    costos: z
      .array(
        z
          .object({
            concepto: z.string().trim().min(1).max(LARGO_MAXIMO_DE_CONCEPTO),
            // La clasificación es un enum y no texto libre: es exactamente lo
            // que SPEC §17 pide en lugar del frágil prefijo «Sueldos*».
            clasificacion: z.enum(['MANO_DE_OBRA', 'OTRO_FIJO', 'VARIABLE']),
            importe: magnitud,
          })
          .strict(),
      )
      .max(MAXIMO_DE_COSTOS),
  })
  .strict();

export type ConsultaDelMes = z.infer<typeof CONSULTA_DEL_MES>;
export type ConsultaDelMesDeCompany = z.infer<typeof CONSULTA_DEL_MES_DE_COMPANY>;

export interface AporteDeUbicacionDto {
  readonly locationId: string;
  readonly nombre: string;
  readonly estadoDelPeriodo: string;
  readonly unidades: string;
  readonly ventaNeta: string;
  readonly mcTotal: string;
  readonly consumoTeorico: string;
  readonly consumoReal: string;
  readonly comprasDelMes: string;
  readonly inventarioFinal: string;
  readonly costosFijos: string;
}

export interface ConsolidadoDto {
  readonly anio: number;
  readonly mes: number;
  readonly ubicaciones: readonly AporteDeUbicacionDto[];
  readonly sinDatos: readonly { readonly locationId: string; readonly nombre: string }[];
  readonly cerradas: number;
  readonly abiertas: number;
  readonly totales: {
    readonly unidades: string;
    readonly ventaNeta: string;
    readonly mcTotal: string;
    readonly consumoTeorico: string;
    readonly consumoReal: string;
    readonly comprasDelMes: string;
    readonly inventarioFinal: string;
    readonly costosFijos: string;
  };
  readonly foodCostTeoricoPct: string | null;
  readonly foodCostRealPct: string | null;
  readonly margenPct: string | null;
  readonly cobertura: string | null;
}

export interface ObservacionDeProductoDto {
  readonly locationId: string;
  readonly ubicacion: string;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly costoPorPorcion: string | null;
  readonly foodCostPct: string | null;
  readonly margenUnitario: string | null;
  readonly unidades: string;
}

export interface ComparativaDeProductoDto {
  readonly productId: string;
  readonly nombre: string;
  readonly activoEn: number;
  readonly unidadesTotales: string;
  readonly enUbicaciones: readonly ObservacionDeProductoDto[];
  readonly pvpMinimo: string | null;
  readonly pvpMaximo: string | null;
  readonly brechaDePvp: string | null;
  readonly foodCostMinimo: string | null;
  readonly foodCostMaximo: string | null;
  readonly brechaDeFoodCost: string | null;
}

export interface PrecioPagadoDto {
  readonly locationId: string;
  readonly ubicacion: string;
  readonly purchaseArticleId: string | null;
  readonly articulo: string | null;
  readonly importe: string;
  readonly cantidad: string;
  readonly precioUnitario: string | null;
}

export interface ComparativaDeCompraDto {
  readonly itemId: string;
  readonly item: string;
  readonly pagos: readonly PrecioPagadoDto[];
  readonly precioMinimo: string | null;
  readonly precioMaximo: string | null;
  readonly brecha: string | null;
  readonly brechaPct: string | null;
}
export type CuerpoDeVentas = z.infer<typeof CUERPO_DE_VENTAS>;
export type CuerpoDeCostos = z.infer<typeof CUERPO_DE_COSTOS>;

export interface VentaDto {
  readonly productId: string;
  readonly unidades: string;
}

export interface CostoDto {
  readonly concepto: string;
  readonly clasificacion: string;
  readonly importe: string;
}

export interface ProductoDelMenuDto {
  readonly productId: string;
  readonly unidades: string;
  readonly popularidad: string | null;
  readonly indicePopularidad: string | null;
  readonly margenContribucion: string | null;
  readonly cuadrante: string;
}

export interface MenuDto {
  readonly productos: readonly ProductoDelMenuDto[];
  readonly mcPromedio: string | null;
  readonly unidadesTotales: string;
  readonly productosActivos: number;
}

export interface FoodCostRealDto {
  readonly consumoReal: string;
  readonly consumoTeorico: string;
  readonly varianzaUsd: string;
  readonly varianzaPct: string | null;
  readonly foodCostTeoricoPct: string | null;
  readonly foodCostRealPct: string | null;
  readonly brechaEnPuntos: string | null;
  readonly costoVentasTeorico: string;
  readonly costoVentasSegunCosteo: string;
  /** R7 — **tiene que ser `"0.00"`**. Se devuelve para que se pueda mirar. */
  readonly diferenciaConciliacion: string;
}

export interface PuntoDeEquilibrioDto {
  readonly ventaNeta: string;
  readonly costoAlimentosYEmpaque: string;
  readonly margenContribucion: string;
  readonly costosVariables: string;
  readonly mcNeto: string;
  readonly costosFijos: string;
  readonly utilidadOperativa: string;
  readonly manoDeObra: string;
  readonly primeCost: string;
  readonly primeCostPct: string | null;
  readonly unidadesEquilibrioMes: string | null;
  readonly unidadesPorDia: string | null;
  readonly ventaNetaEquilibrio: string | null;
  readonly ventaConIvaEquilibrio: string | null;
  readonly margenDeSeguridad: string | null;
}

export interface ItemDelInventarioDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly stockInicial: string;
  readonly compras: string;
  readonly mermasYAjustes: string;
  readonly consumoTeorico: string;
  readonly stockTeorico: string;
  readonly valorTeorico: string;
  readonly conteoFisico: string | null;
  readonly diferencia: string | null;
  readonly valorDeDiferencia: string | null;
  readonly diasCobertura: string | null;
  readonly puntoDeReorden: string;
  readonly estado: string;
}

export interface InventarioDto {
  readonly items: readonly ItemDelInventarioDto[];
  readonly valorTotal: string;
}

export interface ResumenDto {
  readonly ventaNetaMes: string;
  readonly foodCostTeoricoPct: string | null;
  readonly foodCostRealPct: string | null;
  readonly brechaEnPuntos: string | null;
  readonly varianzaUsd: string;
  readonly varianzaPct: string | null;
  readonly utilidadOperativa: string;
  readonly primeCostPct: string | null;
  readonly margenDeSeguridad: string | null;
  readonly coberturaDelConteo: string | null;
  readonly itemsPorReponer: number;
  readonly itemsSinCosto: number;
  readonly semaforoFoodCost: string;
  readonly semaforoVarianza: string;
  readonly semaforoPrimeCost: string;
  readonly semaforoUtilidad: string;
}

/**
 * Lo ÚNICO que `BODEGA` recibe de todo P8 — SPEC §4.
 *
 * Tres campos, y ninguno es una cantidad. Interfaz propia y no un `Omit` sobre
 * `ItemDelInventarioDto`: con un `Omit`, un campo nuevo en la vista de
 * inventario se publicaría aquí sin que nada avisara.
 */
export interface FilaDeReposicionDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly semaforo: string;
}
