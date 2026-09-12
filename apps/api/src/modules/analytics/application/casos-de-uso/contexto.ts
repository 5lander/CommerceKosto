/**
 * Una sola pasada que alimenta las seis vistas.
 *
 * **EL COSTE DE P8 ESTÁ AQUÍ, Y ES DELIBERADO QUE SEA UNO SOLO.** Menu
 * engineering, food cost real, punto de equilibrio, inventario y resumen
 * necesitan casi lo mismo: la carta costeada, las ventas del mes, el consumo
 * teórico, los agregados del libro, el conteo confirmado y los parámetros.
 * Pedirlo por vista multiplicaría por cinco el trabajo más caro del sistema.
 *
 * **NO CONSULTA NINGUNA TABLA DE OTRO MÓDULO.** Todo entra por casos de uso:
 * `costing.CostearCarta`, `inventory.ConsultarAgregadosDelPeriodo`,
 * `inventory.ConsultarConteoConfirmado`, `inventory.CalcularConsumoTeorico`,
 * `pricing.CostosDeItems` y `periods.ConsultarPeriodo`. Es lo que hace que un
 * cambio en el signo de un movimiento o en una fórmula de costeo se arregle en
 * un sitio.
 *
 * **LA FECHA QUE MANDA ES EL CORTE DEL PERÍODO, NO «HOY».** La carta se costea
 * con los precios y las recetas vigentes al cerrar el mes, no con los de esta
 * mañana: pedir marzo en septiembre tiene que devolver marzo.
 */

import type { ItemId, ProductId } from '../../../../shared/domain/identity/identificadores';
import { Count, Money, Quantity, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import type { PeriodoLeido } from '../../../periods/application/ports/repositorio-de-periodos.port';
import type { EstadoDePeriodo } from '../../../periods/domain/cierre';
import type {
  CosteoDelProducto,
  CostearCarta,
} from '../../../costing/application/casos-de-uso/costear';
import { totalesDelMes } from '../../../costing/domain/costeo-de-producto';
import {
  compartidoDeCompany,
  type CompartidoDeCompany,
} from '../../../costing/application/casos-de-uso/compartido';
import type { ListarItems } from '../../../catalog/application/casos-de-uso/items';
import type { LeerCarta } from '../../../recipes/application/casos-de-uso/carta';
import type {
  CalcularConsumoTeorico,
  ConsultarAgregadosDelPeriodo,
  ConsultarConteoConfirmado,
} from '../../../inventory/application/casos-de-uso/para-analitica';
import type { ConsultarPeriodo } from '../../../periods/application/casos-de-uso/periodos';
import type { LeerAjustes } from '../../../pricing/application/casos-de-uso/ajustes';
import type { CostosDeItems } from '../../../pricing/application/casos-de-uso/costos-de-items';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { ConciliacionDeConteo } from '../../../inventory/application/casos-de-uso/conteos';
import type { AgregadoDeItem } from '../../../inventory/application/ports/repositorio-de-inventario.port';
import { DIVISION } from '../../../../shared/domain/decimal/escalas';
import { PeriodoSinDatosError } from '../../domain/errores';
import type { LineaDeCosto } from '../../domain/punto-de-equilibrio';
import type { UmbralesDelResumen } from '../../domain/resumen';
import type { DependenciasDeCarga, MesDeUbicacion } from './carga';

export interface DependenciasDeVistas extends DependenciasDeCarga {
  readonly costearCarta: CostearCarta;
  /**
   * NO SE USA DIRECTAMENTE AQUI: hace falta para abrir el ambito compartido.
   *
   * `CostearCarta` y `CalcularConsumoTeorico` piden la misma carta con los
   * mismos argumentos, y el ambito solo puede unificarlas si lo posee quien las
   * llama a las dos. Ver `costing/.../compartido.ts`.
   */
  readonly leerCarta: LeerCarta;
  readonly consumoTeorico: CalcularConsumoTeorico;
  readonly agregados: ConsultarAgregadosDelPeriodo;
  readonly conteoConfirmado: ConsultarConteoConfirmado;
  readonly listarItems: ListarItems;
  readonly costosDeItems: CostosDeItems;
  readonly leerAjustes: LeerAjustes;
  readonly consultarPeriodo: ConsultarPeriodo;
}

export interface ParametrosDelPeriodo {
  readonly ivaVenta: Ratio;
  readonly reglaPopularidad: Ratio;
  readonly diasOperativos: Count;
  readonly diasDeCobertura: Count;
}

export interface ContextoDelPeriodo {
  readonly anio: number;
  readonly mes: number;
  /**
   * El estado del mes TAL COMO LO DICE `period.status` (P16-C, D-16.124). Hasta
   * entonces el consolidado lo deducía de si había conteo confirmado, y un mes
   * reabierto que conserva su conteo salía «CERRADO».
   */
  readonly estadoDelPeriodo: EstadoDePeriodo;
  readonly carta: readonly CosteoDelProducto[];
  readonly catalogo: ReadonlyMap<ItemId, ItemLeido>;

  readonly unidadesPorProducto: ReadonlyMap<ProductId, Count>;
  readonly unidadesTotales: Count;
  readonly ventaNetaMes: Money;
  readonly mcMesTotal: Money;
  readonly empaqueTeoricoMes: Money;
  readonly provisionMermaMes: Money;

  readonly consumoPorItem: ReadonlyMap<ItemId, Ratio>;
  readonly consumoTeoricoValorizado: Money;

  readonly agregados: ReadonlyMap<ItemId, AgregadoDeItem>;
  readonly comprasDelMes: Money;

  /** El conteo confirmado de ESTE mes, congelado. `null` si no lo hubo. */
  readonly conteo: ConciliacionDeConteo | null;
  readonly conteoPorItem: ReadonlyMap<ItemId, Quantity>;
  /** Lo contado el mes ANTERIOR: el `stock_inicial` de SPEC §18. */
  readonly stockInicial: ReadonlyMap<ItemId, Quantity>;
  readonly inventarioInicial: Money;

  readonly costoPorItem: ReadonlyMap<ItemId, Money>;
  readonly sinCosto: readonly ItemId[];
  readonly itemsDelInventario: ReadonlySet<ItemId>;
  readonly costosFijos: readonly LineaDeCosto[];

  readonly parametros: ParametrosDelPeriodo;
  readonly umbrales: UmbralesDelResumen;
}

export interface PedidoDeContexto {
  readonly deps: DependenciasDeVistas;
  readonly sesion: SesionActiva;
  readonly pedido: MesDeUbicacion;
  /** Si no llega, se abre uno propio. Ver la nota de abajo. */
  readonly compartido?: CompartidoDeCompany;
}

/**
 * Arma el contexto de un mes.
 *
 * **`compartido` ES LO QUE HACE VIABLE EL CONSOLIDADO.** Los ajustes, el
 * catálogo de ítems y los costos al corte son de COMPANY: no cambian entre
 * ubicaciones. Sin compartirlos, un consolidado de diez ubicaciones los leía
 * diez veces —y los costos de los 500 ítems se calculaban veinte— y el
 * presupuesto de §5 se pasaba en un 75 %. Lo midió `npm run bench`.
 *
 * Quien no pase uno recibe el suyo, así que llamar a `contexto` con tres
 * argumentos sigue siendo correcto; lo que gana igual es dejar de repetir el
 * cálculo de costos dentro de una misma pasada.
 *
 * @throws {PeriodoSinDatosError} si nadie ha tocado ese mes en esa ubicación.
 * @throws {UbicacionFueraDeAlcanceError}
 */
export async function contexto(entrada: PedidoDeContexto): Promise<ContextoDelPeriodo> {
  const { deps, sesion, pedido } = entrada;
  const compartido = entrada.compartido ?? compartidoDeCompany(deps, sesion);

  const periodo = await deps.consultarPeriodo.ejecutar(sesion, pedido);
  if (periodo === null) {
    throw new PeriodoSinDatosError(`${String(pedido.anio)}-${String(pedido.mes)}`);
  }

  const [ventas, costos, ajustes, carta, items] = await Promise.all([
    deps.repositorio.ventasDe({ companyId: sesion.companyId, periodId: periodo.id }),
    deps.repositorio.costosDe({ companyId: sesion.companyId, periodId: periodo.id }),
    compartido.ajustes(),
    // El corte, no «hoy»: la carta se costea con lo vigente al cerrar el mes.
    deps.costearCarta.ejecutar(
      sesion,
      { locationId: pedido.locationId, fecha: periodo.finEn },
      compartido,
    ),
    compartido.items(),
  ]);

  const unidadesPorProducto = new Map(
    ventas.map((venta) => [venta.productId, Count.fromString(venta.unidades)]),
  );

  return componer({
    deps,
    compartido,
    sesion,
    periodo,
    pedido,
    ventas: unidadesPorProducto,
    costos,
    ajustes,
    carta: carta.productos,
    items,
  });
}

interface Piezas {
  readonly deps: DependenciasDeVistas;
  readonly compartido: CompartidoDeCompany;
  readonly sesion: SesionActiva;
  readonly periodo: PeriodoLeido;
  readonly pedido: MesDeUbicacion;
  readonly ventas: ReadonlyMap<ProductId, Count>;
  readonly costos: readonly { readonly concepto: string; readonly clasificacion: LineaDeCosto['clasificacion']; readonly importe: string }[];
  readonly ajustes: {
    readonly ivaVenta: string;
    readonly reglaPopularidad: string;
    readonly diasOperativosMes: number;
    readonly diasCobertura: number;
    readonly foodCostUmbralVerde: string;
    readonly foodCostMaximo: string;
    readonly primeCostMaximo: string;
  };
  readonly carta: readonly CosteoDelProducto[];
  readonly items: readonly ItemLeido[];
}

/** La varianza que SPEC §16 marca como problema de proceso. No es de D3. */
const VARIANZA_MAXIMA = '0.05';

const PRIMER_MES = 1;
const ULTIMO_MES = 12;

/** Las cinco consultas que dependen de lo ya traído. Fijas, no por ítem. */
async function traerLoDerivado(piezas: Piezas): Promise<Derivado> {
  const { deps, sesion, periodo, pedido } = piezas;

  const [consumo, agregados, conteo, anterior, costosDeItems] = await Promise.all([
    deps.consumoTeorico.ejecutar(
      sesion,
      {
        locationId: pedido.locationId,
        fecha: periodo.finEn,
        ventas: [...piezas.ventas].map(([productId, unidades]) => ({
          productId,
          unidades: unidades.toExactString(),
        })),
      },
      // La carta que `CostearCarta` acaba de leer, no una segunda lectura de
      // `recipe_line` con los mismos argumentos.
      piezas.compartido.cartaDe(pedido.locationId, periodo.finEn),
    ),
    deps.agregados.ejecutar(sesion, {
      locationId: pedido.locationId,
      desde: periodo.inicioEn,
      hasta: periodo.finEn,
    }),
    deps.conteoConfirmado.ejecutar(sesion, { periodId: periodo.id }),
    conteoAnterior(piezas),
    // El MISMO corte con el que se costeó la carta, así que esta es la segunda
    // llamada a una promesa que ya está en vuelo: cuesta cero.
    piezas.compartido.costosAlCorte(periodo.finEn),
  ]);

  return { consumo, agregados, conteo, anterior, costosDeItems };
}

interface Derivado {
  readonly consumo: ReadonlyMap<ItemId, Ratio>;
  readonly agregados: readonly AgregadoDeItem[];
  readonly conteo: ConciliacionDeConteo | null;
  readonly anterior: ConciliacionDeConteo | null;
  readonly costosDeItems: { readonly porItem: ReadonlyMap<ItemId, { readonly costoNetoDeUso: Money }>; readonly sinPrecio: readonly ItemId[] };
}

/** Qué mes es y en qué estado está: lo que identifica al contexto, sin calcular nada. */
function elMes(piezas: Piezas): Pick<ContextoDelPeriodo, 'anio' | 'mes' | 'estadoDelPeriodo'> {
  return { anio: piezas.pedido.anio, mes: piezas.pedido.mes, estadoDelPeriodo: piezas.periodo.estado };
}

async function componer(piezas: Piezas): Promise<ContextoDelPeriodo> {
  const { consumo, agregados, conteo, anterior, costosDeItems } = await traerLoDerivado(piezas);

  const catalogo = new Map(piezas.items.map((item) => [item.id, item]));
  const costoPorItem = new Map(
    [...costosDeItems.porItem].map(([itemId, costo]) => [itemId, costo.costoNetoDeUso]),
  );
  const totales = totalesDeLaCarta({ carta: piezas.carta, unidades: piezas.ventas });
  const stockInicial = cantidadesDe(anterior, catalogo, true);
  const conteoPorItem = cantidadesDe(conteo, catalogo, false);
  const porAgregado = new Map(agregados.map((agregado) => [agregado.itemId, agregado]));

  return {
    ...elMes(piezas),
    carta: piezas.carta,
    catalogo,
    unidadesPorProducto: piezas.ventas,
    unidadesTotales: totales.unidades,
    ventaNetaMes: totales.ventaNetaMes,
    mcMesTotal: totales.mcMes,
    empaqueTeoricoMes: totales.empaque,
    provisionMermaMes: totales.provision,
    consumoPorItem: consumo,
    consumoTeoricoValorizado: valorizarConsumo(consumo, costoPorItem),
    agregados: porAgregado,
    comprasDelMes: Money.sum(
      agregados.map((agregado) => Money.fromDatabase(agregado.importeDeCompras)),
    ),
    conteo,
    conteoPorItem,
    stockInicial,
    // Sin conteo del mes anterior el inicial es CERO, y el resumen lo delata:
    // `coberturaDelConteo` viaja al lado de todo lo que depende de él.
    inventarioInicial: anterior === null ? Money.CERO : Money.fromDatabase(anterior.valorFisico),
    costoPorItem,
    sinCosto: costosDeItems.sinPrecio,
    itemsDelInventario: universo({ porAgregado, consumo, conteoPorItem, stockInicial }),
    costosFijos: piezas.costos.map(comoLineaDeCosto),
    parametros: parametrosDe(piezas),
    umbrales: umbralesDe(piezas),
  };
}

function comoLineaDeCosto(costo: Piezas['costos'][number]): LineaDeCosto {
  return {
    concepto: costo.concepto,
    clasificacion: costo.clasificacion,
    importe: Money.fromDatabase(costo.importe),
  };
}

function parametrosDe(piezas: Piezas): ParametrosDelPeriodo {
  return {
    ivaVenta: Ratio.fromDecimalString(piezas.ajustes.ivaVenta),
    reglaPopularidad: Ratio.fromDecimalString(piezas.ajustes.reglaPopularidad),
    diasOperativos: Count.fromInteger(piezas.ajustes.diasOperativosMes),
    diasDeCobertura: Count.fromInteger(piezas.ajustes.diasCobertura),
  };
}

function umbralesDe(piezas: Piezas): UmbralesDelResumen {
  return {
    umbralVerde: Ratio.fromDecimalString(piezas.ajustes.foodCostUmbralVerde),
    foodCostMaximo: Ratio.fromDecimalString(piezas.ajustes.foodCostMaximo),
    primeCostMaximo: Ratio.fromDecimalString(piezas.ajustes.primeCostMaximo),
    varianzaMaxima: Ratio.fromDecimalString(VARIANZA_MAXIMA),
  };
}

/** El conteo confirmado del mes ANTERIOR: el `stock_inicial` de SPEC §18. */
async function conteoAnterior(piezas: Piezas): Promise<ConciliacionDeConteo | null> {
  const { anio, mes } = piezas.pedido;
  const previo = mes === PRIMER_MES ? { anio: anio - 1, mes: ULTIMO_MES } : { anio, mes: mes - 1 };

  const periodo = await piezas.deps.consultarPeriodo.ejecutar(piezas.sesion, {
    locationId: piezas.pedido.locationId,
    ...previo,
  });
  if (periodo === null) return null;

  return piezas.deps.conteoConfirmado.ejecutar(piezas.sesion, { periodId: periodo.id });
}

/**
 * Las cantidades de una conciliación congelada, por ítem.
 *
 * `arrastrarTeorico` distingue los dos usos:
 *   - **stock inicial** (`true`): un ítem que nadie contó el mes pasado arrastra
 *     su teórico, que es lo que D7 significa con «no genera diferencia».
 *   - **conteo del mes** (`false`): un ítem sin contar queda **fuera del mapa**,
 *     y la vista de inventario lo verá como `null` — «sin verificar».
 */
function cantidadesDe(
  conciliacion: ConciliacionDeConteo | null,
  catalogo: ReadonlyMap<ItemId, ItemLeido>,
  arrastrarTeorico: boolean,
): ReadonlyMap<ItemId, Quantity> {
  const cantidades = new Map<ItemId, Quantity>();
  if (conciliacion === null) return cantidades;

  for (const fila of conciliacion.filas) {
    const valor = fila.contado ?? (arrastrarTeorico ? fila.teorico : null);
    if (valor === null) continue;

    const unidad = unidadDeUso(catalogo.get(fila.itemId)?.unidadDeUso ?? 'unid');
    cantidades.set(fila.itemId, Quantity.fromDatabase(valor, unidad));
  }
  return cantidades;
}

function valorizarConsumo(
  consumo: ReadonlyMap<ItemId, Ratio>,
  costos: ReadonlyMap<ItemId, Money>,
): Money {
  return Money.sum(
    [...consumo].map(([itemId, cantidad]) => (costos.get(itemId) ?? Money.CERO).times(cantidad)),
  );
}

/**
 * Los ítems que la vista de inventario tiene que listar.
 *
 * Es la UNIÓN de cuatro orígenes, y ninguno sobra: un ítem puede tener consumo
 * teórico sin haberse comprado este mes, o haberse contado sin haberse movido.
 * Quedarse solo con los que tienen movimientos escondería justo los que peor
 * están.
 */
function universo(datos: {
  readonly porAgregado: ReadonlyMap<ItemId, AgregadoDeItem>;
  readonly consumo: ReadonlyMap<ItemId, Ratio>;
  readonly conteoPorItem: ReadonlyMap<ItemId, Quantity>;
  readonly stockInicial: ReadonlyMap<ItemId, Quantity>;
}): ReadonlySet<ItemId> {
  return new Set([
    ...datos.porAgregado.keys(),
    ...datos.consumo.keys(),
    ...datos.conteoPorItem.keys(),
    ...datos.stockInicial.keys(),
  ]);
}

/**
 * `venta_neta_mes` y `mc_mes` de SPEC §14, sumados sobre la carta.
 *
 * **Reutiliza `totalesDelMes` de P5**, que existía desde entonces esperando
 * exactamente este dato: «van aparte del costeo porque necesitan las unidades
 * vendidas del período, y el período es una dimensión que el Excel no tiene».
 */
export function totalesDeLaCarta(entrada: {
  readonly carta: readonly CosteoDelProducto[];
  readonly unidades: ReadonlyMap<ProductId, Count>;
}): {
  readonly ventaNetaMes: Money;
  readonly mcMes: Money;
  readonly empaque: Money;
  readonly provision: Money;
  readonly unidades: Count;
} {
  const vendibles = entrada.carta.filter((producto) => producto.costeo.venta.clase === 'vendible');

  return vendibles.reduce(
    (acumulado, producto) => sumarProducto(acumulado, producto, entrada.unidades),
    {
      ventaNetaMes: Money.CERO,
      mcMes: Money.CERO,
      empaque: Money.CERO,
      provision: Money.CERO,
      unidades: Count.CERO,
    },
  );
}

interface Totales {
  readonly ventaNetaMes: Money;
  readonly mcMes: Money;
  readonly empaque: Money;
  readonly provision: Money;
  readonly unidades: Count;
}

function sumarProducto(
  acumulado: Totales,
  producto: CosteoDelProducto,
  porProducto: ReadonlyMap<ProductId, Count>,
): Totales {
  const venta = producto.costeo.venta;
  if (venta.clase !== 'vendible') return acumulado;

  const unidades = porProducto.get(producto.productId) ?? Count.CERO;
  const mes = totalesDelMes({ venta, unidades });

  return {
    ventaNetaMes: acumulado.ventaNetaMes.plus(mes.ventaNetaMes),
    mcMes: acumulado.mcMes.plus(mes.mcMes),
    empaque: acumulado.empaque.plus(producto.costeo.costos.empaqueNeto.times(unidades)),
    // `provision_merma_mes = Σ(costo_por_porcion × merma × unidades)` — SPEC §16.
    // El factor es el mismo `provisionMerma` que el motor usó para el costo con
    // merma, no uno nuevo: si fueran dos, R7 dejaría de dar cero.
    provision: acumulado.provision.plus(
      producto.costeo.costos.costoPorPorcion
        .times(porProducto.get(producto.productId) ?? Count.CERO)
        .times(provisionDe(producto)),
    ),
    unidades: acumulado.unidades.plus(unidades),
  };
}

/**
 * La provisión de merma con que se costeó este producto, **deducida del propio
 * costeo** y no recibida aparte.
 *
 * `costo_con_merma = costo_por_porcion × (1 + merma)`, así que
 * `merma = costo_con_merma / costo_por_porcion − 1`. Deducirla garantiza que
 * el `provision_merma_mes` de R7 usa **exactamente** el mismo factor que el
 * motor aplicó: pasarlo por parámetro dejaría dos fuentes para el mismo número,
 * y la conciliación fallaría el día que una company cambiara el suyo.
 */
function provisionDe(producto: CosteoDelProducto): Ratio {
  const { costoPorPorcion, costoConMerma } = producto.costeo.costos;
  if (costoPorPorcion.isZero()) return Ratio.CERO;

  return costoConMerma.ratioTo(costoPorPorcion, DIVISION).minus(Ratio.UNO);
}
