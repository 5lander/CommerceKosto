/**
 * El catálogo de unidades, con la base apagada.
 *
 * Lo que se fija aquí es la lección de INC-012: un código BIEN FORMADO que no
 * existe —`"l"` por `"lt"`— tiene que morir aquí, con la lista de válidas en el
 * mensaje, y no seis capas más abajo en una clave foránea.
 */

import { describe, expect, it } from 'vitest';

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { buscarUnidad, exigirUnidad, mensajeDeUnidadDesconocida } from './catalogo-de-unidades';
import type { UnidadDelCatalogo } from './conversion';
import { EntradaDeCatalogoInvalidaError } from './errores';

const unidad = (codigo: string, factor: string): UnidadDelCatalogo => ({
  codigo: unidadDeUso(codigo),
  dimension: 'MASA',
  factorABase: Ratio.fromDecimalString(factor),
});

// Desordenado a posta: el mensaje tiene que ordenarlo él.
const CATALOGO: readonly UnidadDelCatalogo[] = [unidad('kg', '1000'), unidad('g', '1')];

describe('buscarUnidad', () => {
  it('encuentra la que está', () => {
    expect(buscarUnidad(CATALOGO, unidadDeUso('kg'))?.codigo).toBe('kg');
  });

  it('devuelve null y no lanza: quien valida un lote recoge todas las filas malas', () => {
    expect(buscarUnidad(CATALOGO, unidadDeUso('lt'))).toBeNull();
  });
});

describe('mensajeDeUnidadDesconocida', () => {
  it('enumera las válidas ordenadas, que es lo que hace falta para corregir', () => {
    expect(mensajeDeUnidadDesconocida(CATALOGO, 'l')).toBe(
      'La unidad "l" no está en el catálogo. Las válidas son: g, kg.',
    );
  });
});

describe('exigirUnidad', () => {
  it('devuelve la unidad cuando existe', () => {
    expect(exigirUnidad(CATALOGO, unidadDeUso('g')).dimension).toBe('MASA');
  });

  it('LO DE INC-012: "l" está bien formado y no existe, y eso es un 400', () => {
    expect(() => exigirUnidad(CATALOGO, unidadDeUso('l'))).toThrow(EntradaDeCatalogoInvalidaError);
  });

  it('el motivo dice cuáles sirven, no solo que esa no', () => {
    expect(() => exigirUnidad(CATALOGO, unidadDeUso('l'))).toThrow(/Las válidas son: g, kg\./u);
  });
});
