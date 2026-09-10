/**
 * El desglose de una compra, con la base apagada.
 *
 * Los números son los de CC-IVA-01..03: la fórmula ya está probada en
 * `shared/domain/iva/neteo.spec.ts`; aquí se comprueba que los cuatro importes
 * nacen juntos y con la forma que el libro persiste.
 */

import { describe, expect, it } from 'vitest';

import { movementId } from '../../../shared/domain/identity/identificadores';
import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { desglosarCompra, exigirDesgloseEnCompra, type FilaDelLibroPorEscribir } from './compra';
import { CompraConImporteInvalidoError, CompraSinDesgloseError } from './errores';

const QUINCE = Ratio.fromDecimalString('0.15');

describe('desglosarCompra (D-16.10)', () => {
  it('con IVA recuperable, total_cost es el neto y el bruto queda al lado', () => {
    const compra = desglosarCompra({ bruto: '115.00', tarifa: QUINCE, recuperable: true });

    expect(compra.costoTotal).toBe('100.000000000000');
    expect(compra.desglose).toEqual({
      totalBruto: '115.000000000000',
      ivaTarifaAplicada: '0.150000000000',
      ivaRecuperableAplicado: true,
    });
  });

  it('sin IVA recuperable, total_cost ES el bruto y la foto lo dice', () => {
    const compra = desglosarCompra({ bruto: '115.00', tarifa: QUINCE, recuperable: false });

    expect(compra.costoTotal).toBe('115.000000000000');
    expect(compra.desglose.ivaRecuperableAplicado).toBe(false);
  });

  it('un bruto negativo no es una factura: se rechaza en el dominio, no en la base', () => {
    expect(() => desglosarCompra({ bruto: '-1', tarifa: QUINCE, recuperable: true })).toThrow(
      CompraConImporteInvalidoError,
    );
  });
});

describe('exigirDesgloseEnCompra (D-16.25): toda COMPRA nueva nace con desglose', () => {
  const desglose = desglosarCompra({ bruto: '115.00', tarifa: QUINCE, recuperable: true }).desglose;
  const escribir = (fila: FilaDelLibroPorEscribir) => (): void => {
    exigirDesgloseEnCompra(fila);
  };

  it('una COMPRA con desglose pasa', () => {
    expect(escribir({ tipo: 'COMPRA', desglose, reversesMovementId: null })).not.toThrow();
  });

  /**
   * La base no puede pararla: «sin desglose» es también el estado legítimo de
   * las compras anteriores a P16-A1. Esta es la guarda que sí la distingue.
   */
  it('una COMPRA nueva sin desglose se rechaza antes de tocar el libro', () => {
    expect(escribir({ tipo: 'COMPRA', desglose: null, reversesMovementId: null })).toThrow(
      CompraSinDesgloseError,
    );
  });

  it('lo que no es COMPRA nunca lleva desglose, y pasa', () => {
    expect(escribir({ tipo: 'MERMA', desglose: null, reversesMovementId: null })).not.toThrow();
  });

  it('la corrección de una compra anterior a P16-A1 copia «nada», y se admite', () => {
    expect(
      escribir({
        tipo: 'COMPRA',
        desglose: null,
        reversesMovementId: movementId('0199a9f0-0000-7000-8000-000000000001'),
      }),
    ).not.toThrow();
  });
});
