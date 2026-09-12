import DecimalJsGlobal from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { DIVISION, MAXIMA, PRESENTACION, escalaDe, type Escala } from './escalas';
import {
  D,
  DivisionPorCeroError,
  EscalaExcedidaError,
  ValorDecimalInvalidoError,
  aCadenaFija,
  desdeCadena,
  dividir,
  redondear,
} from './nucleo';

const CERO_DECIMALES = escalaDe(0);

/** Atajo legible para las baterias de redondeo. */
function redondeaA(valor: string, escala: Escala): string {
  return redondear(new D(valor), escala).toFixed();
}

function divide(dividendo: string, divisor: string, escala: Escala): string {
  return dividir({ dividendo: new D(dividendo), divisor: new D(divisor), escala, contexto: 'prueba' }).toFixed();
}

describe('parseo de cadenas decimales', () => {
  it('acepta cadenas decimales literales', () => {
    expect(desdeCadena('0', 'prueba').toFixed()).toBe('0');
    expect(desdeCadena('12.34', 'prueba').toFixed()).toBe('12.34');
    expect(desdeCadena('-0.5', 'prueba').toFixed()).toBe('-0.5');
    expect(desdeCadena('0.000000000001', 'prueba').toFixed()).toBe('0.000000000001');
  });

  it.each([
    ['1e5', 'notacion exponencial'],
    ['.5', 'sin parte entera'],
    ['1.', 'punto colgando'],
    ['+1', 'signo mas explicito'],
    [' 1', 'espacio inicial'],
    ['1_000', 'separador de miles'],
    ['1,5', 'coma decimal'],
    ['NaN', 'no es un numero'],
    ['Infinity', 'infinito'],
    ['', 'cadena vacia'],
  ])('rechaza %s (%s)', (entrada) => {
    expect(() => desdeCadena(entrada, 'prueba')).toThrow(ValorDecimalInvalidoError);
  });

  it('nunca produce notacion exponencial al formatear', () => {
    expect(desdeCadena('0.000000000001', 'prueba').toFixed()).not.toContain('e');
    expect(new D('1000000000000000000').toFixed()).not.toContain('e');
  });

  /**
   * P16-A2: la guarda que separa «lo escribiste mal» de «el motor se paso».
   *
   * Una cadena con mas decimales de los que el sistema conserva llegaba antes
   * hasta el constructor y saltaba con `EscalaExcedidaError`, que es un `Error`
   * a secas: **500 `INTERNAL_ERROR`** por un dato que alguien tecleo. Ahora se
   * rechaza en la puerta, con el error de ENTRADA que si sabe explicarlo — y
   * `EscalaExcedidaError` se queda para lo que de verdad es: un desbordamiento
   * a mitad de calculo, que sigue siendo 500 y sigue yendo al log con su traza.
   */
  it('rechaza mas decimales de los que el sistema conserva, y como ENTRADA no como desbordamiento', () => {
    const excesivo = `0.${'1'.repeat(MAXIMA + 1)}`;

    expect(() => desdeCadena(excesivo, 'prueba')).toThrow(ValorDecimalInvalidoError);
    expect(() => desdeCadena(excesivo, 'prueba')).not.toThrow(EscalaExcedidaError);
  });

  it('el limite exacto pasa: son MAS decimales lo que se rechaza, no el maximo', () => {
    expect(desdeCadena(`0.${'1'.repeat(MAXIMA)}`, 'prueba').decimalPlaces()).toBe(MAXIMA);
  });
});

describe('redondeo: medio hacia arriba, como el ROUND() de Excel', () => {
  it('redondea el empate alejandose del cero', () => {
    expect(redondeaA('2.675', PRESENTACION)).toBe('2.68');
    expect(redondeaA('0.125', PRESENTACION)).toBe('0.13');
    expect(redondeaA('2.5', CERO_DECIMALES)).toBe('3');
    expect(redondeaA('-2.5', CERO_DECIMALES)).toBe('-3');
    expect(redondeaA('-0.125', PRESENTACION)).toBe('-0.13');
  });

  it('NO es banker’s rounding — estos son los casos que discriminan', () => {
    // Con banker's rounding (half-to-even) darian 0.12 y 2 respectivamente.
    expect(redondeaA('0.125', PRESENTACION)).toBe('0.13');
    expect(redondeaA('2.5', CERO_DECIMALES)).toBe('3');
    expect(redondeaA('0.135', PRESENTACION)).toBe('0.14');
  });

  it('rellena en vez de redondear cuando la escala pedida es mayor', () => {
    expect(aCadenaFija(new D('1.5'), PRESENTACION)).toBe('1.50');
    expect(redondeaA('1.5', DIVISION)).toBe('1.5');
  });

  it('es idempotente', () => {
    const unaVez = redondear(new D('2.675'), PRESENTACION);
    const dosVeces = redondear(unaVez, PRESENTACION);
    expect(dosVeces.toFixed()).toBe(unaVez.toFixed());
  });
});

describe('division', () => {
  it('produce el numero de decimales pedido', () => {
    expect(divide('1', '3', DIVISION)).toBe('0.333333333333');
    expect(divide('2', '3', DIVISION)).toBe('0.666666666667');
  });

  it('lanza un error de dominio al dividir por cero, nunca NaN ni Infinity', () => {
    expect(() => divide('1', '0', DIVISION)).toThrow(DivisionPorCeroError);
    expect(() => divide('0', '0', DIVISION)).toThrow(DivisionPorCeroError);
  });

  it('el mensaje del error dice donde va el guard', () => {
    expect(() => dividir({ dividendo: new D('1'), divisor: new D('0'), escala: DIVISION, contexto: 'costo_por_porcion' })).toThrow(
      /costo_por_porcion/,
    );
  });
});

describe('aislamiento frente a la configuracion global de decimal.js', () => {
  it('un Decimal.set() global NO altera los resultados de este nucleo', () => {
    const antes = divide('1', '3', DIVISION);
    const redondeoAntes = redondeaA('0.125', PRESENTACION);

    const configuracionOriginal = {
      precision: DecimalJsGlobal.precision,
      rounding: DecimalJsGlobal.rounding,
    };

    try {
      // Lo peor que podria hacer otro modulo, o una dependencia transitiva:
      // bajar la precision a la minima y cambiar a banker's rounding.
      DecimalJsGlobal.set({ precision: 5, rounding: DecimalJsGlobal.ROUND_HALF_EVEN });

      expect(divide('1', '3', DIVISION)).toBe(antes);
      expect(redondeaA('0.125', PRESENTACION)).toBe(redondeoAntes);
      expect(redondeaA('0.125', PRESENTACION)).toBe('0.13');
    } finally {
      DecimalJsGlobal.set(configuracionOriginal);
    }
  });

  it('el constructor clonado es distinto del global', () => {
    expect(D).not.toBe(DecimalJsGlobal);
  });
});
