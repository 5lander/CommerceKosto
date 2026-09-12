/**
 * El costeo de una carta — el ensamblaje que alimenta al motor.
 *
 * **AQUÍ NO HAY NI UNA FÓRMULA.** Todas viven en `costing/domain`, que se
 * prueba con la base apagada contra `docs/pruebas/casos-conocidos.md`. Este
 * archivo hace lo único que el dominio no puede: traer los datos.
 *
 * **CUATRO CONSULTAS DE `recipes` MÁS CUATRO DE `pricing`, FIJAS.** No importa
 * si la carta tiene 3 productos o 200. Es lo que sostiene el presupuesto de
 * CLAUDE.md §5 —400 ms para 200 productos con 1.500 líneas— y la razón de que
 * existan `LeerCarta` y `CostosDeItems`.
 *
 * **COSTEAR UNO Y COSTEAR TODOS RECORREN EL MISMO CAMINO.** Pedir un solo
 * producto carga la carta entera y se queda con uno, que es más trabajo del
 * estrictamente necesario. Es deliberado: dos rutas distintas para el mismo
 * número son dos oportunidades de que den respuestas distintas, y en este
 * sistema eso no se ve en pantalla. La carga ya está dentro del presupuesto.
 *
 * **EL COMBO SE COSTEA DESPUÉS DE LOS SIMPLES**, porque suma sus
 * `COSTO_TOTAL_UNIDAD`. Un combo que contuviera otro combo no se costea: SPEC
 * §8 dice que los componentes son productos SIMPLES, y la base lo sostiene.
 */

import type {
  ItemId,
  LocationId,
  ProductId,
} from '../../../../shared/domain/identity/identificadores';
import { semaforoPorBandas, type Semaforo } from '../../../../shared/domain/indicadores/semaforo';
import { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { CartaDeUbicacion } from '../../../recipes/application/casos-de-uso/carta';
import type {
  ConfiguracionEnUbicacion,
  ProductoLeido,
  RecetaLeida,
} from '../../../recipes/application/ports/repositorio-de-recetas.port';
import {
  resolverCostos,
  type CatalogoCosteable,
  type ItemCosteable,
} from '../../domain/cascada';
import { costearCombo } from '../../domain/combo';
import {
  costearProducto,
  ladoDeVenta,
  type CosteoDeProducto,
  type LineaParaCostear,
  type ResultadoDeVenta,
} from '../../domain/costeo-de-producto';
import { ProductoSinCosteoError } from '../../domain/errores';
import {
  compartidoDeCompany,
  type CompartidoDeCompany,
  type LecturasDeCompany,
} from './compartido';

export type DependenciasDeCosteo = LecturasDeCompany;

export interface CosteoDelProducto {
  readonly productId: ProductId;
  readonly nombre: string;
  readonly tipo: string;
  readonly categoria: string | null;
  readonly activo: boolean;
  readonly costeo: CosteoDeProducto;
  /**
   * Ítems de este plato sin precio confirmado ni receta a esa fecha.
   *
   * **SE DEVUELVE, NO SE CALLA.** Un insumo sin precio hace el plato más barato
   * de lo que es, y el número resultante sale plausible. Quien mira un food
   * cost tiene derecho a saber sobre cuántos huecos está construido.
   */
  readonly itemsSinCosto: readonly ItemId[];
  /**
   * El color del food cost con los umbrales de la company (D-16.105). Lo decide
   * la API: la pantalla lo pinta y no compara nada. `SIN_DATO` si no hay venta.
   */
  readonly semaforoFoodCost: Semaforo;
  /**
   * El desglose de SPEC §13, una entrada por línea de la receta y en su orden:
   * qué ítem, cuánto, y cuánto aporta. Vacío en un combo, que no tiene receta.
   */
  readonly lineas: readonly LineaDelDesglose[];
}

export interface LineaDelDesglose {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly estado: 'ACTIVA' | 'INACTIVA';
  readonly costo: Money;
  /** `pct_del_producto`: sobre el costo neto del lote. */
  readonly participacion: Ratio;
}

/** Los parámetros de venta de la company, para poder simular un PVP sin recostear. */
export interface ParametrosDeVenta {
  readonly ivaVenta: Ratio;
  readonly umbralVerde: Ratio;
  readonly foodCostMaximo: Ratio;
}

export interface CosteoDeLaCarta {
  readonly locationId: LocationId;
  readonly fecha: Date;
  readonly productos: readonly CosteoDelProducto[];
  readonly parametros: ParametrosDeVenta;
}

const COMBO = 'COMBO';

export class CostearCarta {
  public constructor(private readonly deps: DependenciasDeCosteo) {}

  /**
   * `compartido` deja que quien ya haya leido lo de company no lo relea.
   *
   * Si no llega, se abre uno propio: el comportamiento de un llamante que no
   * sabe nada de esto no cambia. Ver `compartido.ts` para el porque.
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId; readonly fecha: Date },
    compartido: CompartidoDeCompany = compartidoDeCompany(this.deps, sesion),
  ): Promise<CosteoDeLaCarta> {
    const [carta, costosDePrecio, items, ajustes] = await Promise.all([
      compartido.cartaDe(entrada.locationId, entrada.fecha),
      compartido.costosAlCorte(entrada.fecha),
      compartido.items(),
      compartido.ajustes(),
    ]);

    const resueltos = resolverCostos(
      catalogoCosteable({ items, carta, costosDePrecio: costosDePrecio.porItem }),
    );

    const parametros: ParametrosDeVenta = {
      ivaVenta: Ratio.fromDecimalString(ajustes.ivaVenta),
      umbralVerde: Ratio.fromDecimalString(ajustes.foodCostUmbralVerde),
      foodCostMaximo: Ratio.fromDecimalString(ajustes.foodCostMaximo),
    };
    const contexto: ContextoDeCosteo = {
      carta,
      costos: resueltos.porItem,
      sinCosto: new Set(resueltos.sinCosto),
      ivaVenta: parametros.ivaVenta,
      provisionMerma: Ratio.fromDecimalString(ajustes.provisionMerma),
      parametros,
      nombres: new Map(items.map((i) => [i.id, i.nombre])),
    };

    return {
      locationId: entrada.locationId,
      fecha: entrada.fecha,
      productos: costearTodos(contexto),
      parametros,
    };
  }
}

export class CostearUnProducto {
  public constructor(private readonly costearCarta: CostearCarta) {}

  /**
   * `pvpSimulado` es el simulador de U6 (D-16.107): recalcula SOLO el lado de
   * venta con la misma `ladoDeVenta` que el costeo real, sobre el costo ya
   * calculado. No escribe nada, y el costo no cambia: lo que se pregunta es
   * «¿y si lo vendiera a esto?», no «¿y si costara otra cosa?».
   *
   * @throws {ProductoSinCosteoError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly productId: ProductId;
      readonly locationId: LocationId;
      readonly fecha: Date;
      readonly pvpSimulado: Money | null;
    },
  ): Promise<CosteoDelProducto> {
    const carta = await this.costearCarta.ejecutar(sesion, entrada);
    const suyo = carta.productos.find((p) => p.productId === entrada.productId);

    if (suyo === undefined) {
      throw new ProductoSinCosteoError();
    }
    return entrada.pvpSimulado === null ? suyo : simular(suyo, entrada.pvpSimulado, carta.parametros);
  }
}

function simular(producto: CosteoDelProducto, pvp: Money, parametros: ParametrosDeVenta): CosteoDelProducto {
  const venta = ladoDeVenta({ pvp, ivaVenta: parametros.ivaVenta, costoTotalUnidad: producto.costeo.costos.costoTotalUnidad });
  return {
    ...producto,
    costeo: { ...producto.costeo, venta },
    semaforoFoodCost: semaforoDe(venta, parametros),
  };
}

/** `SIN_DATO` cuando no hay venta: un plato sin PVP no está en verde, está sin medir. */
function semaforoDe(venta: ResultadoDeVenta, parametros: ParametrosDeVenta): Semaforo {
  return semaforoPorBandas({
    valor: venta.clase === 'vendible' ? venta.foodCostPct : null,
    verde: parametros.umbralVerde,
    rojo: parametros.foodCostMaximo,
  });
}

interface ContextoDeCosteo {
  readonly carta: CartaDeUbicacion;
  readonly costos: ReadonlyMap<ItemId, { readonly costoBrutoDeUso: Money; readonly costoNetoDeUso: Money }>;
  readonly sinCosto: ReadonlySet<ItemId>;
  readonly ivaVenta: Ratio;
  readonly provisionMerma: Ratio;
  readonly parametros: ParametrosDeVenta;
  readonly nombres: ReadonlyMap<ItemId, string>;
}

/**
 * El catálogo que la cascada necesita: cada ítem con su rendimiento, el costo
 * que sale de su precio y la receta de su subpreparación si la tiene.
 */
function catalogoCosteable(entrada: {
  readonly items: readonly { readonly id: ItemId; readonly rendimiento: string }[];
  readonly carta: CartaDeUbicacion;
  readonly costosDePrecio: ReadonlyMap<
    ItemId,
    { readonly costoBrutoDeUso: Money; readonly costoNetoDeUso: Money }
  >;
}): CatalogoCosteable {
  const catalogo = new Map<ItemId, ItemCosteable>();

  for (const item of entrada.items) {
    const receta = entrada.carta.recetasDeItem.get(item.id);
    catalogo.set(item.id, {
      rendimiento: Ratio.fromDecimalString(item.rendimiento),
      costosDePrecio: entrada.costosDePrecio.get(item.id) ?? null,
      receta: receta === undefined ? null : receta.lineas.map(comoLineaDeCascada),
    });
  }

  return catalogo;
}

function comoLineaDeCascada(linea: RecetaLeida['lineas'][number]): {
  readonly itemId: ItemId;
  readonly cantidad: Ratio;
  readonly base: RecetaLeida['lineas'][number]['base'];
  readonly estado: RecetaLeida['lineas'][number]['estado'];
} {
  return {
    itemId: linea.itemId,
    cantidad: Ratio.fromDecimalString(linea.cantidad),
    base: linea.base,
    estado: linea.estado,
  };
}

/**
 * Los simples primero, los combos después: un combo suma los
 * `COSTO_TOTAL_UNIDAD` de sus componentes, que tienen que estar ya calculados.
 */
function costearTodos(contexto: ContextoDeCosteo): readonly CosteoDelProducto[] {
  const simples = contexto.carta.productos
    .filter((producto) => producto.tipo !== COMBO)
    .map((producto) => costearSimple(producto, contexto));

  const costoPorProducto = new Map(
    simples.map((s) => [s.productId, s.costeo.costos.costoTotalUnidad]),
  );

  const combos = contexto.carta.productos
    .filter((producto) => producto.tipo === COMBO)
    .map((producto) => costearUnCombo(producto, contexto, costoPorProducto));

  return [...simples, ...combos];
}

function costearSimple(producto: ProductoLeido, contexto: ContextoDeCosteo): CosteoDelProducto {
  const enUbicacion = contexto.carta.enUbicacion.get(producto.id);
  const receta = contexto.carta.recetasDeProducto.get(producto.id);
  const lineas = (receta?.lineas ?? []).map((linea) => lineaParaCostear(linea, contexto));

  const costeo = costearProducto({
    lineas,
    rendimientoPorciones: porciones(enUbicacion),
    provisionMerma: contexto.provisionMerma,
    empaqueNeto: empaqueNetoDe(producto, contexto),
    pvp: pvpDe(enUbicacion),
    ivaVenta: contexto.ivaVenta,
  });

  return {
    ...identidad(producto, enUbicacion),
    costeo,
    itemsSinCosto: sinCostoDe(receta, contexto),
    semaforoFoodCost: semaforoDe(costeo.venta, contexto.parametros),
    lineas: desglose(receta, costeo, contexto),
  };
}

/**
 * Las líneas de la receta con lo que aporta cada una. El motor devuelve el costo
 * y la participación EN EL MISMO ORDEN en que recibió las líneas —todas, las
 * inactivas con costo cero—, y aquí se vuelven a unir por posición.
 */
function desglose(
  receta: RecetaLeida | undefined,
  costeo: CosteoDeProducto,
  contexto: ContextoDeCosteo,
): readonly LineaDelDesglose[] {
  return (receta?.lineas ?? []).flatMap((linea, posicion) => {
    const costeada = costeo.costos.lineas[posicion];
    return costeada === undefined
      ? []
      : [{
          itemId: linea.itemId,
          nombre: contexto.nombres.get(linea.itemId) ?? '',
          cantidad: linea.cantidad,
          base: linea.base,
          estado: linea.estado,
          costo: costeada.costo,
          participacion: costeada.participacion,
        }];
  });
}

function costearUnCombo(
  producto: ProductoLeido,
  contexto: ContextoDeCosteo,
  costoPorProducto: ReadonlyMap<ProductId, Money>,
): CosteoDelProducto {
  const enUbicacion = contexto.carta.enUbicacion.get(producto.id);
  const componentes = (contexto.carta.componentesDeCombo.get(producto.id) ?? []).map((c) => ({
    cantidad: Ratio.fromDecimalString(c.cantidad),
    costoTotalUnidad: costoPorProducto.get(c.componentProductId) ?? Money.CERO,
  }));

  const combo = costearCombo({
    componentes,
    empaqueNeto: empaqueNetoDe(producto, contexto),
    pvp: pvpDe(enUbicacion),
    ivaVenta: contexto.ivaVenta,
  });

  return {
    ...identidad(producto, enUbicacion),
    // Un combo no tiene lote ni porciones: su costo ES la suma de sus
    // componentes, que ya vienen por porción y con su merma dentro (R12).
    costeo: {
      costos: {
        costoBrutoLote: combo.costoDeComponentes,
        costoNetoLote: combo.costoDeComponentes,
        costoPorPorcion: combo.costoDeComponentes,
        costoConMerma: combo.costoDeComponentes,
        empaqueNeto: combo.empaqueNeto,
        costoTotalUnidad: combo.costoTotalUnidad,
        impactoMerma: null,
        lineas: [],
      },
      venta: combo.venta,
    },
    itemsSinCosto: [],
    semaforoFoodCost: semaforoDe(combo.venta, contexto.parametros),
    lineas: [],
  };
}

function identidad(
  producto: ProductoLeido,
  enUbicacion: ConfiguracionEnUbicacion | undefined,
): Pick<CosteoDelProducto, 'productId' | 'nombre' | 'tipo' | 'categoria' | 'activo'> {
  return {
    productId: producto.id,
    nombre: producto.nombre,
    tipo: producto.tipo,
    categoria: producto.categoria,
    // Sin fila en `product_location` el producto no está dado de alta en este
    // local. Se costea igual —el costo no depende de la ubicación salvo por el
    // PVP— y se marca inactivo para que nadie lo tome por parte de la carta.
    activo: enUbicacion?.activo ?? false,
  };
}

function lineaParaCostear(
  linea: RecetaLeida['lineas'][number],
  contexto: ContextoDeCosteo,
): LineaParaCostear {
  return {
    cantidad: Ratio.fromDecimalString(linea.cantidad),
    base: linea.base,
    estado: linea.estado,
    costos: contexto.costos.get(linea.itemId) ?? SIN_COSTO,
  };
}

const SIN_COSTO = { costoBrutoDeUso: Money.CERO, costoNetoDeUso: Money.CERO };

function sinCostoDe(
  receta: RecetaLeida | undefined,
  contexto: ContextoDeCosteo,
): readonly ItemId[] {
  return (receta?.lineas ?? [])
    .filter((linea) => linea.estado === 'ACTIVA' && contexto.sinCosto.has(linea.itemId))
    .map((linea) => linea.itemId);
}

function porciones(enUbicacion: ConfiguracionEnUbicacion | undefined): Ratio | null {
  const valor = enUbicacion?.rendimientoPorciones;
  return valor === undefined || valor === null ? null : Ratio.fromDecimalString(valor);
}

function pvpDe(enUbicacion: ConfiguracionEnUbicacion | undefined): Money | null {
  const valor = enUbicacion?.pvp;
  return valor === undefined || valor === null ? null : Money.fromDatabase(valor);
}

/**
 * `empaque_neto` es el `costo_neto_uso` del ítem que hace de empaque — la misma
 * cadena de SPEC §12, sin fórmula nueva (ADR-008).
 *
 * Un producto sin empaque suma cero, que aquí sí es la respuesta correcta: no
 * lleva envase, no cuesta envase.
 */
function empaqueNetoDe(producto: ProductoLeido, contexto: ContextoDeCosteo): Money {
  if (producto.empaqueItemId === null) {
    return Money.CERO;
  }
  return contexto.costos.get(producto.empaqueItemId)?.costoNetoDeUso ?? Money.CERO;
}
