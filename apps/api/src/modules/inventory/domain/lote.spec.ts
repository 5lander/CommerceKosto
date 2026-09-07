/**
 * El lote de movimientos — dominio puro, con la base apagada.
 */

import { describe, expect, it } from 'vitest';

import { problemasDelLoteDeMovimientos, type MovimientoDelLote } from './lote';

const CUANDO = new Date('2026-03-15T12:00:00.000Z');

function movimiento(parcial: Partial<MovimientoDelLote> = {}): MovimientoDelLote {
  return {
    item: 'Tomate riñón',
    tipo: 'COMPRA',
    cantidad: '10',
    costoTotal: '25.00',
    occurredAt: CUANDO,
    note: null,
    ...parcial,
  };
}

describe('lote de movimientos', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDeMovimientos([movimiento()])).toEqual([]);
  });

  /**
   * El agujero más caro del archivo, y el más silencioso: el saldo de unidades
   * cuadra igual, así que nada avisa. Lo que sale mal es
   * `compras_del_mes` (SPEC §16), y con él el food cost real.
   */
  it('una COMPRA sin importe se rechaza', () => {
    const problemas = problemasDelLoteDeMovimientos([movimiento({ costoTotal: null })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/food cost real/u);
  });

  it('una MERMA sin importe es válida: no se compró nada', () => {
    expect(
      problemasDelLoteDeMovimientos([movimiento({ tipo: 'MERMA', costoTotal: null })]),
    ).toEqual([]);
  });

  it('la cantidad llega SIN signo: el signo lo pone el dominio por el tipo', () => {
    const problemas = problemasDelLoteDeMovimientos([movimiento({ tipo: 'MERMA', cantidad: '-3' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/sin signo/u);
  });

  it('un movimiento de cantidad cero se rechaza', () => {
    expect(problemasDelLoteDeMovimientos([movimiento({ cantidad: '0.0' })])).toHaveLength(1);
  });

  /**
   * A diferencia del catálogo, aquí NO se comprueban repetidos: comprar dos
   * veces el mismo ítem el mismo día son dos facturas, no un error de captura.
   */
  it('el mismo ítem dos veces el mismo día son dos compras, no un duplicado', () => {
    expect(problemasDelLoteDeMovimientos([movimiento(), movimiento()])).toEqual([]);
  });

  it('devuelve todos los problemas con su posición, no el primero', () => {
    const problemas = problemasDelLoteDeMovimientos([
      movimiento(),
      movimiento({ costoTotal: null }),
      movimiento({ cantidad: 'una caja' }),
    ]);

    expect(problemas.map((p) => p.posicion)).toEqual([2, 3]);
  });

  it('una fila sin ítem se rechaza', () => {
    expect(problemasDelLoteDeMovimientos([movimiento({ item: '' })])).toHaveLength(1);
  });
});
