/**
 * `lib/busqueda` — buscar por nombre sin que una tilde esconda una fila.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { coincide } from './busqueda.ts';

describe('coincide', () => {
  it('sin tildes ni mayúsculas', () => {
    assert.equal(coincide('Limón sutil', 'limon'), true);
    assert.equal(coincide('Café americano', 'CAFE'), true);
  });

  it('lo buscado vacío o en blanco lo encuentra todo', () => {
    assert.equal(coincide('Arroz', ''), true);
    assert.equal(coincide('Arroz', '   '), true);
  });

  it('lo que no está no coincide', () => {
    assert.equal(coincide('Arroz', 'aceite'), false);
  });
});
