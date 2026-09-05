/**
 * Las seis vistas del Excel, por ubicación y por mes — SPEC §15 a §18.
 *
 * **ES UNA CAPA DE LECTURA, NO UN SEGUNDO MOTOR.** No calcula ningún costo:
 * pide la carta costeada a `costing`, los agregados a `inventory`, el conteo a
 * `inventory` y el mes a `periods`, y compone. El día que una fórmula de costeo
 * cambie, cambia en un sitio.
 *
 * **UNA SOLA PASADA ALIMENTA LAS SEIS.** `armarPeriodo` reúne todo lo que hace
 * falta —carta, ventas, consumo teórico, agregados, conteo, parámetros— en
 * cinco consultas fijas, y de ahí salen menu engineering, food cost real,
 * punto de equilibrio, inventario y resumen. Pedirlas por separado
 * multiplicaría por cinco un trabajo que ya es el más caro del sistema.
 *
 * **NINGUNA DE ESTAS VISTAS LLEGA A `BODEGA`.** Todas llevan consumo teórico,
 * stock teórico, diferencias o costos: cuatro de los seis datos prohibidos de
 * CLAUDE.md §4.3. Lo único que le corresponde es el semáforo de reposición, que
 * es un caso de uso aparte —`ConsultarReposicion`— y no un filtro sobre esto.
 */

import type { ItemId, ProductId } from '../../../../shared/domain/identity/identificadores';
import { Count, Money, Quantity, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso, type UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { ConciliacionDeConteo } from '../../../inventory/application/casos-de-uso/conteos';
import type { MesDeUbicacion } from './carga';
import { foodCostReal, type FoodCostReal } from '../../domain/food-cost-real';
import {
  semaforoDe,
  valorizarInventario,
  type EntradaDeItem,
  type Inventario,
  type ItemValorizado,
  type Semaforo,
} from '../../domain/inventario-valorizado';
import { clasificarMenu, type Menu } from '../../domain/menu-engineering';
import { puntoDeEquilibrio, type PuntoDeEquilibrio } from '../../domain/punto-de-equilibrio';
import { resumir, type Resumen } from '../../domain/resumen';
import {
  contexto,
  type ContextoDelPeriodo,
  type DependenciasDeVistas,
} from './contexto';

export type { DependenciasDeVistas };


/** El inventario valorizado con lo que el catálogo aporta: nombre y unidad. */
export interface ItemConNombre extends ItemValorizado {
  readonly nombre: string;
  readonly unidadDeUso: string;
}

export interface InventarioConNombres {
  readonly items: readonly ItemConNombre[];
  readonly valorTotal: Money;
}

/** Una fila del semáforo de reposición: lo ÚNICO que `BODEGA` recibe. */
export interface FilaDeReposicion {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly semaforo: Semaforo;
}

export class ConsultarMenuEngineering {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesDeUbicacion): Promise<Menu> {
    return menuDe(await contexto(this.deps, sesion, pedido));
  }
}

export class ConsultarFoodCostReal {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesDeUbicacion): Promise<FoodCostReal> {
    return foodCostDe(await contexto(this.deps, sesion, pedido));
  }
}

export class ConsultarPuntoDeEquilibrio {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeUbicacion,
  ): Promise<PuntoDeEquilibrio> {
    return equilibrioDe(await contexto(this.deps, sesion, pedido));
  }
}

export class ConsultarInventarioValorizado {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeUbicacion,
  ): Promise<InventarioConNombres> {
    const datos = await contexto(this.deps, sesion, pedido);
    const inventario = inventarioDe(datos);

    return {
      items: inventario.items.map((item) => ({
        ...item,
        nombre: datos.catalogo.get(item.itemId)?.nombre ?? '',
        unidadDeUso: datos.catalogo.get(item.itemId)?.unidadDeUso ?? '',
      })),
      valorTotal: inventario.valorTotal,
    };
  }
}

/**
 * El resumen gerencial: los seis números que se miran primero.
 *
 * Compone las otras cuatro sobre **el mismo** contexto, así que no puede
 * discrepar de ellas: si el food cost del resumen y el de su propia vista
 * salieran distintos, ninguno de los dos serviría.
 */
export class ConsultarResumen {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(sesion: SesionActiva, pedido: MesDeUbicacion): Promise<Resumen> {
    const datos = await contexto(this.deps, sesion, pedido);
    const real = foodCostDe(datos);
    const equilibrio = equilibrioDe(datos);
    const inventario = inventarioDe(datos);

    return resumir({
      umbrales: datos.umbrales,
      datos: {
        ventaNetaMes: datos.ventaNetaMes,
        foodCostTeoricoPct: real.foodCostTeoricoPct,
        foodCostRealPct: real.foodCostRealPct,
        brechaEnPuntos: real.brechaEnPuntos,
        varianzaUsd: real.varianzaUsd,
        varianzaPct: real.varianzaPct,
        utilidadOperativa: equilibrio.utilidadOperativa,
        primeCostPct: equilibrio.primeCostPct,
        margenDeSeguridad: equilibrio.margenDeSeguridad,
        coberturaDelConteo: coberturaDe(datos.conteo),
        itemsPorReponer: inventario.items.filter((item) => semaforoDe(item.estado) === 'REPONER')
          .length,
        itemsSinCosto: datos.sinCosto.length,
      },
    });
  }
}

/**
 * El semáforo de reposición — SPEC §4, **lo único que `BODEGA` recibe**.
 *
 * «Para reposición, BODEGA recibe un semáforo (`REPONER` / `OK`) **sin la
 * cantidad que lo origina**.» Se construye desde otro caso de uso y con otro
 * tipo, no filtrando la vista de inventario: un campo que se calcula y luego se
 * quita ya viajó por el cable alguna vez, y basta con que alguien retire el
 * filtro para publicarlo.
 */
export class ConsultarReposicion {
  public constructor(private readonly deps: DependenciasDeVistas) {}

  public async ejecutar(
    sesion: SesionActiva,
    pedido: MesDeUbicacion,
  ): Promise<readonly FilaDeReposicion[]> {
    const datos = await contexto(this.deps, sesion, pedido);
    const inventario = inventarioDe(datos);

    return inventario.items.map((item) => ({
      itemId: item.itemId,
      nombre: datos.catalogo.get(item.itemId)?.nombre ?? '',
      semaforo: semaforoDe(item.estado),
    }));
  }
}

/* --- Las cuatro vistas, sobre el contexto ya armado ------------------------ */

function menuDe(datos: ContextoDelPeriodo): Menu {
  return clasificarMenu({
    reglaPopularidad: datos.parametros.reglaPopularidad,
    productos: datos.carta.map((producto) => ({
      productId: producto.productId,
      activo: producto.activo,
      unidades: unidadesDe(datos, producto.productId),
      margenContribucion:
        producto.costeo.venta.clase === 'vendible'
          ? producto.costeo.venta.margenContribucion
          : null,
    })),
  });
}

function foodCostDe(datos: ContextoDelPeriodo): FoodCostReal {
  return foodCostReal({
    inventarioInicial: datos.inventarioInicial,
    comprasDelMes: datos.comprasDelMes,
    // SIN CONTEO CONFIRMADO, EL INVENTARIO FINAL FÍSICO ES EL TEÓRICO.
    // Es la misma regla que P7 aplica a un ítem sin contar —vale lo que el
    // libro dice, no cero— llevada al caso en que no se contó ninguno. Un cero
    // ahí declararía consumido todo el inventario del mes.
    inventarioFinalFisico:
      datos.conteo === null
        ? inventarioDe(datos).valorTotal
        : Money.fromDatabase(datos.conteo.valorFisico),
    consumoTeorico: datos.consumoTeoricoValorizado,
    ventaNetaMes: datos.ventaNetaMes,
    empaqueTeoricoMes: datos.empaqueTeoricoMes,
    provisionMermaMes: datos.provisionMermaMes,
    mcMesTotal: datos.mcMesTotal,
  });
}

function equilibrioDe(datos: ContextoDelPeriodo): PuntoDeEquilibrio {
  return puntoDeEquilibrio({
    ventaNetaMes: datos.ventaNetaMes,
    mcMesTotal: datos.mcMesTotal,
    unidadesTotales: datos.unidadesTotales,
    costos: datos.costosFijos,
    diasOperativos: datos.parametros.diasOperativos,
    ivaVenta: datos.parametros.ivaVenta,
  });
}

function inventarioDe(datos: ContextoDelPeriodo): Inventario {
  return valorizarInventario({
    items: [...datos.itemsDelInventario].map((itemId) => filaDeInventario(datos, itemId)),
    parametros: {
      diasOperativos: datos.parametros.diasOperativos,
      diasDeCobertura: datos.parametros.diasDeCobertura,
    },
  });
}

function filaDeInventario(datos: ContextoDelPeriodo, itemId: ItemId): EntradaDeItem {
  const unidad = unidadDe(datos.catalogo.get(itemId));
  const agregado = datos.agregados.get(itemId);
  const cero = Quantity.cero(unidad);

  return {
    itemId,
    stockInicial: cantidad(datos.stockInicial.get(itemId), unidad),
    compras: agregado === undefined ? cero : Quantity.fromDatabase(agregado.compras, unidad),
    mermasYAjustes:
      agregado === undefined ? cero : Quantity.fromDatabase(agregado.mermasYAjustes, unidad),
    otrosMovimientos: agregado === undefined ? cero : Quantity.fromDatabase(agregado.otros, unidad),
    consumoTeorico: consumoDe(datos, itemId, unidad),
    conteoFisico: datos.conteoPorItem.get(itemId) ?? null,
    costoDeUso: datos.costoPorItem.get(itemId) ?? Money.CERO,
  };
}

function consumoDe(datos: ContextoDelPeriodo, itemId: ItemId, unidad: UnidadDeUso): Quantity {
  const consumo = datos.consumoPorItem.get(itemId);
  return consumo === undefined ? Quantity.cero(unidad) : Quantity.of(consumo.toExactString(), unidad);
}

function cantidad(valor: Quantity | undefined, unidad: UnidadDeUso): Quantity {
  return valor ?? Quantity.cero(unidad);
}

function unidadDe(item: ItemLeido | undefined): UnidadDeUso {
  return unidadDeUso(item?.unidadDeUso ?? 'unid');
}

function unidadesDe(datos: ContextoDelPeriodo, productId: ProductId): Count {
  return datos.unidadesPorProducto.get(productId) ?? Count.CERO;
}

/**
 * La cobertura del conteo (D7), tal como el conteo la congeló.
 *
 * **No se recalcula aquí.** Es el mismo cociente que `LeerConciliacion`
 * devuelve, y calcularlo de nuevo abriría un segundo sitio donde el mismo
 * porcentaje puede salir distinto.
 */
function coberturaDe(conteo: ConciliacionDeConteo | null): Ratio | null {
  const cobertura = conteo?.cobertura;
  return cobertura === null || cobertura === undefined
    ? null
    : Ratio.fromDecimalString(cobertura);
}
