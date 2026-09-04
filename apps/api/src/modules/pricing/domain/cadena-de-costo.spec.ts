/**
 * La cadena de costo del insumo, probada con la base apagada.
 *
 * Los casos llevan números **calculados a mano** y verificables de cabeza: un
 * saco de 2 kg a 2.30 con IVA del 15 %, medido en gramos, con rendimiento 0.8.
 * Si alguna cifra de aquí cambia sin que cambie el SPEC, es un fallo.
 */

import { describe, expect, it } from 'vitest';

import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { costoDelItem, type EntradaDeCostoDeItem } from './cadena-de-costo';

/** Un saco de harina de 2 kg a 2.30, usado en gramos, que no pierde nada. */
function entrada(cambios: Partial<EntradaDeCostoDeItem> = {}): EntradaDeCostoDeItem {
  return {
    precioDeCompra: Money.fromDecimalString('2.30'),
    ivaCompra: Ratio.fromDecimalString('0.15'),
    ivaRecuperable: true,
    factorDeConversion: Ratio.fromDecimalString('2000'),
    rendimiento: Ratio.UNO,
    ...cambios,
  };
}

describe('cadena de costo del insumo (SPEC §12)', () => {
  describe('el IVA recuperable no es costo (R13)', () => {
    it('con IVA recuperable, el precio neto es el precio entre 1.15', () => {
      const { precioNeto } = costoDelItem(entrada());

      // 2.30 / 1.15 = 2 exacto.
      expect(precioNeto.toDisplayString()).toBe('2.00');
    });

    it('sin IVA recuperable, el precio neto ES el precio pagado', () => {
      const { precioNeto } = costoDelItem(entrada({ ivaRecuperable: false }));

      expect(precioNeto.toDisplayString()).toBe('2.30');
    });

    it('EL CRITERIO E20: sin recuperar, el costo sube EXACTAMENTE el IVA', () => {
      const recupera = costoDelItem(entrada());
      const noRecupera = costoDelItem(entrada({ ivaRecuperable: false }));

      const subida = noRecupera.costoNetoDeUso.ratioTo(recupera.costoNetoDeUso);

      // 1.15, ni un dígito más. Es la comprobación de que el IVA entra una sola
      // vez y en un solo sitio.
      expect(subida.toExactString()).toBe('1.15');
    });

    it('con IVA cero, recuperar o no da lo mismo', () => {
      const sinIva = { ivaCompra: Ratio.CERO };

      expect(costoDelItem(entrada(sinIva)).precioNeto.toExactString()).toBe(
        costoDelItem(entrada({ ...sinIva, ivaRecuperable: false })).precioNeto.toExactString(),
      );
    });
  });

  describe('el factor de conversión lleva el precio a la unidad de uso', () => {
    it('2 pagados entre 2000 gramos es 0.001 por gramo', () => {
      const { costoBrutoDeUso } = costoDelItem(entrada());

      expect(costoBrutoDeUso.toExactString()).toBe('0.001');
    });
  });

  describe('dividir por el rendimiento ENCARECE', () => {
    it('con rendimiento 0.8, el gramo aprovechable cuesta un 25 % más', () => {
      const { costoBrutoDeUso, costoNetoDeUso } = costoDelItem(
        entrada({ rendimiento: Ratio.fromDecimalString('0.8') }),
      );

      // 0.001 / 0.8 = 0.00125. Cada gramo aprovechable cuesta lo de 1.25
      // gramos comprados.
      expect(costoNetoDeUso.toExactString()).toBe('0.00125');
      expect(costoNetoDeUso.greaterThan(costoBrutoDeUso)).toBe(true);
    });

    it('el sobrecosto de merma es exactamente la diferencia', () => {
      const { costoBrutoDeUso, costoNetoDeUso, sobrecostoDeMerma } = costoDelItem(
        entrada({ rendimiento: Ratio.fromDecimalString('0.8') }),
      );

      expect(sobrecostoDeMerma.toExactString()).toBe(
        costoNetoDeUso.minus(costoBrutoDeUso).toExactString(),
      );
      expect(sobrecostoDeMerma.isPositive()).toBe(true);
    });

    it('con rendimiento 1 no hay sobrecosto: no se pierde nada al limpiar', () => {
      const { sobrecostoDeMerma, costoBrutoDeUso, costoNetoDeUso } = costoDelItem(entrada());

      expect(sobrecostoDeMerma.isZero()).toBe(true);
      expect(costoNetoDeUso.equals(costoBrutoDeUso)).toBe(true);
    });
  });

  describe('las dos guardas de cero del SPEC', () => {
    it('factor de conversión cero da CERO, no NaN ni una excepción', () => {
      const resultado = costoDelItem(entrada({ factorDeConversion: Ratio.CERO }));

      expect(resultado.costoBrutoDeUso.isZero()).toBe(true);
      expect(resultado.costoNetoDeUso.isZero()).toBe(true);
      expect(resultado.sobrecostoDeMerma.isZero()).toBe(true);
    });

    it('rendimiento cero da CERO en el costo neto', () => {
      const resultado = costoDelItem(entrada({ rendimiento: Ratio.CERO }));

      expect(resultado.costoNetoDeUso.isZero()).toBe(true);
      // El bruto SÍ se calcula: lo que falta es el rendimiento, no el precio.
      expect(resultado.costoBrutoDeUso.toExactString()).toBe('0.001');
    });

    it('las dos guardas a la vez tampoco lanzan', () => {
      expect(() =>
        costoDelItem(entrada({ factorDeConversion: Ratio.CERO, rendimiento: Ratio.CERO })),
      ).not.toThrow();
    });
  });

  describe('exactitud decimal', () => {
    it('un precio que no divide exacto no pierde dígitos por el camino', () => {
      // 1 / 3 = 0.333333333333 a doce decimales, la escala de división.
      const { precioNeto } = costoDelItem(
        entrada({ precioDeCompra: Money.fromDecimalString('1'), ivaCompra: Ratio.fromDecimalString('2') }),
      );

      expect(precioNeto.toExactString()).toBe('0.333333333333');
    });

    it('mil ítems idénticos suman lo mismo sumados que multiplicados', () => {
      // El control con punto flotante derivaría: 0.001 no es representable en
      // binario, y mil sumas acumulan el error. Aquí no.
      const { costoNetoDeUso } = costoDelItem(entrada());
      const mil = Array.from({ length: 1000 }, () => costoNetoDeUso);

      expect(Money.sum(mil).toExactString()).toBe('1');
    });
  });
});
