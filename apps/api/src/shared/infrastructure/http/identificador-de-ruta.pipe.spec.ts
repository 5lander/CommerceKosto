/**
 * El pipe de los `:id` de ruta, con la base apagada (P16-C, D-16.130).
 */

import { describe, expect, it } from 'vitest';

import { errorResponseFor } from './error.filter';
import { IdentificadorDeRuta } from './identificador-de-ruta.pipe';

const PARAMETRO = { type: 'param', data: 'productId' } as const;

describe('IdentificadorDeRuta', () => {
  const pipe = new IdentificadorDeRuta();

  it('deja pasar un UUID, en minúsculas como el constructor del identificador', () => {
    expect(pipe.transform('0192F3A1-5C7E-7B2A-9D44-1E8F6B0C3A55', PARAMETRO)).toBe('0192f3a1-5c7e-7b2a-9d44-1e8f6b0c3a55');
  });

  it('un id mal formado sale como 400 ENTRADA_INVALIDA —el contrato de la API—, no como el BAD_REQUEST de Nest', () => {
    let lanzado: unknown;
    try {
      pipe.transform('no-es-un-uuid', PARAMETRO);
    } catch (error) {
      lanzado = error;
    }

    const respuesta = errorResponseFor(lanzado);
    expect(respuesta.status).toBe(400);
    expect(respuesta.body.code).toBe('ENTRADA_INVALIDA');
    expect(respuesta.body.message).toContain('productId');
  });
});
