/**
 * Lo que se prueba aquí es una regla de seguridad pequeña y fácil de deshacer:
 * el valor que el usuario escribió **vuelve a salir** en el mensaje de tres
 * errores 400, así que tiene que salir domado.
 *
 * Corre con la base apagada: es dominio puro.
 */

import { describe, expect, it } from 'vitest';

import { valorParaMensaje } from './valor-en-mensaje';

const SALTO = String.fromCharCode(10);
const RETORNO = String.fromCharCode(13);
const NULO = String.fromCharCode(0);
const BORRADO = String.fromCharCode(127);

describe('valorParaMensaje', () => {
  it('deja intacto un valor corriente', () => {
    expect(valorParaMensaje('0192f3a1-5c7e-7b2a-9d44-1e8f6b0c3a55')).toBe(
      '0192f3a1-5c7e-7b2a-9d44-1e8f6b0c3a55',
    );
  });

  it('quita el salto de linea y el retorno: son los que parten una linea de log en dos', () => {
    expect(valorParaMensaje(`kg${RETORNO}${SALTO}ERROR falso`)).toBe('kgERROR falso');
  });

  it('quita tambien el nulo y el DEL', () => {
    expect(valorParaMensaje(`a${NULO}b${BORRADO}c`)).toBe('abc');
  });

  it('recorta lo largo y lo marca, para que el 400 no sea el eco de la peticion', () => {
    const recortado = valorParaMensaje('x'.repeat(500));

    expect(recortado.length).toBeLessThan(500);
    expect(recortado.endsWith('…')).toBe(true);
  });

  it('no toca acentos ni eñes: son texto legitimo del usuario', () => {
    expect(valorParaMensaje('mantequilla de maní ñ')).toBe('mantequilla de maní ñ');
  });

  it('un valor entero de control se queda en vacio, no en basura', () => {
    expect(valorParaMensaje(`${NULO}${SALTO}${RETORNO}`)).toBe('');
  });
});
