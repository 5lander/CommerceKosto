/**
 * La espera entre reintentos y el tope, con la base apagada — D-16.46.
 */

import { describe, expect, it } from 'vitest';

import { decidirReintento, INTENTOS_MAXIMOS } from './reintentos';

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const MINUTO_MS = 60_000;

function minutosDespues(decision: ReturnType<typeof decidirReintento>): number | null {
  if (decision.siguienteIntentoEn === null) {
    return null;
  }
  return (decision.siguienteIntentoEn.getTime() - AHORA.getTime()) / MINUTO_MS;
}

describe('decidirReintento', () => {
  it('el primer fallo espera un minuto y deja el correo PENDIENTE con un intento contado', () => {
    const decision = decidirReintento({ intentos: 0, ahora: AHORA });

    expect(decision.estado).toBe('PENDIENTE');
    expect(decision.intentos).toBe(1);
    expect(minutosDespues(decision)).toBe(1);
  });

  it('la espera se duplica: 1 → 2 → 4 → 8 minutos', () => {
    const esperas = [0, 1, 2, 3].map((intentos) => minutosDespues(decidirReintento({ intentos, ahora: AHORA })));

    expect(esperas).toEqual([1, 2, 4, 8]);
  });

  it('el quinto fallo es FALLIDO, sin siguiente intento', () => {
    const decision = decidirReintento({ intentos: INTENTOS_MAXIMOS - 1, ahora: AHORA });

    expect(decision).toEqual({ estado: 'FALLIDO', intentos: INTENTOS_MAXIMOS, siguienteIntentoEn: null });
  });

  it('por encima del tope sigue siendo FALLIDO: una fila que ya paso de cinco no vuelve a la cola', () => {
    const decision = decidirReintento({ intentos: INTENTOS_MAXIMOS + 3, ahora: AHORA });

    expect(decision.estado).toBe('FALLIDO');
    expect(decision.siguienteIntentoEn).toBeNull();
  });

  it('no muta el instante que recibe', () => {
    const ahora = new Date(AHORA);
    decidirReintento({ intentos: 0, ahora });

    expect(ahora.getTime()).toBe(AHORA.getTime());
  });
});
