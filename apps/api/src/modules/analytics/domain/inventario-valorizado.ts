/**
 * Inventario valorizado, estados y días de cobertura — SPEC §18.
 *
 * ```
 * compras_mes      = Σ(cantidad de movimientos COMPRA del ítem)
 * mermas_ajustes   = Σ(cantidad de MERMA) + Σ(AJUSTE)
 * STOCK_TEORICO    = stock_inicial + compras - consumo_teorico - mermas_ajustes
 * diferencia       = conteo_fisico vacío ? null : conteo_fisico - stock_teorico
 * valor_diferencia = diferencia × costo_neto_uso
 * dias_cobertura   = consumo = 0 ? null : stock_teorico / (consumo_teorico / dias_operativos)
 *
 * estado = consumo_teorico = 0  → "SIN CONSUMO"
 *        : stock_teorico < 0    → "FALTAN COMPRAS"
 *        : stock_teorico < reorden → "REPONER"
 *        : "OK"
 * ```
 *
 * ---
 *
 * **DOS TRADUCCIONES DEL EXCEL QUE HAY QUE HACER CON CUIDADO, PORQUE LAS DOS
 * PRODUCEN UN NÚMERO PLAUSIBLE Y EQUIVOCADO SI SE HACEN MAL.**
 *
 * **1. El signo.** El SPEC **resta** `mermas_ajustes`, lo que significa que en
 * el Excel las mermas se capturan en positivo. En este sistema el libro lleva
 * el signo dentro de la cantidad (P6, ADR-009): una merma **ya es negativa**.
 * Restarla la sumaría. Aquí todo lo que viene del libro se **suma** con su
 * signo, que es la traducción correcta de la misma fórmula:
 *
 * ```
 * stock_teorico = inicial + compras + mermas_ajustes + otros - consumo_teorico
 * ```
 *
 * y `mermasYAjustes` se devuelve **con el signo del libro**, no invertido para
 * parecerse al Excel. Un número que se suma es un número que se suma.
 *
 * **2. El consumo, que si no se cuenta DOS VECES.** El Excel no tiene
 * movimientos de consumo: el consumo es teórico, calculado desde la receta.
 * Este sistema **sí puede tener** movimientos `CONSUMO_POR_VENTA` en el libro
 * (P6), y son exactamente el mismo consumo por el mismo camino —`explotarConsumo`
 * usa la receta—. Sumarlos *y además* restar el consumo teórico lo descontaría
 * dos veces.
 *
 * Por eso **`CONSUMO_POR_VENTA` no entra en ninguno de los agregados del
 * libro**: el consumo se resta una sola vez, calculado. El efecto es que el
 * stock teórico da lo mismo esté o no registrado el consumo por venta, y hay
 * una prueba de integración que corre las dos configuraciones y exige que
 * coincidan.
 *
 * ---
 *
 * ES DOMINIO PURO: entran cantidades y costos, salen estados. Los días
 * operativos y los de cobertura llegan por parámetro (D3).
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import type { ItemId } from '../../../shared/domain/identity/identificadores';
import { Count, Money, Quantity, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export type EstadoDeItem = 'SIN_CONSUMO' | 'FALTAN_COMPRAS' | 'REPONER' | 'OK';

/** El semáforo que `BODEGA` sí puede ver — SPEC §4, **sin la cantidad**. */
export type Semaforo = 'REPONER' | 'OK';

export interface EntradaDeItem {
  readonly itemId: ItemId;
  /** El conteo confirmado del período anterior. Cero si no lo hubo. */
  readonly stockInicial: Quantity;
  /** `Σ` de las cantidades `COMPRA` del período. Positiva. */
  readonly compras: Quantity;
  /** `Σ(MERMA) + Σ(AJUSTE)`, **con el signo del libro**. */
  readonly mermasYAjustes: Quantity;
  /**
   * Transferencias y producción, con su signo. No existen en el Excel: son la
   * extensión de P6, y mueven el stock de esta ubicación igual que una compra.
   */
  readonly otrosMovimientos: Quantity;
  /** De la receta × unidades vendidas. Positivo; se **resta**. */
  readonly consumoTeorico: Quantity;
  /** `null` si nadie contó este ítem — D7: no genera diferencia. */
  readonly conteoFisico: Quantity | null;
  readonly costoDeUso: Money;
}

export interface ItemValorizado {
  readonly itemId: ItemId;
  readonly stockInicial: Quantity;
  readonly compras: Quantity;
  readonly mermasYAjustes: Quantity;
  readonly consumoTeorico: Quantity;
  readonly stockTeorico: Quantity;
  readonly valorTeorico: Money;
  readonly conteoFisico: Quantity | null;
  readonly diferencia: Quantity | null;
  readonly valorDeDiferencia: Money | null;
  /** `null` sin consumo: no hay a cuántos días alcanza algo que no se gasta. */
  readonly diasCobertura: Ratio | null;
  readonly puntoDeReorden: Quantity;
  readonly estado: EstadoDeItem;
}

export interface Inventario {
  readonly items: readonly ItemValorizado[];
  readonly valorTotal: Money;
}

export interface Parametros {
  readonly diasOperativos: Count;
  readonly diasDeCobertura: Count;
}

export function valorizarInventario(entrada: {
  readonly items: readonly EntradaDeItem[];
  readonly parametros: Parametros;
}): Inventario {
  const items = entrada.items.map((item) => valorizarUno(item, entrada.parametros));
  return { items, valorTotal: Money.sum(items.map((item) => item.valorTeorico)) };
}

/**
 * El semáforo de `BODEGA`, derivado del estado y **sin nada más**.
 *
 * `FALTAN_COMPRAS` y `SIN_CONSUMO` colapsan: el primero es un caso de
 * `REPONER` —el libro dice que hay menos que nada— y el segundo, de `OK`. Que
 * `BODEGA` distinguiera «faltan compras» de «reponer» ya sería un dato sobre
 * el stock teórico, que es justo lo que no puede saber (CLAUDE.md §4.3).
 */
export function semaforoDe(estado: EstadoDeItem): Semaforo {
  return estado === 'REPONER' || estado === 'FALTAN_COMPRAS' ? 'REPONER' : 'OK';
}

function valorizarUno(item: EntradaDeItem, parametros: Parametros): ItemValorizado {
  const stockTeorico = item.stockInicial
    .plus(item.compras)
    .plus(item.mermasYAjustes)
    .plus(item.otrosMovimientos)
    .minus(item.consumoTeorico);

  const consumoDiario = porDia(item.consumoTeorico, parametros.diasOperativos);
  const puntoDeReorden = consumoDiario.timesScalar(parametros.diasDeCobertura.asRatio());

  return {
    itemId: item.itemId,
    stockInicial: item.stockInicial,
    compras: item.compras,
    mermasYAjustes: item.mermasYAjustes,
    consumoTeorico: item.consumoTeorico,
    stockTeorico,
    valorTeorico: valorDe(stockTeorico, item.costoDeUso),
    conteoFisico: item.conteoFisico,
    ...diferenciaDe(item, stockTeorico),
    diasCobertura: cobertura(stockTeorico, consumoDiario),
    puntoDeReorden,
    estado: estadoDe({ item, stockTeorico, puntoDeReorden }),
  };
}

/**
 * `consumo_teorico / dias_operativos`.
 *
 * Con cero días operativos devuelve cero en vez de lanzar: es configuración a
 * medio llenar, y un inventario a medio configurar tiene que poder mirarse.
 */
function porDia(consumo: Quantity, diasOperativos: Count): Quantity {
  if (diasOperativos.isZero()) return Quantity.cero(consumo.unidad);
  return consumo.dividedByScalar(diasOperativos.asRatio(), DIVISION);
}

function diferenciaDe(
  item: EntradaDeItem,
  stockTeorico: Quantity,
): { readonly diferencia: Quantity | null; readonly valorDeDiferencia: Money | null } {
  if (item.conteoFisico === null) {
    return { diferencia: null, valorDeDiferencia: null };
  }
  const diferencia = item.conteoFisico.minus(stockTeorico);
  return { diferencia, valorDeDiferencia: valorDe(diferencia, item.costoDeUso) };
}

function cobertura(stockTeorico: Quantity, consumoDiario: Quantity): Ratio | null {
  if (consumoDiario.isZero()) return null;
  return stockTeorico.ratioTo(consumoDiario, DIVISION);
}

/**
 * El orden de las guardas es el del SPEC y **no es intercambiable**.
 *
 * «Sin consumo» va primero: un ítem que no se gasta nunca está por debajo de
 * su punto de reorden —que es cero— y clasificarlo como `OK` por esa vía
 * escondería que en realidad nadie sabe si sobra o falta.
 */
function estadoDe(datos: {
  readonly item: EntradaDeItem;
  readonly stockTeorico: Quantity;
  readonly puntoDeReorden: Quantity;
}): EstadoDeItem {
  if (datos.item.consumoTeorico.isZero()) return 'SIN_CONSUMO';
  if (datos.stockTeorico.isNegative()) return 'FALTAN_COMPRAS';
  if (datos.stockTeorico.lessThan(datos.puntoDeReorden)) return 'REPONER';
  return 'OK';
}

/**
 * `magnitude()` es el único puente de `Quantity` a escalar, y afirmarlo aquí
 * es afirmar que `costoDeUso` está por unidad de uso del mismo ítem. Lo está:
 * es `costo_neto_uso` de SPEC §12.
 */
function valorDe(cantidad: Quantity, costoDeUso: Money): Money {
  return costoDeUso.times(cantidad.magnitude());
}
