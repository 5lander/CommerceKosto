/**
 * El semáforo por bandas, en sus bordes.
 *
 * Los bordes son la prueba que importa: INC-020 fue un semáforo que acertaba en
 * el medio y fallaba cuando los decimales tenían distinta longitud a los dos
 * lados. Por eso hay casos con `0.2799`, `0.28000000001` y `0.1673`.
 */

import { describe, expect, it } from 'vitest';

import { Ratio } from '../money/tipos-monetarios';
import { semaforoPorBandas } from './semaforo';

const VERDE = Ratio.fromDecimalString('0.28');
const ROJO = Ratio.fromDecimalString('0.32');

function color(valor: string | null): string {
  return semaforoPorBandas({
    valor: valor === null ? null : Ratio.fromDecimalString(valor),
    verde: VERDE,
    rojo: ROJO,
  });
}

describe('semáforo por bandas', () => {
  it('por debajo del umbral verde es verde, aunque tenga más decimales que el umbral (INC-020)', () => {
    expect(color('0.1673')).toBe('VERDE');
    expect(color('0.2799')).toBe('VERDE');
  });

  it('exactamente en el umbral verde es verde: el borde es del lado bueno', () => {
    expect(color('0.28')).toBe('VERDE');
    expect(color('0.280000000000')).toBe('VERDE');
  });

  it('un pelo por encima del verde ya es ámbar', () => {
    expect(color('0.28000000001')).toBe('AMBAR');
  });

  it('exactamente en el máximo es ámbar: «máximo aceptable» incluye al máximo', () => {
    expect(color('0.32')).toBe('AMBAR');
  });

  it('por encima del máximo es rojo, también con un decimal de distinta longitud', () => {
    expect(color('0.3201')).toBe('ROJO');
    expect(color('0.4')).toBe('ROJO');
  });

  it('sin valor es SIN_DATO, nunca verde', () => {
    expect(color(null)).toBe('SIN_DATO');
  });
});
