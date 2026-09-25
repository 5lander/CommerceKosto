/**
 * El lote de productos y recetas — dominio puro, con la base apagada.
 */

import { describe, expect, it } from 'vitest';

import {
  problemasDelLoteDeProductos,
  problemasDelLoteDeRecetas,
  type LineaDelLote,
  type ProductoDelLote,
} from './lote';

function producto(parcial: Partial<ProductoDelLote> = {}): ProductoDelLote {
  return {
    nombre: 'Ceviche mixto',
    tipo: 'SIMPLE',
    categoria: 'Entradas',
    pvp: '13.50',
    rendimientoPorciones: '1',
    empaque: null,
    activo: true,
    ...parcial,
  };
}

function linea(parcial: Partial<LineaDelLote> = {}): LineaDelLote {
  return {
    producto: 'Ceviche mixto',
    componente: 'Camarón pelado',
    cantidad: '0.15',
    base: 'EP',
    ...parcial,
  };
}

describe('lote de productos', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDeProductos([producto()])).toEqual([]);
  });

  it('un producto activo sin PVP se rechaza', () => {
    const problemas = problemasDelLoteDeProductos([producto({ pvp: null, activo: true })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/necesita PVP/u);
  });

  it('un producto inactivo sin PVP es válido: todavía no se vende', () => {
    expect(problemasDelLoteDeProductos([producto({ pvp: null, activo: false })])).toEqual([]);
  });

  /**
   * `costo_por_porcion = costo_neto_lote / rendimiento` (SPEC §14). Un cero no
   * es un valor raro: es una división por cero en el corazón del costeo. Es la
   * misma división que ADR-011 §1 tuvo que añadir.
   */
  it('un rendimiento por lote de cero se rechaza, porque al costear se divide por él', () => {
    const problemas = problemasDelLoteDeProductos([producto({ rendimientoPorciones: '0' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/divide/u);
  });

  it('un cero escrito con decimales también es cero', () => {
    expect(problemasDelLoteDeProductos([producto({ rendimientoPorciones: '0.00' })])).toHaveLength(
      1,
    );
  });

  it('un rendimiento distinto de 1 es válido: once de 48 productos reales lo tienen', () => {
    expect(problemasDelLoteDeProductos([producto({ rendimientoPorciones: '185' })])).toEqual([]);
  });

  it('dos productos con el mismo nombre normalizado son uno repetido', () => {
    const problemas = problemasDelLoteDeProductos([
      producto({ nombre: 'Ceviche mixto' }),
      producto({ nombre: 'CEVICHE MIXTO ' }),
    ]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(2);
  });
});

describe('lote de recetas', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDeRecetas([linea(), linea({ componente: 'Limón' })])).toEqual([]);
  });

  it('una cantidad que no es número se rechaza con su posición', () => {
    const problemas = problemasDelLoteDeRecetas([linea(), linea({ cantidad: 'al gusto' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(2);
  });

  it('una línea con cantidad cero se rechaza: no consume nada', () => {
    expect(problemasDelLoteDeRecetas([linea({ cantidad: '0' })])).toHaveLength(1);
  });

  /**
   * Dos líneas del mismo ítem en el mismo producto no son un duplicado inocuo:
   * la base las aceptaría y el costo del plato saldría con el ingrediente
   * contado dos veces, que es un número plausible y equivocado.
   */
  it('el mismo componente dos veces en la misma receta se rechaza', () => {
    const problemas = problemasDelLoteDeRecetas([linea(), linea({ cantidad: '0.20' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/una sola línea/u);
  });

  it('el mismo componente en DOS productos distintos es correcto', () => {
    const problemas = problemasDelLoteDeRecetas([
      linea({ producto: 'Ceviche mixto' }),
      linea({ producto: 'Arroz marinero' }),
    ]);

    expect(problemas).toEqual([]);
  });

  it('una línea sin producto y otra sin componente se rechazan las dos', () => {
    const problemas = problemasDelLoteDeRecetas([
      linea({ producto: '  ' }),
      linea({ componente: '  ' }),
    ]);

    expect(problemas.map((p) => p.posicion)).toEqual([1, 2]);
  });
});
