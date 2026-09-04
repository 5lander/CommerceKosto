/**
 * La API de comparacion, probada como lo que es: la UNICA via legal para
 * comparar importes.
 *
 * `audit:forbidden` prohibe `.toNumber()` y `as unknown as`, y `valueOf()`
 * lanza. Si esta API estuviera incompleta, el primero que necesitara ordenar
 * una lista de costos tendria que elegir entre romper una regla o no hacer su
 * trabajo — y una regla que bloquea la unica salida disponible acaba
 * relajandose por presion. Estas pruebas existen para que eso no pase.
 */

import { describe, expect, it } from 'vitest';

import { Count, Money, Quantity, Ratio } from './tipos-monetarios';
import { unidadDeUso } from '../unidad/unidad-de-uso';

const KG = unidadDeUso('kg');

const m = (valor: string): Money => Money.fromDecimalString(valor);
const r = (valor: string): Ratio => Ratio.fromDecimalString(valor);
const q = (valor: string): Quantity => Quantity.of(valor, KG);

describe('Money — comparacion', () => {
  const menor = m('1.50');
  const igual = m('1.5');
  const mayor = m('2.00');

  it('compare devuelve -1, 0 o 1', () => {
    expect(menor.compare(mayor)).toBe(-1);
    expect(menor.compare(igual)).toBe(0);
    expect(mayor.compare(menor)).toBe(1);
  });

  it('es insensible a la escala: 1.50 y 1.5 son el mismo importe', () => {
    expect(menor.equals(igual)).toBe(true);
    expect(menor.lessThanOrEqual(igual)).toBe(true);
    expect(menor.greaterThanOrEqual(igual)).toBe(true);
    expect(menor.lessThan(igual)).toBe(false);
    expect(menor.greaterThan(igual)).toBe(false);
  });

  it('lessThan y greaterThan son estrictos', () => {
    expect(menor.lessThan(mayor)).toBe(true);
    expect(mayor.lessThan(menor)).toBe(false);
    expect(mayor.greaterThan(menor)).toBe(true);
    expect(menor.greaterThan(mayor)).toBe(false);
  });

  it('las variantes con igualdad admiten el empate', () => {
    expect(menor.lessThanOrEqual(mayor)).toBe(true);
    expect(mayor.greaterThanOrEqual(menor)).toBe(true);
    expect(mayor.lessThanOrEqual(menor)).toBe(false);
    expect(menor.greaterThanOrEqual(mayor)).toBe(false);
  });

  it('distingue cero, positivo y negativo, y -0 es cero', () => {
    expect(Money.CERO.isZero()).toBe(true);
    expect(Money.CERO.isNegative()).toBe(false);
    expect(Money.CERO.isPositive()).toBe(false);

    expect(m('-0').isZero()).toBe(true);
    expect(m('-0').isNegative()).toBe(false);

    expect(m('-0.01').isNegative()).toBe(true);
    expect(m('-0.01').isPositive()).toBe(false);
    expect(m('0.01').isPositive()).toBe(true);
  });

  it('permite ordenar una lista sin salir del tipo', () => {
    // El caso que motivaba alcanzar `.toNumber()`.
    const costos = [m('1.163997692'), m('0.5138083124'), m('0.5636782609')];
    const ordenados = [...costos].sort((a, b) => a.compare(b));

    expect(ordenados.map((valor) => valor.toExactString())).toEqual([
      '0.5138083124',
      '0.5636782609',
      '1.163997692',
    ]);
  });

  it('permite encontrar el maximo sin Math.max', () => {
    const costos = [m('1.163997692'), m('0.5138083124'), m('0.5636782609')];
    const maximo = costos.reduce((mayorHastaAhora, actual) =>
      actual.greaterThan(mayorHastaAhora) ? actual : mayorHastaAhora,
    );
    expect(maximo.toExactString()).toBe('1.163997692');
  });
});

describe('Ratio — comparacion contra los umbrales del SPEC §11', () => {
  // Los parametros de DECISIONES.md D3, tal como estan en el Excel.
  const OBJETIVO_MINIMO = r('0.25');
  const UMBRAL_VERDE = r('0.28');
  const MAXIMO_ACEPTABLE = r('0.32');

  /** El semaforo de food cost del SPEC §11, escrito como se escribira en P8. */
  function semaforo(foodCost: Ratio): 'VERDE' | 'AMBAR' | 'ROJO' {
    if (foodCost.greaterThan(MAXIMO_ACEPTABLE)) return 'ROJO';
    if (foodCost.lessThanOrEqual(UMBRAL_VERDE)) return 'VERDE';
    return 'AMBAR';
  }

  it('clasifica los food cost reales de los tres casos conocidos', () => {
    expect(semaforo(r('0.3601277778'))).toBe('ROJO'); // CC-001 Tamal de pollo
    expect(semaforo(r('0.3824563844'))).toBe('ROJO'); // CC-002 Wuafle
    expect(semaforo(r('0.2363518237'))).toBe('VERDE'); // CC-003 Empanada
  });

  it('los bordes exactos caen del lado correcto', () => {
    expect(semaforo(UMBRAL_VERDE)).toBe('VERDE');
    expect(semaforo(MAXIMO_ACEPTABLE)).toBe('AMBAR');
    expect(semaforo(r('0.3200000001'))).toBe('ROJO');
  });

  it('compara con el objetivo minimo sin salir del tipo', () => {
    expect(r('0.24').lessThan(OBJETIVO_MINIMO)).toBe(true);
    expect(OBJETIVO_MINIMO.greaterThanOrEqual(OBJETIVO_MINIMO)).toBe(true);
    expect(r('0.25').equals(OBJETIVO_MINIMO)).toBe(true);
    expect(r('-0.01').isNegative()).toBe(true);
  });
});

describe('Count — comparacion', () => {
  it('ordena y compara unidades vendidas', () => {
    const pocas = Count.fromInteger(85);
    const muchas = Count.fromInteger(340);

    expect(pocas.lessThan(muchas)).toBe(true);
    expect(muchas.greaterThan(pocas)).toBe(true);
    expect(pocas.equals(Count.fromString('85'))).toBe(true);
    expect(pocas.compare(muchas)).toBe(-1);
    expect(Count.CERO.isZero()).toBe(true);
    expect(muchas.greaterThanOrEqual(muchas)).toBe(true);
    expect(pocas.lessThanOrEqual(muchas)).toBe(true);
  });
});

describe('Quantity — comparacion, siempre dentro de la misma unidad', () => {
  it('compara cantidades de la misma unidad', () => {
    expect(q('12.5').greaterThan(q('0.9'))).toBe(true);
    expect(q('0.002').lessThan(q('0.09'))).toBe(true);
    expect(q('18.14').equals(q('18.140'))).toBe(true);
    expect(q('1').compare(q('1'))).toBe(0);
    expect(q('0').isZero()).toBe(true);
    expect(q('-1').isNegative()).toBe(true);
  });

  it('comparar unidades distintas LANZA, no devuelve un booleano cualquiera', () => {
    const unKilo = Quantity.of('1', KG);
    const unaUnidad = Quantity.of('1', unidadDeUso('unid'));

    expect(() => unKilo.compare(unaUnidad)).toThrow(/No se puede comparar/);
    expect(() => unKilo.greaterThan(unaUnidad)).toThrow(/kg/);
  });

  it('equals con unidades distintas es false, no un error', () => {
    // `equals` responde a "son el mismo valor", y una cantidad en kg nunca es
    // la misma que una en unidades. No hay ambiguedad que senalar.
    const unKilo = Quantity.of('1', KG);
    const unaUnidad = Quantity.of('1', unidadDeUso('unid'));

    expect(unKilo.equals(unaUnidad)).toBe(false);
  });
});
