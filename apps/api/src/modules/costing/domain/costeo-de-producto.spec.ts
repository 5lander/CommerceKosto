/**
 * «Sin receta» — duda #12, cerrada por el usuario con la opción (a).
 *
 * **UN COSTO CERO QUE NO VIENE DE NINGUNA LÍNEA NO ES UN COSTO: ES QUE FALTA LA
 * RECETA.** El motor ya lo calculaba bien —sin líneas activas, el lote cuesta
 * cero, que es aritméticamente cierto— y lo que faltaba era decirlo: la dueña
 * miraba la bodega y leía «Arroz marinero 0.00 · 0.00 · 0.00», un número
 * plausible sobre el que se decide un precio. Es la misma regla que «sin
 * contar» no es cero (D7).
 */

import { describe, expect, it } from 'vitest';

import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { sinRecetaActiva, type LineaParaCostear } from './costeo-de-producto';

const COSTOS = { costoBrutoDeUso: Money.fromDecimalString('2.00'), costoNetoDeUso: Money.fromDecimalString('2.50') };

function linea(estado: LineaParaCostear['estado']): LineaParaCostear {
  return { cantidad: Ratio.fromDecimalString('0.5'), base: 'EP', estado, costos: COSTOS };
}

describe('sinRecetaActiva', () => {
  it('sin líneas no hay receta', () => {
    expect(sinRecetaActiva([])).toBe(true);
  });

  it('con todas las líneas inactivas tampoco: nada suma al lote', () => {
    expect(sinRecetaActiva([linea('INACTIVA'), linea('INACTIVA')])).toBe(true);
  });

  it('con una sola línea activa sí la hay, aunque las demás estén inactivas', () => {
    expect(sinRecetaActiva([linea('INACTIVA'), linea('ACTIVA')])).toBe(false);
  });
});
