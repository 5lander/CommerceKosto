/**
 * D-16.51 — el IVA de compra de una preparación, con la base apagada.
 */

import { describe, expect, it } from 'vitest';

import { PreparacionConIvaError } from './errores';
import { TARIFA_DE_PREPARACION, motivoDeIvaEnPreparacion, tarifaDePreparacion } from './preparacion';

describe('el IVA de compra de una preparación es cero (R10, D-16.51)', () => {
  it('sin tarifa en el cuerpo, nace con cero: ni el grupo ni la company opinan', () => {
    expect(motivoDeIvaEnPreparacion(null)).toBeNull();
    expect(tarifaDePreparacion(null)).toBe(TARIFA_DE_PREPARACION);
  });

  it('un cero explícito, con los decimales que sea, es el mismo cero', () => {
    expect(motivoDeIvaEnPreparacion('0')).toBeNull();
    expect(motivoDeIvaEnPreparacion('0.00')).toBeNull();
    expect(tarifaDePreparacion('0.000')).toBe(TARIFA_DE_PREPARACION);
  });

  /**
   * El caso que costeaba mal en silencio: una salsa con 0.15 se netearía y su
   * costo estándar —ya neto— quedaría dividido entre 1.15.
   */
  it('cualquier tarifa distinta de cero se rechaza diciendo por qué', () => {
    expect(motivoDeIvaEnPreparacion('0.15')).toMatch(/R10/u);
    expect(() => tarifaDePreparacion('0.15')).toThrow(PreparacionConIvaError);
    expect(() => tarifaDePreparacion('0.15')).toThrow('llegó «0.15»');
  });
});
