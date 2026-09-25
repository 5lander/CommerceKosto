/**
 * CC-010 — un mes con el vocabulario completo del libro, con la base apagada.
 *
 * **El caso está escrito en `docs/pruebas/casos-conocidos.md` ANTES que este
 * pliegue** (D-16.201), con sus ocho movimientos y sus cuatro números
 * esperados. Aquí solo se ejecuta.
 *
 * Lo que cierra —la clase de INC-029, no su instancia— es que exista un sitio
 * donde esté escrito **qué vale `compras_del_mes`**. Hasta D-16.201 el único
 * sitio era una consulta SQL, y por eso una compra corregida pudo seguir
 * contando su importe durante cuatro paquetes sin que nada fallara.
 */

import { describe, expect, it } from 'vitest';

import { itemId, locationId } from '../../../shared/domain/identity/identificadores';
import { Money, Quantity } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { comprasDelMes, plegarAgregadosDelPeriodo, type MovimientoValorizado } from './agregados';
import type { TipoDeMovimiento } from './movimiento';

const KG = unidadDeUso('kg');
const CENTRO = locationId('01a09a19-72f5-7e57-b246-77eb6ef0982f');
const ARROZ = itemId('01a09a19-755d-7548-985d-eec2e56933ee');

/** Una fila del caso: cantidad CON signo, importe como magnitud, día de marzo. */
interface FilaDelCaso {
  readonly tipo: TipoDeMovimiento;
  readonly cantidad: string;
  readonly costoTotal: string | null;
  readonly dia: number;
}

function movimiento(fila: FilaDelCaso): MovimientoValorizado {
  return {
    locationId: CENTRO,
    itemId: ARROZ,
    tipo: fila.tipo,
    cantidad: Quantity.of(fila.cantidad, KG),
    costoTotal: fila.costoTotal === null ? null : Money.fromDecimalString(fila.costoTotal),
    ocurridoEn: new Date(Date.UTC(2026, 2, fila.dia, 12)),
  };
}

/** Los ocho movimientos de marzo, en el orden en que ocurrieron. */
const MARZO: readonly MovimientoValorizado[] = ([
  { tipo: 'COMPRA', cantidad: '100', costoTotal: '100.00', dia: 3 },
  { tipo: 'COMPRA', cantidad: '50', costoTotal: '50.00', dia: 10 },
  // La corrección de la anterior: mismo tipo, cantidad contraria, importe en
  // positivo. Es la fila que INC-029 contaba al derecho.
  { tipo: 'COMPRA', cantidad: '-50', costoTotal: '50.00', dia: 11 },
  // La transferencia NO lleva importe: mueve stock, no dinero.
  { tipo: 'TRANSFERENCIA_SALIDA', cantidad: '-20', costoTotal: null, dia: 12 },
  { tipo: 'PRODUCCION', cantidad: '-8', costoTotal: '8.00', dia: 15 },
  { tipo: 'MERMA', cantidad: '-2.5', costoTotal: null, dia: 20 },
  { tipo: 'AJUSTE', cantidad: '0.5', costoTotal: null, dia: 28 },
  { tipo: 'CONSUMO_POR_VENTA', cantidad: '-22', costoTotal: null, dia: 31 },
] satisfies readonly FilaDelCaso[]).map(movimiento);

describe('CC-010 — los agregados de un mes con todo el vocabulario del libro', () => {
  const [agregado, ...resto] = plegarAgregadosDelPeriodo(MARZO);

  it('un solo ítem, un solo agregado', () => {
    expect(resto).toHaveLength(0);
    expect(agregado?.itemId).toBe(ARROZ);
  });

  /**
   * **LA ASERCIÓN DE INC-029.** Sin el signo de la cantidad, la compra
   * corregida suma en vez de restar y el mes cierra con 200,00 de compras que
   * nadie hizo — una cifra que entra directa en el food cost real (R7).
   */
  it('compras_del_mes vale 100.00, y no 200.00: la corrección RESTA su importe', () => {
    expect(agregado?.importeDeCompras.toExactString()).toBe('100');
    expect(comprasDelMes(MARZO).toExactString()).toBe('100');
  });

  /**
   * La segunda trampa: el dinero **no vive solo en las compras**. El consumo
   * de una producción lleva importe —es el costo real del insumo que entró al
   * lote— y sumarlo daría el mes de otro negocio.
   */
  it('y tampoco 208.00 ni 92.00: el dinero que no es de una compra no es compra', () => {
    const todoSinSigno = Money.sum(MARZO.map((m) => m.costoTotal ?? Money.CERO));
    const todoConSigno = Money.sum(
      MARZO.map((m) => {
        const importe = m.costoTotal ?? Money.CERO;
        return m.cantidad.isNegative() ? importe.negated() : importe;
      }),
    );

    expect(todoSinSigno.toExactString()).toBe('208');
    expect(todoConSigno.toExactString()).toBe('92');
    expect(agregado?.importeDeCompras.toExactString()).toBe('100');
  });

  it('las cantidades de SPEC §18 salen separadas por lo que cada vista necesita', () => {
    expect(agregado?.compras.toStorageString()).toBe('100.000000000000');
    expect(agregado?.mermasYAjustes.toStorageString()).toBe('-2.000000000000');
    expect(agregado?.otros.toStorageString()).toBe('-28.000000000000');
  });

  /**
   * El Excel no tiene movimientos de consumo —lo calcula desde la receta—, así
   * que sumarlos aquí *y además* restar el consumo teórico dejaría el stock
   * teórico corto por el consumo entero del mes.
   */
  it('el CONSUMO_POR_VENTA no entra en ningún agregado', () => {
    const suma = agregado?.compras
      .plus(agregado.mermasYAjustes)
      .plus(agregado.otros)
      .toStorageString();
    // 100 − 2 − 28 = 70. Con el consumo dentro serían 48.
    expect(suma).toBe('70.000000000000');
  });

  it('el orden no cambia ni un dígito: la suma decimal es exacta y asociativa', () => {
    const barajado = [MARZO[4], MARZO[0], MARZO[7], MARZO[2], MARZO[6], MARZO[1], MARZO[5], MARZO[3]];
    const otro = plegarAgregadosDelPeriodo(barajado.filter((m): m is MovimientoValorizado => m !== undefined));

    expect(otro[0]?.importeDeCompras.toExactString()).toBe('100');
    expect(otro[0]?.compras.toStorageString()).toBe('100.000000000000');
    expect(otro[0]?.mermasYAjustes.toStorageString()).toBe('-2.000000000000');
    expect(otro[0]?.otros.toStorageString()).toBe('-28.000000000000');
  });

  it('un mes sin movimientos no es un agregado en cero: es ningún agregado', () => {
    expect(plegarAgregadosDelPeriodo([])).toHaveLength(0);
    expect(comprasDelMes([]).toExactString()).toBe('0');
  });
});
