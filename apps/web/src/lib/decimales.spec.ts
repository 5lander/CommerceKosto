/**
 * `lib/decimales` — cómo se enseña un número, sin pasar por `Number`.
 *
 * **ES LA PRIMERA PRUEBA DE `apps/web`, Y NO ES CASUALIDAD QUE SEA ESTA.** Aquí
 * vivió INC-020 —un `localeCompare` que pintaba un 40 % de verde— y aquí vivió el
 * signo perdido de la pantalla de Inicio: `comoImporte('-9.999')` daba `100.00`.
 * Las dos son funciones puras que ninguna prueba de la API puede ver, y las dos
 * producían un número plausible y falso. Corre con el ejecutor de Node
 * (`node --test`), sin dependencias: ver `tools/audit/tests.mjs`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { comoImporte, comoPorcentaje, enPuntos, redondear, sinCerosDeSobra } from './decimales.ts';

describe('redondear — medio hacia arriba, como el ROUND de Excel', () => {
  it('redondea y no trunca', () => {
    assert.equal(redondear('0.2799', 3), '0.280');
    assert.equal(redondear('2783.2768695647808', 2), '2783.28');
  });

  it('acarrea hasta crecer una posición', () => {
    assert.equal(redondear('9.999', 2), '10.00');
    assert.equal(redondear('99.995', 2), '100.00');
  });

  it('con cero decimales devuelve la parte entera redondeada', () => {
    assert.equal(redondear('2.5', 0), '3');
  });
});

describe('el signo — el `-` no es un dígito', () => {
  it('un negativo con acarreo conserva el signo (antes: 100.00)', () => {
    assert.equal(comoImporte('-9.999'), '-10.00');
  });

  it('un negativo sin acarreo', () => {
    assert.equal(comoImporte('-1234.5678'), '-1234.57');
    assert.equal(comoImporte('-300.000000000000'), '-300.00');
  });

  it('medio hacia arriba se aleja del cero, como Excel', () => {
    assert.equal(redondear('-2.345', 2), '-2.35');
  });

  it('un cero no lleva signo', () => {
    assert.equal(comoImporte('-0.001'), '0.00');
    assert.equal(comoPorcentaje('-0.0004'), '0,0 %');
  });

  it('un porcentaje negativo corre la coma sin ceros de más (antes: -007,5 %)', () => {
    assert.equal(comoPorcentaje('-0.075'), '-7,5 %');
    assert.equal(comoPorcentaje('-1.25'), '-125,0 %');
  });
});

describe('comoPorcentaje', () => {
  it('una fracción a porcentaje con un decimal y coma de es-EC', () => {
    assert.equal(comoPorcentaje('0.2359'), '23,6 %');
    assert.equal(comoPorcentaje('0.172413793103'), '17,2 %');
  });

  it('el borde del umbral redondea, no trunca', () => {
    assert.equal(comoPorcentaje('0.2799'), '28,0 %');
    assert.equal(comoPorcentaje('0.9999'), '100,0 %');
  });
});

describe('enPuntos', () => {
  it('los puntos porcentuales con un decimal', () => {
    assert.equal(enPuntos('2'), '2,0 pp');
    assert.equal(enPuntos('-1.25'), '-1,3 pp');
  });
});

describe('sinCerosDeSobra — lo que precarga una casilla editable', () => {
  it('quita los ceros de la derecha de la coma', () => {
    assert.equal(sinCerosDeSobra('19.000000000000'), '19');
    assert.equal(sinCerosDeSobra('1.500000000000'), '1.5');
    assert.equal(sinCerosDeSobra('-1.500000000000'), '-1.5');
  });

  it('no toca los ceros de un entero', () => {
    assert.equal(sinCerosDeSobra('100'), '100');
  });
});
