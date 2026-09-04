import { describe, expect, it } from 'vitest';

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import {
  LARGO_MAXIMO_DE_NOMBRE,
  mensajeDelProblemaDeItem,
  problemaDeItem,
  type DatosDeItem,
  type ProblemaDeItem,
} from './item';

function item(cambios: Partial<DatosDeItem> = {}): DatosDeItem {
  return {
    nombre: 'Cebolla perla',
    tipo: 'COMPRADO',
    rendimiento: Ratio.fromDecimalString('0.85'),
    llevaStock: null,
    ...cambios,
  };
}

describe('reglas del ítem', () => {
  it('un ítem comprado corriente es válido', () => {
    expect(problemaDeItem(item())).toBeNull();
  });

  it('una preparación con stock declarado es válida', () => {
    expect(problemaDeItem(item({ tipo: 'PRODUCIDO', llevaStock: true }))).toBeNull();
  });

  describe('nombre', () => {
    it('vacío se rechaza', () => {
      expect(problemaDeItem(item({ nombre: '   ' }))).toEqual({ clase: 'nombre_vacio' });
    });

    it('el largo se mide DESPUÉS de recortar los bordes', () => {
      const justo = `  ${'a'.repeat(LARGO_MAXIMO_DE_NOMBRE)}  `;

      expect(problemaDeItem(item({ nombre: justo }))).toBeNull();
    });

    it('uno más y se rechaza', () => {
      expect(problemaDeItem(item({ nombre: 'a'.repeat(LARGO_MAXIMO_DE_NOMBRE + 1) }))).toEqual({
        clase: 'nombre_largo',
        maximo: LARGO_MAXIMO_DE_NOMBRE,
      });
    });
  });

  describe('rendimiento', () => {
    it('1 es válido: no se pierde nada al limpiar', () => {
      expect(problemaDeItem(item({ rendimiento: Ratio.UNO }))).toBeNull();
    });

    it('0 es válido: SPEC §12 lo trata como guarda explícita', () => {
      expect(problemaDeItem(item({ rendimiento: Ratio.CERO }))).toBeNull();
    });

    it('mayor que 1 se rechaza: limpiar no crea materia', () => {
      // Con 1.2 el ítem saldría más barato que su precio de compra, y el número
      // es plausible en pantalla.
      expect(problemaDeItem(item({ rendimiento: Ratio.fromDecimalString('1.2') }))).toEqual({
        clase: 'rendimiento_fuera_de_rango',
      });
    });

    it('negativo se rechaza', () => {
      expect(problemaDeItem(item({ rendimiento: Ratio.fromDecimalString('-0.1') }))).toEqual({
        clase: 'rendimiento_fuera_de_rango',
      });
    });
  });

  describe('el interruptor de stock es solo de las preparaciones', () => {
    it('una preparación sin decidirlo se rechaza', () => {
      expect(problemaDeItem(item({ tipo: 'PRODUCIDO', llevaStock: null }))).toEqual({
        clase: 'producido_sin_decidir_stock',
      });
    });

    it('un comprado que lo decide se rechaza', () => {
      expect(problemaDeItem(item({ tipo: 'COMPRADO', llevaStock: false }))).toEqual({
        clase: 'stock_solo_en_producido',
      });
    });
  });

  it('todo problema tiene mensaje', () => {
    const clases: ProblemaDeItem['clase'][] = [
      'nombre_vacio',
      'nombre_largo',
      'rendimiento_fuera_de_rango',
      'stock_solo_en_producido',
      'producido_sin_decidir_stock',
    ];

    for (const clase of clases) {
      const problema =
        clase === 'nombre_largo'
          ? ({ clase, maximo: LARGO_MAXIMO_DE_NOMBRE } as ProblemaDeItem)
          : ({ clase } as ProblemaDeItem);

      expect(mensajeDelProblemaDeItem(problema).length).toBeGreaterThan(0);
    }
  });
});
