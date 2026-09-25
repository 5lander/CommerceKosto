/**
 * El lote de catálogo — dominio puro, con la base apagada.
 *
 * Lo que estas pruebas fijan es lo que distingue un lote de un alta suelta: que
 * se devuelven TODOS los problemas y no el primero, que la posición que se
 * enseña empieza en 1, y que dos nombres que la base aceptaría —porque compara
 * byte a byte— aquí son el mismo.
 */

import { describe, expect, it } from 'vitest';

import {
  problemasDelLoteDeArticulos,
  problemasDelLoteDeItems,
  type ArticuloDelLote,
  type ItemDelLote,
} from './lote';

function item(parcial: Partial<ItemDelLote> = {}): ItemDelLote {
  return {
    nombre: 'Tomate riñón',
    tipo: 'COMPRADO',
    unidadDeUso: 'kg',
    rendimiento: '0.9',
    grupo: 'Verduras',
    confianzaDePrecio: 'FACTURA',
    llevaStock: null,
    ...parcial,
  };
}

function articulo(parcial: Partial<ArticuloDelLote> = {}): ArticuloDelLote {
  return {
    item: 'Tomate riñón',
    nombre: 'Tomate caja 10 kg',
    marca: null,
    proveedor: null,
    presentacion: '10',
    unidadDePresentacion: 'kg',
    factorExplicito: null,
    ivaTarifa: null,
    ...parcial,
  };
}

describe('lote de ítems', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDeItems([item(), item({ nombre: 'Cebolla' })])).toEqual([]);
  });

  it('la primera fila del lote es la posición 1, no la 0', () => {
    const problemas = problemasDelLoteDeItems([item({ rendimiento: '2' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(1);
  });

  it('NO se detiene en el primer problema: los devuelve todos', () => {
    const problemas = problemasDelLoteDeItems([
      item({ rendimiento: '2' }),
      item({ nombre: 'Cebolla', unidadDeUso: 'KILOS' }),
      item({ nombre: 'Ajo', rendimiento: 'mucho' }),
    ]);

    expect(problemas.map((p) => p.posicion)).toEqual([1, 2, 3]);
  });

  it('un rendimiento mayor que 1 se rechaza, porque limpiar no crea materia', () => {
    const problemas = problemasDelLoteDeItems([item({ rendimiento: '1.2' })]);

    expect(problemas[0]?.motivo).toMatch(/entre 0 y 1/u);
  });

  it('un rendimiento que no es número se distingue de uno fuera de rango', () => {
    const problemas = problemasDelLoteDeItems([item({ rendimiento: 'N/A' })]);

    expect(problemas[0]?.motivo).toMatch(/no es un número/u);
  });

  /**
   * Es la comprobación que la base NO haría: su índice único compara byte a
   * byte, así que «Tomate riñón» y «tomate riñón » entrarían como dos ítems
   * distintos y nadie sabría después cuál de los dos usar.
   */
  it('dos nombres que solo difieren en espacios y mayúsculas son el mismo ítem', () => {
    const problemas = problemasDelLoteDeItems([
      item({ nombre: 'Tomate riñón' }),
      item({ nombre: '  TOMATE RIÑÓN  ' }),
    ]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(2);
    expect(problemas[0]?.motivo).toMatch(/ya aparece en la posición 1/u);
  });

  it('una fila repetida no se valida además por su contenido: sobra decirlo dos veces', () => {
    const problemas = problemasDelLoteDeItems([item(), item({ rendimiento: '9' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.motivo).toMatch(/ya aparece/u);
  });

  it('una preparación que no dice si lleva stock se rechaza', () => {
    const problemas = problemasDelLoteDeItems([item({ tipo: 'PRODUCIDO', llevaStock: null })]);

    expect(problemas).toHaveLength(1);
  });
});

describe('lote de artículos', () => {
  it('un lote bueno no tiene ni un problema', () => {
    expect(problemasDelLoteDeArticulos([articulo()])).toEqual([]);
  });

  it('un artículo sin ítem se rechaza con su posición', () => {
    const problemas = problemasDelLoteDeArticulos([articulo(), articulo({ item: '  ' })]);

    expect(problemas).toHaveLength(1);
    expect(problemas[0]?.posicion).toBe(2);
  });

  it('una presentación que no es número se rechaza', () => {
    const problemas = problemasDelLoteDeArticulos([articulo({ presentacion: 'una caja' })]);

    expect(problemas[0]?.motivo).toMatch(/no es un número/u);
  });

  it('un factor explícito que no es número se rechaza', () => {
    const problemas = problemasDelLoteDeArticulos([articulo({ factorExplicito: 'x' })]);

    expect(problemas[0]?.motivo).toMatch(/factor de conversión/u);
  });

  /**
   * El factor NO se valida aquí a propósito: necesita el catálogo de unidades y
   * la unidad de uso del ítem. Lo hace el caso de uso, y por eso una unidad que
   * es un código válido pero no está en el catálogo pasa esta función.
   */
  it('una unidad bien formada pasa aunque no exista en el catálogo', () => {
    expect(problemasDelLoteDeArticulos([articulo({ unidadDePresentacion: 'quintal' })])).toEqual([]);
  });
});

describe('la tarifa de IVA del artículo (D-16.44)', () => {
  it('un 15 donde va 0.15 se rechaza con su posición, junto a los demás problemas', () => {
    const problemas = problemasDelLoteDeArticulos([
      articulo(),
      articulo({ nombre: 'Tomate funda', ivaTarifa: '15' }),
      articulo({ nombre: 'Tomate malla', presentacion: 'x' }),
    ]);

    expect(problemas.map((p) => p.posicion)).toEqual([2, 3]);
    expect(problemas[0]?.motivo).toMatch(/0\.15, no 15/u);
  });

  it('el blanco pasa: la tarifa la pondrá el grupo, o la fila se rechazará en el caso de uso', () => {
    expect(problemasDelLoteDeArticulos([articulo({ ivaTarifa: null })])).toEqual([]);
  });
});
