/**
 * R4 — la base AP/EP, con **ambos casos y resultados distintos y conocidos**.
 *
 * CLAUDE.md §7 la marca 🔴 y el SPEC la llama «la condicional más frágil del
 * modelo». Estas pruebas existen para que implementarla al revés no compile en
 * verde: los dos números son distintos, están calculados a mano, y una
 * implementación invertida los intercambia.
 */

import { describe, expect, it } from 'vitest';

import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import {
  costoDeLinea,
  participacionEnElProducto,
  type CostosDelItem,
  type EntradaDeLinea,
} from './linea-de-receta';

/**
 * Cebolla a 0.002 por gramo comprado, con rendimiento 0.8.
 *
 *   bruto = 0.002        lo que cuesta el gramo tal como se compra
 *   neto  = 0.0025       lo que cuesta el gramo APROVECHABLE (0.002 / 0.8)
 */
const CEBOLLA: CostosDelItem = {
  costoBrutoDeUso: Money.fromDecimalString('0.002'),
  costoNetoDeUso: Money.fromDecimalString('0.0025'),
};

function linea(cambios: Partial<EntradaDeLinea> = {}): EntradaDeLinea {
  return {
    cantidad: Ratio.fromDecimalString('200'),
    base: 'EP',
    estado: 'ACTIVA',
    costos: CEBOLLA,
    ...cambios,
  };
}

describe('costo de la línea de receta (SPEC §13, R4)', () => {
  describe('los dos casos, con resultados distintos y conocidos', () => {
    it('EP — 200 g ya limpios cuestan 0.50', () => {
      // 200 × 0.0025. La receta pide producto limpio, así que hay que comprar
      // más de 200 g y ese sobreprecio está en el costo neto.
      expect(costoDeLinea(linea({ base: 'EP' })).toDisplayString()).toBe('0.50');
    });

    it('AP — 200 g tal como se compran cuestan 0.40', () => {
      // 200 × 0.002. La merma se produce después y no la paga esta línea.
      expect(costoDeLinea(linea({ base: 'AP' })).toDisplayString()).toBe('0.40');
    });

    it('LOS DOS NÚMEROS SON DISTINTOS: una implementación invertida los cambia', () => {
      const ep = costoDeLinea(linea({ base: 'EP' }));
      const ap = costoDeLinea(linea({ base: 'AP' }));

      expect(ep.equals(ap)).toBe(false);
      // Y EP es el MAYOR de los dos: pedir producto limpio cuesta más.
      expect(ep.greaterThan(ap)).toBe(true);
    });
  });

  describe('sin merma los dos coinciden, y eso NO valida nada', () => {
    it('con rendimiento 1 el bruto y el neto son el mismo número', () => {
      // Es la trampa: probar solo con rendimiento 1 hace pasar cualquier
      // implementación, incluida la invertida. Por eso el caso principal usa
      // 0.8.
      const sinMerma: CostosDelItem = {
        costoBrutoDeUso: Money.fromDecimalString('0.002'),
        costoNetoDeUso: Money.fromDecimalString('0.002'),
      };

      expect(costoDeLinea(linea({ base: 'EP', costos: sinMerma })).toExactString()).toBe(
        costoDeLinea(linea({ base: 'AP', costos: sinMerma })).toExactString(),
      );
    });
  });

  describe('línea inactiva', () => {
    it('cuesta cero, sea cual sea la base', () => {
      expect(costoDeLinea(linea({ estado: 'INACTIVA', base: 'EP' })).isZero()).toBe(true);
      expect(costoDeLinea(linea({ estado: 'INACTIVA', base: 'AP' })).isZero()).toBe(true);
    });

    it('y no se borra: sigue en la receta con su cantidad', () => {
      // La fórmula del SPEC la contempla explícitamente; conservarla deja ver
      // qué se quitó y cuándo.
      expect(costoDeLinea(linea({ estado: 'INACTIVA' })).toDisplayString()).toBe('0.00');
    });
  });

  describe('cantidades', () => {
    it('acepta un Count entero', () => {
      expect(costoDeLinea(linea({ cantidad: Count.fromInteger(3), base: 'AP' })).toExactString()).toBe(
        '0.006',
      );
    });

    it('cantidad cero cuesta cero', () => {
      expect(costoDeLinea(linea({ cantidad: Ratio.CERO })).isZero()).toBe(true);
    });

    it('una cantidad decimal larga no pierde dígitos', () => {
      const resultado = costoDeLinea(
        linea({ cantidad: Ratio.fromDecimalString('333.333333'), base: 'AP' }),
      );

      // 333.333333 × 0.002 = 0.666666666, exacto.
      expect(resultado.toExactString()).toBe('0.666666666');
    });
  });

  describe('participación de la línea en el producto', () => {
    it('media línea de un producto de 1.00 es 0.5', () => {
      const participacion = participacionEnElProducto({
        costoDeLaLinea: Money.fromDecimalString('0.50'),
        costoDelProducto: Money.fromDecimalString('1.00'),
      });

      expect(participacion.toExactString()).toBe('0.5');
    });

    it('con producto a cero devuelve cero en vez de lanzar', () => {
      // Un producto cuyas líneas cuestan cero —porque aún no hay precios— tiene
      // que poder mostrarse.
      const participacion = participacionEnElProducto({
        costoDeLaLinea: Money.CERO,
        costoDelProducto: Money.CERO,
      });

      expect(participacion.isZero()).toBe(true);
    });
  });
});
