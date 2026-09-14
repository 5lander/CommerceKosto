/**
 * `lib/campos` — lo que un formulario manda a la API.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { textoOpcional } from './campos.ts';

describe('textoOpcional', () => {
  it('vacío o solo espacios es `null`', () => {
    assert.equal(textoOpcional(''), null);
    assert.equal(textoOpcional('   '), null);
  });

  it('con contenido, recortado', () => {
    assert.equal(textoOpcional('  Pronaca '), 'Pronaca');
  });
});
