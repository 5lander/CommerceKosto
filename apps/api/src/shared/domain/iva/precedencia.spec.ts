/**
 * CC-IVA-04 y la ausencia de valor por defecto, con la base apagada.
 */

import { describe, expect, it } from 'vitest';

import { TarifaDeIvaInvalidaError } from './errores';
import { elegirTarifa } from './precedencia';
import { exigirTarifaValida, motivoDeTarifaInvalida } from './tarifa';

describe('elegirTarifa — cuerpo > artículo > grupo (D-16.9)', () => {
  it('CC-IVA-04: el cuerpo (0.08) manda sobre el artículo (0.15)', () => {
    expect(elegirTarifa({ cuerpo: '0.08', articulo: '0.15', grupo: '0.12' })).toBe('0.08');
  });

  it('sin cuerpo, manda el artículo sobre el grupo', () => {
    expect(elegirTarifa({ cuerpo: null, articulo: '0.15', grupo: '0.12' })).toBe('0.15');
  });

  it('sin cuerpo ni artículo, queda el grupo', () => {
    expect(elegirTarifa({ cuerpo: null, articulo: null, grupo: '0.12' })).toBe('0.12');
  });

  it('sin ninguno, NO hay tarifa: nunca se asume 0.15', () => {
    expect(elegirTarifa({ cuerpo: null, articulo: null, grupo: null })).toBeNull();
  });

  it('un cero explícito es una tarifa, no una ausencia', () => {
    expect(elegirTarifa({ cuerpo: '0', articulo: '0.15', grupo: null })).toBe('0');
  });
});

describe('exigirTarifaValida — una tarifa es una fracción', () => {
  it('acepta los bordes 0 y 1 y lo que hay entre medias', () => {
    expect(exigirTarifaValida('0').isZero()).toBe(true);
    expect(exigirTarifaValida('1').toExactString()).toBe('1');
    expect(exigirTarifaValida('0.15').toExactString()).toBe('0.15');
  });

  it('rechaza 15 donde va 0.15, diciéndolo', () => {
    expect(() => exigirTarifaValida('15')).toThrow(TarifaDeIvaInvalidaError);
    expect(() => exigirTarifaValida('15')).toThrow('0.15, no 15');
  });

  it('rechaza una tarifa negativa', () => {
    expect(() => exigirTarifaValida('-0.1')).toThrow(TarifaDeIvaInvalidaError);
  });
});

describe('motivoDeTarifaInvalida — la misma regla, como motivo con fila (D-16.44)', () => {
  it('una fracción válida no tiene motivo', () => {
    expect(motivoDeTarifaInvalida('0')).toBeNull();
    expect(motivoDeTarifaInvalida('0.15')).toBeNull();
    expect(motivoDeTarifaInvalida('1')).toBeNull();
  });

  it('15 donde va 0.15 devuelve el motivo que dice cómo se escribe', () => {
    expect(motivoDeTarifaInvalida('15')).toMatch(/0\.15, no 15/u);
  });

  it('lo que no es un número lo dice, sin construir el Ratio', () => {
    expect(motivoDeTarifaInvalida('15%')).toMatch(/no es un número/u);
    expect(motivoDeTarifaInvalida('-0.1')).toMatch(/no es un número/u);
  });
});
