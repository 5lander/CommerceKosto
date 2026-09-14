/**
 * `lib/fechas` — el mes que se mira, sin medianoches y sin parsear (D-16.4, INC-013).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { comoFecha, consultaDelMes, mesAnterior, mesDeHoy, mesDeTexto } from './fechas.ts';

describe('mesDeTexto', () => {
  it('lee un año y un mes con forma de año y mes', () => {
    assert.deepEqual(mesDeTexto('2026', '9'), { anio: 2026, mes: 9 });
    assert.deepEqual(mesDeTexto('2026', '09'), { anio: 2026, mes: 9 });
    assert.deepEqual(mesDeTexto('2026', '12'), { anio: 2026, mes: 12 });
  });

  it('no corrige un mes que no existe: `?mes=13` no es diciembre', () => {
    assert.equal(mesDeTexto('2026', '13'), null);
    assert.equal(mesDeTexto('2026', '0'), null);
  });

  it('rechaza lo que no tiene forma', () => {
    assert.equal(mesDeTexto('26', '9'), null);
    assert.equal(mesDeTexto('2026', 'sep'), null);
    assert.equal(mesDeTexto(null, '9'), null);
    assert.equal(mesDeTexto('2026', null), null);
  });
});

describe('mesAnterior', () => {
  it('cruza el año en enero', () => {
    assert.deepEqual(mesAnterior({ anio: 2026, mes: 1 }), { anio: 2025, mes: 12 });
  });

  it('un mes cualquiera', () => {
    assert.deepEqual(mesAnterior({ anio: 2026, mes: 10 }), { anio: 2026, mes: 9 });
  });
});

describe('mesDeHoy', () => {
  it('es un mes válido', () => {
    const { anio, mes } = mesDeHoy();
    assert.ok(mesDeTexto(String(anio), String(mes)) !== null);
  });
});

describe('comoFecha', () => {
  it('lee el instante en la zona del negocio, no en UTC', () => {
    // 02:00 UTC del día 15 son las 21:00 del 14 en Guayaquil.
    const enGuayaquil = comoFecha('2026-01-15T02:00:00.000Z');
    assert.ok(enGuayaquil.startsWith('14'), enGuayaquil);
    assert.ok(enGuayaquil.endsWith('2026'), enGuayaquil);
  });

  it('el mediodía UTC con el que se fechan las vigencias cae en su día', () => {
    assert.ok(comoFecha('2026-09-13T12:00:00.000Z').startsWith('13'));
  });
});

describe('consultaDelMes', () => {
  it('es la consulta que piden la API y la URL', () => {
    assert.equal(consultaDelMes({ anio: 2026, mes: 9 }), 'anio=2026&mes=9');
  });
});
