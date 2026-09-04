import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { DIVISION, PRESENTACION, escalaDe } from '../decimal/escalas';
import { DivisionPorCeroError, ValorDecimalInvalidoError } from '../decimal/nucleo';
import {
  ConteoInvalidoError,
  Count,
  ImporteCapturadoInvalidoError,
  Money,
  Ratio,
} from './tipos-monetarios';

/** Atajos legibles: las pruebas de este modulo construyen decenas de valores. */
const m = (valor: string): Money => Money.fromDecimalString(valor);
const r = (valor: string): Ratio => Ratio.fromDecimalString(valor);

describe('Money — construccion', () => {
  it('acepta cualquier escala en un valor derivado', () => {
    expect(m('0.4611078936').toExactString()).toBe('0.4611078936');
  });

  it('rechaza un importe tecleado con mas de dos decimales', () => {
    expect(() => Money.fromCapturedInput('12.345')).toThrow(ImporteCapturadoInvalidoError);
    expect(Money.fromCapturedInput('12.34').toExactString()).toBe('12.34');
  });

  it('rechaza cadenas que no son decimales literales', () => {
    expect(() => m('1e5')).toThrow(ValorDecimalInvalidoError);
  });

  it('hace ida y vuelta por el formato de la base sin perdida', () => {
    const original = m('3.582034005');
    expect(Money.fromDatabase(original.toStorageString()).equals(original)).toBe(true);
    expect(original.toStorageString()).toBe('3.582034005000');
  });
});

describe('Money — aritmetica exacta', () => {
  it('suma y resta sin redondear, con escalas distintas', () => {
    expect(m('1.5').plus(m('1.25')).toExactString()).toBe('2.75');
    expect(m('0.1').plus(m('0.2')).toExactString()).toBe('0.3');
    expect(m('1').minus(m('0.999999999999')).toExactString()).toBe('0.000000000001');
  });

  it('multiplica de forma exacta: la escala del resultado es la suma de escalas', () => {
    // 0.065 (escala 3) x 8.13 (escala 2) = 0.52845 (escala 5), sin redondeo.
    expect(m('0.065').times(r('8.13')).toExactString()).toBe('0.52845');
  });

  it('el orden de los sumandos no altera el total', () => {
    const valores = ['17.60647059', '59.7826087', '3.130434783', '0.00832', '0.012', '0.02576'].map(m);
    const ascendente = Money.sum(valores);
    const descendente = Money.sum([...valores].reverse());
    expect(descendente.equals(ascendente)).toBe(true);
  });

  it('el MISMO conjunto con punto flotante SI deriva segun el orden', () => {
    const crudos = [0.1, 0.2, 0.3, 1e-10, 1e10, -1e10];
    const izquierda = crudos.reduce((a, b) => a + b, 0);
    const derecha = [...crudos].reverse().reduce((a, b) => a + b, 0);
    expect(izquierda).not.toBe(derecha);
  });

  it('acumula 1500 lineas sin deriva', () => {
    const lineas = Array.from({ length: 1500 }, (_, indice) => m(`0.00${String((indice % 9) + 1)}`));
    const total = Money.sum(lineas);
    const barajado = Money.sum([...lineas].sort(() => (Math.random() < 0.5 ? -1 : 1)));
    expect(barajado.equals(total)).toBe(true);
  });

  it('Money.sum de una lista vacia es cero', () => {
    expect(Money.sum([]).isZero()).toBe(true);
  });

  it('no muta el receptor', () => {
    const original = m('10');
    original.plus(m('5'));
    expect(original.toExactString()).toBe('10');
  });
});

describe('Money — comparacion', () => {
  it('es insensible a la escala', () => {
    expect(m('1.50').equals(m('1.5'))).toBe(true);
    expect(m('1.50').compare(m('1.5'))).toBe(0);
  });

  it('ordena correctamente', () => {
    expect(m('1').compare(m('2'))).toBe(-1);
    expect(m('2').compare(m('1'))).toBe(1);
  });

  it('distingue cero de negativo', () => {
    expect(Money.CERO.isNegative()).toBe(false);
    expect(m('-0').isNegative()).toBe(false);
    expect(m('-0.01').isNegative()).toBe(true);
  });
});

describe('Money — division y bordes del SPEC', () => {
  it('exige escala explicita y la respeta', () => {
    expect(m('1').dividedBy(Count.fromInteger(3), DIVISION).toExactString()).toBe('0.333333333333');
  });

  it('dinero entre dinero da una proporcion', () => {
    // food_cost_pct de CC-001 = costo_total_unidad / venta_neta.
    //
    // OJO CON EL DIVISOR. `venta_neta` NO se toma del valor que V_COSTEO
    // muestra (1.565217391): esa celda esta redondeada para presentarla. Se
    // recalcula desde el dato primario, `pvp / (1 + iva_venta)` = 1.80 / 1.15,
    // que en realidad es 1.5652173913043478...
    //
    // Dividir por el valor mostrado da 0.3601277779 en vez de 0.3601277778: un
    // digito, en el decimo decimal, solo por haber redondeado un paso
    // intermedio. Multiplicado por las unidades de un mes es dinero de verdad.
    // Es la razon de que el redondeo viva solo en las divisiones, al persistir
    // y al presentar — nunca entre medias.
    const ventaNeta = m('1.80').dividedBy(r('0.15').onePlus(), DIVISION);
    const foodCost = m('0.5636782609').ratioTo(ventaNeta, escalaDe(10));
    expect(foodCost.toExactString()).toBe('0.3601277778');
  });

  it('lanza al dividir por cero en vez de devolver NaN o cero', () => {
    expect(() => m('1').dividedBy(Ratio.CERO, DIVISION)).toThrow(DivisionPorCeroError);
    expect(() => m('1').ratioTo(Money.CERO)).toThrow(DivisionPorCeroError);
  });

  it('la suma de control da exactamente 1 en los tres casos conocidos', () => {
    // SPEC §14: mc_pct + food_cost_pct = 1
    const casos = [
      { ventaNeta: '1.565217391', mc: '1.00153913' },
      { ventaNeta: '3.043478261', mc: '1.879480569' },
      { ventaNeta: '2.173913043', mc: '1.660104731' },
    ];

    for (const { ventaNeta, mc } of casos) {
      const venta = m(ventaNeta);
      const margen = m(mc);
      const costo = venta.minus(margen);

      const mcPct = margen.ratioTo(venta, DIVISION);
      const foodCostPct = costo.ratioTo(venta, DIVISION);

      expect(mcPct.plus(foodCostPct).round(PRESENTACION).toExactString()).toBe('1');
    }
  });
});

describe('Ratio', () => {
  it('onePlus es el (1 + iva) del SPEC', () => {
    expect(r('0.15').onePlus().toExactString()).toBe('1.15');
  });

  it('quita el IVA de venta exactamente como el Excel', () => {
    // venta_neta = pvp_con_iva / (1 + iva_venta), CC-001: 1.80 / 1.15
    const ventaNeta = m('1.80').dividedBy(r('0.15').onePlus(), escalaDe(9));
    expect(ventaNeta.toExactString()).toBe('1.565217391');
  });

  it('descuenta el IVA recuperable de una compra', () => {
    // T1 de CC-003: manteca 4.00 con IVA 0.15 -> precio neto 3.47826087
    const precioNeto = m('4.00').dividedBy(r('0.15').onePlus(), escalaDe(8));
    expect(precioNeto.toExactString()).toBe('3.47826087');
  });

  it('encarece el insumo al dividir por un rendimiento menor que 1', () => {
    // CC-002: platano maduro, 0.20 bruto con rendimiento 0.65
    const costoNeto = m('0.20').dividedBy(r('0.65'), escalaDe(10));
    expect(costoNeto.toExactString()).toBe('0.3076923077');
    expect(costoNeto.compare(m('0.20'))).toBe(1);
  });
});

describe('Count', () => {
  it('acepta enteros no negativos', () => {
    expect(Count.fromInteger(0).isZero()).toBe(true);
    expect(Count.fromInteger(340).toExactString()).toBe('340');
    expect(Count.fromString('185').toExactString()).toBe('185');
  });

  it.each([
    [2.5, 'decimal'],
    [-1, 'negativo'],
    [Number.MAX_SAFE_INTEGER + 2, 'fuera del rango seguro'],
  ])('rechaza %s (%s)', (valor) => {
    expect(() => Count.fromInteger(valor)).toThrow(ConteoInvalidoError);
  });

  it('rechaza una cadena decimal', () => {
    expect(() => Count.fromString('1.5')).toThrow(ConteoInvalidoError);
  });
});

describe('coercion a number: prohibida en tiempo de ejecucion', () => {
  it.each([
    ['Money', () => Money.CERO],
    ['Ratio', () => Ratio.CERO],
    ['Count', () => Count.CERO],
  ])('%s.valueOf() lanza', (_nombre, construir) => {
    expect(() => construir().valueOf()).toThrow(TypeError);
  });

  it('el mensaje explica que hacer en su lugar', () => {
    expect(() => Money.CERO.valueOf()).toThrow(/toDisplayString/);
  });

  it('los operadores relacionales lanzan: TypeScript no puede impedirlos', () => {
    const precio = m('0.10');
    const otro = m('0.20');

    // Hueco conocido del sistema de tipos: `<`, `>`, `<=` y `>=` compilan entre
    // dos operandos del mismo tipo aunque ese tipo no sea numerico. No hay
    // forma de prohibirlo con tipos, asi que lo corta `valueOf()` — y falla
    // ruidosamente en la primera ejecucion, no devolviendo una comparacion sin
    // sentido. La forma correcta es `compare()`.
    //
    // El resto del contrato, el que SI es de compilacion, esta en
    // money.type-contract.ts y lo verifica `audit:types`.
    expect(() => precio < otro).toThrow(TypeError);
    expect(() => precio >= otro).toThrow(TypeError);

    expect(precio.compare(otro)).toBe(-1);
  });
});

describe('propiedades algebraicas', () => {
  const importe = fc
    .tuple(fc.integer({ min: -99_999_999, max: 99_999_999 }), fc.integer({ min: 0, max: 999_999 }))
    .map(([entera, decimal]) => m(`${String(entera)}.${String(decimal).padStart(6, '0')}`));

  it('(a + b) - b = a', () => {
    fc.assert(
      fc.property(importe, importe, (a, b) => {
        expect(a.plus(b).minus(b).equals(a)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it('la suma es conmutativa sobre cualquier conjunto', () => {
    fc.assert(
      fc.property(fc.array(importe, { minLength: 1, maxLength: 60 }), (valores) => {
        expect(Money.sum([...valores].reverse()).equals(Money.sum(valores))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('(a / b) * b recupera a con error acotado por la escala de division', () => {
    const noCero = importe.filter((valor) => !valor.isZero());

    // La cota es RELATIVA a |b|, no absoluta: el cociente se trunca a 12
    // decimales, asi que al volver a multiplicar por b el error absoluto crece
    // con la magnitud de b (|b| x 10^-12). Con importes de hasta 1e8 eso son
    // 1e-4, muy por encima de cualquier cota fija — y no es un defecto, es la
    // aritmetica esperada. Se deja holgura de dos ordenes.
    const TOLERANCIA_RELATIVA = r('0.0000000001');
    const TOLERANCIA_ABSOLUTA = m('0.000000001');

    fc.assert(
      fc.property(importe, noCero, (a, b) => {
        const cociente = a.ratioTo(b, DIVISION);
        const reconstruido = b.times(cociente);
        const error = reconstruido.minus(a).abs();
        const cota = b.abs().times(TOLERANCIA_RELATIVA).plus(TOLERANCIA_ABSOLUTA);
        expect(error.compare(cota)).toBeLessThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });
});
