/**
 * El lote de precios — dominio puro, con la base apagada.
 */

import { describe, expect, it } from 'vitest';

import { problemasDelLoteDePrecios, type PrecioDelLote } from './lote';

function precio(parcial: Partial<PrecioDelLote> = {}): PrecioDelLote {
  return {
    item: 'Tomate riñón',
    articulo: 'Tomate caja 10 kg',
    precio: '12.50',
    ivaCompra: null,
    origen: 'MANUAL',
    nota: null,
    ...parcial,
  };
}

describe('lote de precios', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDePrecios([precio()])).toEqual([]);
  });

  it('un precio que no es número se rechaza con su posición', () => {
    const problemas = problemasDelLoteDePrecios([precio(), precio({ item: 'Ajo', precio: 'S/P' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(2);
    expect(problemas[0]?.motivo).toMatch(/no es un número/u);
  });

  it('un IVA que no es número se rechaza', () => {
    expect(problemasDelLoteDePrecios([precio({ ivaCompra: '15%' })])).toHaveLength(1);
  });

  it('el IVA en blanco es válido: lo pone la company', () => {
    expect(problemasDelLoteDePrecios([precio({ ivaCompra: null })])).toEqual([]);
  });

  /**
   * Es el caso que distingue esta validación de una comparación por nombre a
   * secas: un mismo ítem con dos artículos de compra tiene DOS precios a la vez,
   * y eso es correcto — cada presentación cuesta lo suyo.
   */
  it('el mismo ítem con dos artículos distintos son dos precios legítimos', () => {
    const problemas = problemasDelLoteDePrecios([
      precio({ articulo: 'Tomate caja 10 kg' }),
      precio({ articulo: 'Tomate funda 1 kg' }),
    ]);

    expect(problemas).toEqual([]);
  });

  it('el mismo par ítem-artículo dos veces sí es un problema', () => {
    const problemas = problemasDelLoteDePrecios([precio(), precio()]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/ya trae precio en la posición 1/u);
  });

  it('una preparación sin artículo también se compara consigo misma', () => {
    const problemas = problemasDelLoteDePrecios([
      precio({ item: 'Salsa criolla', articulo: null }),
      precio({ item: 'salsa criolla ', articulo: null }),
    ]);

    expect(problemas).toHaveLength(1);
  });

  it('una fila sin ítem se rechaza', () => {
    expect(problemasDelLoteDePrecios([precio({ item: '   ' })])).toHaveLength(1);
  });
});
