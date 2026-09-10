/**
 * CC-IVA-01..03 de `docs/pruebas/casos-conocidos.md`, con la base apagada.
 *
 * Los resultados esperados están calculados a mano en el documento ANTES que
 * este código. Si alguna cifra cambia sin que cambie SPEC §12, es un fallo.
 */

import { describe, expect, it } from 'vitest';

import { Money, Ratio } from '../money/tipos-monetarios';
import { netear } from './neteo';

const FACTURA = Money.fromDecimalString('115.00');
const QUINCE = Ratio.fromDecimalString('0.15');

describe('netear — SPEC §12, primera línea (D-16.40)', () => {
  it('CC-IVA-01: recuperable, 115.00 al 15 % netea a 100.00', () => {
    const neto = netear({ bruto: FACTURA, tarifa: QUINCE, recuperable: true });

    expect(neto.toDisplayString()).toBe('100.00');
    expect(neto.toExactString()).toBe('100');
  });

  it('CC-IVA-02: NO recuperable, el bruto entra íntegro al costo (R13)', () => {
    const neto = netear({ bruto: FACTURA, tarifa: QUINCE, recuperable: false });

    expect(neto.toExactString()).toBe('115');
  });

  it('CC-IVA-03: con tarifa 0, recuperar o no da lo mismo: el bruto', () => {
    const recupera = netear({ bruto: FACTURA, tarifa: Ratio.CERO, recuperable: true });
    const noRecupera = netear({ bruto: FACTURA, tarifa: Ratio.CERO, recuperable: false });

    expect(recupera.toExactString()).toBe('115');
    expect(noRecupera.toExactString()).toBe('115');
  });

  it('una división periódica sale a la escala DIVISION del proyecto', () => {
    // 10 / 1.15 = 8.695652173913…: doce decimales, ni uno más.
    const neto = netear({
      bruto: Money.fromDecimalString('10'),
      tarifa: QUINCE,
      recuperable: true,
    });

    expect(neto.toStorageString()).toBe('8.695652173913');
  });
});
