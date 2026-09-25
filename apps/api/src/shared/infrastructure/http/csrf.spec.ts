/**
 * Las tres funciones del token anti-CSRF, con la base apagada.
 *
 * LO QUE IMPORTA PROBAR AQUI NO ES QUE «FUNCIONE», sino los dos bordes por los
 * que un CSRF mal hecho se cae en silencio: que un token de longitud DISTINTA
 * no reviente con el `RangeError` de `timingSafeEqual` —seria un 500 en vez de
 * un 403, y ademas un oraculo de longitud— y que la lista de metodos seguros
 * no deje pasar una mutacion por venir en minusculas.
 */

import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';

import { esElMismoToken, esMutacion, tokenDeLaCabecera } from './csrf';

const TOKEN = 'kkR2r0h8yPqZ2Q7gk5xk0h5m0mZ0m3n0m5n0m7n0m9';

function peticionCon(cabeceras: IncomingMessage['headers']): IncomingMessage {
  return { headers: cabeceras } as IncomingMessage;
}

describe('esElMismoToken', () => {
  it('acepta el mismo token', () => {
    expect(esElMismoToken(TOKEN, TOKEN)).toBe(true);
  });

  it('rechaza otro token del mismo largo', () => {
    expect(esElMismoToken(TOKEN, `${TOKEN.slice(0, -1)}Z`)).toBe(false);
  });

  it('rechaza uno de largo distinto SIN lanzar: el largo no debe ser un oraculo', () => {
    expect(esElMismoToken(TOKEN, 'corto')).toBe(false);
    expect(esElMismoToken(TOKEN, `${TOKEN}${TOKEN}`)).toBe(false);
  });

  it('rechaza la cadena vacia', () => {
    expect(esElMismoToken(TOKEN, '')).toBe(false);
  });
});

describe('esMutacion', () => {
  it('GET, HEAD y OPTIONS no mutan', () => {
    for (const metodo of ['GET', 'HEAD', 'OPTIONS']) {
      expect(esMutacion(metodo)).toBe(false);
    }
  });

  it('POST, PUT, PATCH y DELETE si', () => {
    for (const metodo of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(esMutacion(metodo)).toBe(true);
    }
  });

  it('no se deja enganar por las minusculas', () => {
    expect(esMutacion('post')).toBe(true);
    expect(esMutacion('get')).toBe(false);
  });

  it('sin metodo, se trata como mutacion: por el lado seguro', () => {
    expect(esMutacion(undefined)).toBe(true);
  });
});

describe('tokenDeLaCabecera', () => {
  it('devuelve el valor cuando viene', () => {
    expect(tokenDeLaCabecera(peticionCon({ 'x-csrf-token': TOKEN }))).toBe(TOKEN);
  });

  it('null cuando no viene o viene vacia', () => {
    expect(tokenDeLaCabecera(peticionCon({}))).toBeNull();
    expect(tokenDeLaCabecera(peticionCon({ 'x-csrf-token': '' }))).toBeNull();
  });

  it('null cuando llega repetida: dos valores son dos intentos a la vez', () => {
    expect(tokenDeLaCabecera(peticionCon({ 'x-csrf-token': [TOKEN, 'otro'] }))).toBeNull();
  });
});
