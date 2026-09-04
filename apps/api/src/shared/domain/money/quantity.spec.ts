/**
 * `Quantity` — la cantidad con su unidad pegada.
 *
 * Los datos de las pruebas son las cantidades reales de las lineas de receta de
 * CC-003 (`PRD-018`, Empanada de Verde con Pollo), que van de `0.001` kg de
 * oregano a `18.14` kg de platano: exactamente el rango de magnitudes donde el
 * punto flotante empieza a derivar.
 */

import { describe, expect, it } from 'vitest';

import { DIVISION, escalaDe } from '../decimal/escalas';
import { DivisionPorCeroError, ValorDecimalInvalidoError } from '../decimal/nucleo';
import { Count, Quantity, Ratio } from './tipos-monetarios';
import {
  UnidadDeUsoInvalidaError,
  UnidadIncompatibleError,
  unidadDeUso,
} from '../unidad/unidad-de-uso';

const KG = unidadDeUso('kg');
const UNID = unidadDeUso('unid');
const LT = unidadDeUso('lt');

const kg = (valor: string): Quantity => Quantity.of(valor, KG);

describe('UnidadDeUso', () => {
  it('acepta codigos cortos en minusculas', () => {
    expect(unidadDeUso('kg')).toBe('kg');
    expect(unidadDeUso('unid')).toBe('unid');
    expect(unidadDeUso('lt')).toBe('lt');
  });

  it.each([
    ['KG', 'mayusculas'],
    ['', 'vacio'],
    ['1kg', 'empieza por digito'],
    ['kilo gramo', 'con espacio'],
    ['unidaddemedidalarguisima', 'demasiado largo'],
  ])('rechaza "%s" (%s)', (codigo) => {
    expect(() => unidadDeUso(codigo)).toThrow(UnidadDeUsoInvalidaError);
  });
});

describe('Quantity — construccion', () => {
  it('conserva la unidad y el valor exacto', () => {
    const platano = kg('18.14');
    expect(platano.unidad).toBe(KG);
    expect(platano.toExactString()).toBe('18.14');
  });

  it('rechaza una cadena que no es decimal literal', () => {
    expect(() => Quantity.of('1e3', KG)).toThrow(ValorDecimalInvalidoError);
  });

  it('hace ida y vuelta por el formato de la base', () => {
    const original = kg('0.001');
    expect(original.toStorageString()).toBe('0.001000000000');
    expect(Quantity.fromDatabase(original.toStorageString(), KG).equals(original)).toBe(true);
  });

  it('serializa con su unidad', () => {
    expect(kg('12.5').toJSON()).toBe('12.5 kg');
  });
});

describe('Quantity — aritmetica dentro de la misma unidad', () => {
  it('suma y resta exactas', () => {
    expect(kg('0.9').plus(kg('0.5')).toExactString()).toBe('1.4');
    expect(kg('18.14').minus(kg('0.14')).toExactString()).toBe('18');
  });

  it('suma las once lineas de CC-003 sin deriva y sin importar el orden', () => {
    const lineas = [
      '18.14', '12.5', '0.9', '0.4', '0.1', '0.9', '0.5', '0.002', '0.09', '0.001', '0.001',
    ].map(kg);

    const total = Quantity.sum(lineas, KG);
    const barajado = Quantity.sum([...lineas].reverse(), KG);

    expect(total.toExactString()).toBe('33.534');
    expect(barajado.equals(total)).toBe(true);
  });

  it('Quantity.sum de una lista vacia es cero, con la unidad que se le indique', () => {
    const vacio = Quantity.sum([], LT);
    expect(vacio.isZero()).toBe(true);
    expect(vacio.unidad).toBe(LT);
  });

  it('escala por un adimensional sin cambiar de unidad', () => {
    // Cantidad por porcion: la del lote entre las 185 porciones de CC-003.
    const porPorcion = kg('18.14').dividedByScalar(Count.fromInteger(185), DIVISION);
    expect(porPorcion.toExactString()).toBe('0.098054054054');
    expect(porPorcion.unidad).toBe(KG);

    const dobleLote = kg('18.14').timesScalar(Ratio.fromDecimalString('2'));
    expect(dobleLote.toExactString()).toBe('36.28');
    expect(dobleLote.unidad).toBe(KG);
  });

  it('cantidad entre cantidad de la misma unidad cancela la unidad', () => {
    const proporcion = kg('12.5').ratioTo(kg('18.14'), escalaDe(10));
    expect(proporcion.toExactString()).toBe('0.6890848953');
  });

  it('lanza al dividir por cero', () => {
    expect(() => kg('1').ratioTo(kg('0'))).toThrow(DivisionPorCeroError);
    expect(() => kg('1').dividedByScalar(Count.CERO, DIVISION)).toThrow(DivisionPorCeroError);
  });

  it('negated y abs conservan la unidad', () => {
    expect(kg('1.5').negated().toExactString()).toBe('-1.5');
    expect(kg('-1.5').abs().toExactString()).toBe('1.5');
    expect(kg('1.5').negated().unidad).toBe(KG);
  });

  it('no muta el receptor', () => {
    const original = kg('10');
    original.plus(kg('5'));
    expect(original.toExactString()).toBe('10');
  });
});

describe('Quantity — mezclar unidades es un error de dominio', () => {
  it('sumar kg con unidades lanza', () => {
    expect(() => Quantity.of('1', KG).plus(Quantity.of('1', UNID))).toThrow(UnidadIncompatibleError);
  });

  it('restar tambien', () => {
    expect(() => Quantity.of('1', KG).minus(Quantity.of('1', LT))).toThrow(UnidadIncompatibleError);
  });

  it('dividir tambien', () => {
    expect(() => Quantity.of('1', KG).ratioTo(Quantity.of('1', LT))).toThrow(UnidadIncompatibleError);
  });

  it('el mensaje dice las dos unidades y donde vive el factor de conversion', () => {
    expect(() => Quantity.of('1', KG).plus(Quantity.of('1', UNID))).toThrow(/"kg".*"unid"/);
    expect(() => Quantity.of('1', KG).plus(Quantity.of('1', UNID))).toThrow(/articulo de compra/);
  });
});

describe('Quantity — coercion a number prohibida', () => {
  it('valueOf lanza y explica que se perderian dos cosas', () => {
    expect(() => kg('1').valueOf()).toThrow(TypeError);
    expect(() => kg('1').valueOf()).toThrow(/unidad/);
  });
});
