/**
 * La salida de las seis vistas hacia JSON.
 *
 * **CADA DTO SE CONSTRUYE CAMPO A CAMPO, NUNCA CON `...spread`.** Es la
 * frontera de CLAUDE.md §4.3 escrita como código: lo que no se copia aquí no
 * sale. Un `...vista` publicaría todo lo que la vista lleve mañana, y seguiría
 * compilando.
 *
 * **LOS DECIMALES SALEN EN SU ESCALA EXACTA**, no redondeados a dos: quien
 * consuma la API decide cómo presentar; el backend no pierde precisión por
 * comodidad de una pantalla. La única excepción es
 * `diferenciaConciliacion`, que **ya viene** redondeada a dos porque el
 * `ROUND(·,2)` es parte de la fórmula de R7 (SPEC §16).
 */

import type {
  FilaDeReposicion,
  InventarioConNombres,
  ItemConNombre,
} from '../../application/casos-de-uso/vistas';
import type { FoodCostReal } from '../../domain/food-cost-real';
import type { Menu } from '../../domain/menu-engineering';
import type { PuntoDeEquilibrio } from '../../domain/punto-de-equilibrio';
import type { Resumen } from '../../domain/resumen';
import type {
  FilaDeReposicionDto,
  FoodCostRealDto,
  InventarioDto,
  ItemDelInventarioDto,
  MenuDto,
  PuntoDeEquilibrioDto,
  ResumenDto,
} from './analitica.dto';

/** `toExactString()` y no `toStorageString()`: sin ceros de relleno. */
interface Decimal {
  toExactString: () => string;
}

function texto(valor: Decimal): string {
  return valor.toExactString();
}

function opcional(valor: Decimal | null): string | null {
  return valor === null ? null : valor.toExactString();
}

export function comoMenuDto(menu: Menu): MenuDto {
  return {
    productos: menu.productos.map((producto) => ({
      productId: producto.productId,
      unidades: texto(producto.unidades),
      popularidad: opcional(producto.popularidad),
      indicePopularidad: opcional(producto.indicePopularidad),
      margenContribucion: opcional(producto.margenContribucion),
      cuadrante: producto.cuadrante,
    })),
    mcPromedio: opcional(menu.mcPromedio),
    unidadesTotales: texto(menu.unidadesTotales),
    productosActivos: menu.productosActivos,
  };
}

export function comoFoodCostDto(real: FoodCostReal): FoodCostRealDto {
  return {
    consumoReal: texto(real.consumoReal),
    consumoTeorico: texto(real.consumoTeorico),
    varianzaUsd: texto(real.varianzaUsd),
    varianzaPct: opcional(real.varianzaPct),
    foodCostTeoricoPct: opcional(real.foodCostTeoricoPct),
    foodCostRealPct: opcional(real.foodCostRealPct),
    brechaEnPuntos: opcional(real.brechaEnPuntos),
    costoVentasTeorico: texto(real.costoVentasTeorico),
    costoVentasSegunCosteo: texto(real.costoVentasSegunCosteo),
    diferenciaConciliacion: real.diferenciaConciliacion.toDisplayString(),
  };
}

export function comoEquilibrioDto(equilibrio: PuntoDeEquilibrio): PuntoDeEquilibrioDto {
  return {
    ventaNeta: texto(equilibrio.ventaNeta),
    costoAlimentosYEmpaque: texto(equilibrio.costoAlimentosYEmpaque),
    margenContribucion: texto(equilibrio.margenContribucion),
    costosVariables: texto(equilibrio.costosVariables),
    mcNeto: texto(equilibrio.mcNeto),
    costosFijos: texto(equilibrio.costosFijos),
    utilidadOperativa: texto(equilibrio.utilidadOperativa),
    manoDeObra: texto(equilibrio.manoDeObra),
    primeCost: texto(equilibrio.primeCost),
    primeCostPct: opcional(equilibrio.primeCostPct),
    unidadesEquilibrioMes: opcional(equilibrio.unidadesEquilibrioMes),
    unidadesPorDia: opcional(equilibrio.unidadesPorDia),
    ventaNetaEquilibrio: opcional(equilibrio.ventaNetaEquilibrio),
    ventaConIvaEquilibrio: opcional(equilibrio.ventaConIvaEquilibrio),
    margenDeSeguridad: opcional(equilibrio.margenDeSeguridad),
  };
}

export function comoInventarioDto(inventario: InventarioConNombres): InventarioDto {
  return {
    items: inventario.items.map(comoItemDto),
    valorTotal: texto(inventario.valorTotal),
  };
}

function comoItemDto(item: ItemConNombre): ItemDelInventarioDto {
  return {
    itemId: item.itemId,
    nombre: item.nombre,
    unidadDeUso: item.unidadDeUso,
    stockInicial: texto(item.stockInicial),
    compras: texto(item.compras),
    mermasYAjustes: texto(item.mermasYAjustes),
    consumoTeorico: texto(item.consumoTeorico),
    stockTeorico: texto(item.stockTeorico),
    valorTeorico: texto(item.valorTeorico),
    conteoFisico: opcional(item.conteoFisico),
    diferencia: opcional(item.diferencia),
    valorDeDiferencia: opcional(item.valorDeDiferencia),
    diasCobertura: opcional(item.diasCobertura),
    puntoDeReorden: texto(item.puntoDeReorden),
    estado: item.estado,
  };
}

export function comoResumenDto(resumen: Resumen): ResumenDto {
  return {
    ventaNetaMes: texto(resumen.ventaNetaMes),
    foodCostTeoricoPct: opcional(resumen.foodCostTeoricoPct),
    foodCostRealPct: opcional(resumen.foodCostRealPct),
    brechaEnPuntos: opcional(resumen.brechaEnPuntos),
    varianzaUsd: texto(resumen.varianzaUsd),
    varianzaPct: opcional(resumen.varianzaPct),
    utilidadOperativa: texto(resumen.utilidadOperativa),
    primeCostPct: opcional(resumen.primeCostPct),
    margenDeSeguridad: opcional(resumen.margenDeSeguridad),
    coberturaDelConteo: opcional(resumen.coberturaDelConteo),
    itemsPorReponer: resumen.itemsPorReponer,
    itemsSinCosto: resumen.itemsSinCosto,
    semaforoFoodCost: resumen.semaforoFoodCost,
    semaforoVarianza: resumen.semaforoVarianza,
    semaforoPrimeCost: resumen.semaforoPrimeCost,
    semaforoUtilidad: resumen.semaforoUtilidad,
  };
}

/** Tres campos, y ninguno es una cantidad. Ver `FilaDeReposicionDto`. */
export function comoReposicionDto(fila: FilaDeReposicion): FilaDeReposicionDto {
  return { itemId: fila.itemId, nombre: fila.nombre, semaforo: fila.semaforo };
}
