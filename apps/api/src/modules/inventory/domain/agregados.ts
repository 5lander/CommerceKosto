/**
 * Lo que el libro de un período dice de cada ítem — SPEC §16 y §18, plegado
 * con la base apagada.
 *
 * **POR QUÉ EXISTE ESTE ARCHIVO, Y NO EXISTÍA ANTES (D-16.201, clase de
 * INC-029).** El saldo tenía dos definiciones que se vigilaban entre sí: el
 * `SUM` de PostgreSQL y `proyectarSaldos`, con una prueba que exige que den el
 * mismo número. **El dinero no tenía ninguna**: `Σ(total_cost)` vivía
 * únicamente dentro de una consulta, en infraestructura, sin una sola prueba
 * unitaria que dijera qué debía valer. Por esa grieta entró INC-029 —una compra
 * corregida que seguía contando su importe— y por ahí puede entrar la
 * siguiente. Aquí está la definición, en el dominio, con sus casos conocidos.
 *
 * **LA REGLA QUE INC-029 VIOLABA, EN UNA LÍNEA:** `total_cost` es una MAGNITUD
 * SIN SIGNO (ADR-009 §2) y el sentido lo lleva la cantidad, así que sumar
 * importes sin mirar el signo de su cantidad **suma la compra y su corrección**
 * en vez de cancelarlas.
 *
 * **`CONSUMO_POR_VENTA` NO ENTRA EN NINGÚN AGREGADO**, y es la misma decisión
 * que toma la consulta: el Excel no tiene movimientos de consumo —lo calcula
 * desde la receta— y contarlos aquí *además* de restar el consumo teórico
 * dejaría el stock teórico corto por el valor entero del consumo del mes.
 *
 * **EL ORDEN NO IMPORTA.** La suma decimal es exacta y asociativa: el agregado
 * no depende de en qué orden lleguen los movimientos, y la prueba lo fija
 * barajándolos.
 */

import type { ItemId } from '../../../shared/domain/identity/identificadores';
import { Money, Quantity } from '../../../shared/domain/money/tipos-monetarios';
import type { MovimientoDelLibro, TipoDeMovimiento } from './movimiento';

/**
 * Un movimiento con lo que costó.
 *
 * `costoTotal` es la **magnitud sin signo** que guarda el libro, tal cual, y
 * `null` donde el tipo no lo lleva: una merma o una transferencia no mueven
 * dinero por sí solas.
 */
export interface MovimientoValorizado extends MovimientoDelLibro {
  readonly costoTotal: Money | null;
}

/** Lo que un ítem movió en el período, separado por lo que cada vista necesita. */
export interface AgregadoDeItem {
  readonly itemId: ItemId;
  /** `Σ` cantidad de `COMPRA`, **con signo**: una compra corregida se cancela sola */
  readonly compras: Quantity;
  /** `Σ(MERMA) + Σ(AJUSTE)`, con signo */
  readonly mermasYAjustes: Quantity;
  /** Transferencias y producción, con signo. No existen en el Excel: son P6 */
  readonly otros: Quantity;
  /** `Σ(signo(cantidad) × total_cost)` de `COMPRA` — `compras_del_mes` de SPEC §16 */
  readonly importeDeCompras: Money;
}

const COMPRA: TipoDeMovimiento = 'COMPRA';
const CONSUMO_POR_VENTA: TipoDeMovimiento = 'CONSUMO_POR_VENTA';
const MERMA_O_AJUSTE: readonly TipoDeMovimiento[] = ['MERMA', 'AJUSTE'];

interface Acumulado {
  readonly itemId: ItemId;
  compras: Quantity;
  mermasYAjustes: Quantity;
  otros: Quantity;
  importeDeCompras: Money;
}

/**
 * Pliega el libro de un período en un agregado por ítem.
 *
 * Los movimientos llegan **ya recortados al período y a la ubicación**: quién
 * pertenece a qué mes es cosa del calendario, no de esta función.
 *
 * @throws {UnidadIncompatibleError} si dos movimientos del mismo ítem traen
 *   unidades distintas — que sería el catálogo roto, no un agregado raro
 */
export function plegarAgregadosDelPeriodo(
  movimientos: readonly MovimientoValorizado[],
): readonly AgregadoDeItem[] {
  const porItem = new Map<string, Acumulado>();

  for (const movimiento of movimientos) {
    if (movimiento.tipo === CONSUMO_POR_VENTA) continue;

    const acumulado = porItem.get(movimiento.itemId) ?? vacio(movimiento);
    sumar(acumulado, movimiento);
    porItem.set(movimiento.itemId, acumulado);
  }

  return [...porItem.values()];
}

/**
 * `compras_del_mes` de SPEC §16: lo que se pagó por lo que entró, **neto de
 * correcciones**.
 *
 * Sale del mismo pliegue que el resto para que no existan dos definiciones del
 * mismo número. Es la cifra que entra en el food cost real (R7), y por eso
 * tiene su caso conocido: **CC-010**.
 */
export function comprasDelMes(movimientos: readonly MovimientoValorizado[]): Money {
  return Money.sum(plegarAgregadosDelPeriodo(movimientos).map((item) => item.importeDeCompras));
}

function vacio(movimiento: MovimientoValorizado): Acumulado {
  const cero = Quantity.cero(movimiento.cantidad.unidad);
  return {
    itemId: movimiento.itemId,
    compras: cero,
    mermasYAjustes: cero,
    otros: cero,
    importeDeCompras: Money.CERO,
  };
}

function sumar(acumulado: Acumulado, movimiento: MovimientoValorizado): void {
  if (movimiento.tipo === COMPRA) {
    acumulado.compras = acumulado.compras.plus(movimiento.cantidad);
    acumulado.importeDeCompras = acumulado.importeDeCompras.plus(importeConSigno(movimiento));
    return;
  }
  if (MERMA_O_AJUSTE.includes(movimiento.tipo)) {
    acumulado.mermasYAjustes = acumulado.mermasYAjustes.plus(movimiento.cantidad);
    return;
  }
  acumulado.otros = acumulado.otros.plus(movimiento.cantidad);
}

/**
 * El importe de una compra **con el signo de su cantidad** — la línea de la
 * que nació INC-029.
 *
 * Una compra corregida es otra `COMPRA`, con cantidad negativa y el mismo
 * importe en positivo: sin este signo, el dinero de una compra que se anuló
 * sigue contando en el mes, y de ahí sale el food cost real.
 */
function importeConSigno(movimiento: MovimientoValorizado): Money {
  if (movimiento.costoTotal === null) return Money.CERO;
  return movimiento.cantidad.isNegative() ? movimiento.costoTotal.negated() : movimiento.costoTotal;
}
