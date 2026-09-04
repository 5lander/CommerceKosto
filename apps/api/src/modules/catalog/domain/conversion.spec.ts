/**
 * El criterio de aceptación de P2, probado con la base apagada.
 *
 * «Una conversión inválida (kg → unidades sin factor) se rechaza en el
 * dominio». Está en el primer `describe`.
 */

import { describe, expect, it } from 'vitest';

import { Quantity, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import {
  ConversionInvalidaError,
  factorDeConversion,
  mensajeDelProblemaDeConversion,
  problemaDeConversion,
  type EntradaDeConversion,
  type ProblemaDeConversion,
  type UnidadDelCatalogo,
} from './conversion';

const G: UnidadDelCatalogo = {
  codigo: unidadDeUso('g'),
  dimension: 'MASA',
  factorABase: Ratio.fromDecimalString('1'),
};
const KG: UnidadDelCatalogo = {
  codigo: unidadDeUso('kg'),
  dimension: 'MASA',
  factorABase: Ratio.fromDecimalString('1000'),
};
const ML: UnidadDelCatalogo = {
  codigo: unidadDeUso('ml'),
  dimension: 'VOLUMEN',
  factorABase: Ratio.fromDecimalString('1'),
};
const LT: UnidadDelCatalogo = {
  codigo: unidadDeUso('lt'),
  dimension: 'VOLUMEN',
  factorABase: Ratio.fromDecimalString('1000'),
};
const UNID: UnidadDelCatalogo = {
  codigo: unidadDeUso('unid'),
  dimension: 'CONTEO',
  factorABase: Ratio.fromDecimalString('1'),
};

function entrada(cambios: Partial<EntradaDeConversion> = {}): EntradaDeConversion {
  return {
    presentacion: Quantity.of('2', KG.codigo),
    unidadDeCompra: KG,
    unidadDeUso: G,
    factorExplicito: null,
    ...cambios,
  };
}

describe('factor de conversión', () => {
  describe('el criterio de aceptación de P2', () => {
    it('kg → unidades SIN factor se rechaza, y el error dice por qué', () => {
      const invalida = entrada({ unidadDeUso: UNID });

      expect(problemaDeConversion(invalida)).toEqual({
        clase: 'falta_factor',
        compra: 'kg',
        uso: 'unid',
      });
      expect(() => factorDeConversion(invalida)).toThrow(ConversionInvalidaError);
    });

    it('kg → unidades CON factor sí se acepta', () => {
      // Un saco de 2 kg de bollos, y cada kilo trae 8 bollos: 16 bollos.
      const factor = factorDeConversion(
        entrada({ unidadDeUso: UNID, factorExplicito: Ratio.fromDecimalString('8') }),
      );

      expect(factor.toExactString()).toBe('16');
    });
  });

  describe('misma dimensión: el factor se deriva', () => {
    it('2 kg medidos en gramos son 2000', () => {
      expect(factorDeConversion(entrada()).toExactString()).toBe('2000');
    });

    it('900 ml medidos en litros son 0.9', () => {
      const factor = factorDeConversion(
        entrada({
          presentacion: Quantity.of('900', ML.codigo),
          unidadDeCompra: ML,
          unidadDeUso: LT,
        }),
      );

      expect(factor.toExactString()).toBe('0.9');
    });

    it('la misma unidad a ambos lados da exactamente la presentación', () => {
      const factor = factorDeConversion(
        entrada({ presentacion: Quantity.of('750', G.codigo), unidadDeCompra: G, unidadDeUso: G }),
      );

      expect(factor.toExactString()).toBe('750');
    });
  });

  describe('un factor que se puede calcular no se captura', () => {
    it('darlo cuando es derivable es un ERROR, no una preferencia', () => {
      // Un saco de 2 kg con "factor 1500" a mano produce un costo por gramo un
      // 33 % más alto, y el número es plausible: nada en la pantalla lo delata.
      const conflictiva = entrada({ factorExplicito: Ratio.fromDecimalString('1500') });

      expect(problemaDeConversion(conflictiva)).toEqual({
        clase: 'factor_de_mas',
        compra: 'kg',
        uso: 'g',
      });
    });

    it('ni siquiera si coincide con el que se habría calculado', () => {
      // Aceptarlo "porque da igual" convierte la regla en algo que a veces
      // aplica, y una regla así no se puede razonar.
      const redundante = entrada({ factorExplicito: Ratio.fromDecimalString('1000') });

      expect(problemaDeConversion(redundante)).not.toBeNull();
    });
  });

  describe('valores que no tienen sentido', () => {
    it('presentación cero', () => {
      expect(problemaDeConversion(entrada({ presentacion: Quantity.of('0', KG.codigo) }))).toEqual({
        clase: 'presentacion_no_positiva',
      });
    });

    it('presentación negativa', () => {
      expect(problemaDeConversion(entrada({ presentacion: Quantity.of('-2', KG.codigo) }))).toEqual({
        clase: 'presentacion_no_positiva',
      });
    });

    it('factor explícito cero: sería una división por cero disfrazada', () => {
      expect(
        problemaDeConversion(
          entrada({ unidadDeUso: UNID, factorExplicito: Ratio.fromDecimalString('0') }),
        ),
      ).toEqual({ clase: 'factor_no_positivo' });
    });

    it('la presentación viene en una unidad que no es la de compra', () => {
      expect(problemaDeConversion(entrada({ presentacion: Quantity.of('2', G.codigo) }))).toEqual({
        clase: 'presentacion_en_otra_unidad',
        esperada: 'kg',
        recibida: 'g',
      });
    });

    it('la unidad se comprueba ANTES que el signo: el diagnóstico útil primero', () => {
      const doblemente = entrada({ presentacion: Quantity.of('-2', G.codigo) });

      expect(problemaDeConversion(doblemente)).toMatchObject({
        clase: 'presentacion_en_otra_unidad',
      });
    });
  });

  describe('exactitud decimal', () => {
    it('una libra en gramos no pierde dígitos', () => {
      const lb: UnidadDelCatalogo = {
        codigo: unidadDeUso('lb'),
        dimension: 'MASA',
        factorABase: Ratio.fromDecimalString('453.59237'),
      };

      const factor = factorDeConversion(
        entrada({ presentacion: Quantity.of('3', lb.codigo), unidadDeCompra: lb, unidadDeUso: G }),
      );

      // 3 × 453.59237 = 1360.77711, exacto. Con punto flotante saldría
      // 1360.7771099999999.
      expect(factor.toExactString()).toBe('1360.77711');
    });
  });

  it('todo problema tiene mensaje, y el mensaje nombra las unidades', () => {
    const clases: ProblemaDeConversion['clase'][] = [
      'falta_factor',
      'factor_de_mas',
      'factor_no_positivo',
      'presentacion_no_positiva',
      'presentacion_en_otra_unidad',
    ];

    for (const clase of clases) {
      const problema =
        clase === 'falta_factor' || clase === 'factor_de_mas'
          ? ({ clase, compra: 'kg', uso: 'unid' } as ProblemaDeConversion)
          : clase === 'presentacion_en_otra_unidad'
            ? ({ clase, esperada: 'kg', recibida: 'g' } as ProblemaDeConversion)
            : ({ clase } as ProblemaDeConversion);

      expect(mensajeDelProblemaDeConversion(problema).length).toBeGreaterThan(0);
    }

    expect(
      mensajeDelProblemaDeConversion({ clase: 'falta_factor', compra: 'kg', uso: 'unid' }),
    ).toContain('unid');
  });
});
