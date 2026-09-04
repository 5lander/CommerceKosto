import { describe, expect, it } from 'vitest';

import {
  caducidadDesde,
  estadoDeSesion,
  INACTIVIDAD_MAXIMA_MS,
  VIDA_ABSOLUTA_MS,
  type VigenciaDeSesion,
} from './politica-de-sesion';

const AHORA = new Date('2026-09-03T12:00:00.000Z');
const UN_SEGUNDO_MS = 1000;

function sesion(parcial: Partial<VigenciaDeSesion> = {}): VigenciaDeSesion {
  return {
    createdAt: AHORA,
    lastSeenAt: AHORA,
    expiresAt: caducidadDesde(AHORA),
    revokedAt: null,
    ...parcial,
  };
}

describe('politica de sesion', () => {
  it('una sesion recien abierta esta vigente', () => {
    expect(estadoDeSesion(sesion(), AHORA)).toBe('vigente');
  });

  it('la revocacion gana a todo lo demas', () => {
    const revocada = sesion({ revokedAt: AHORA, expiresAt: new Date(AHORA.getTime() - VIDA_ABSOLUTA_MS) });

    expect(estadoDeSesion(revocada, AHORA)).toBe('revocada');
  });

  describe('limite absoluto', () => {
    it('vigente un segundo antes', () => {
      const casi = new Date(AHORA.getTime() + VIDA_ABSOLUTA_MS - UN_SEGUNDO_MS);

      expect(estadoDeSesion(sesion({ lastSeenAt: casi }), casi)).toBe('vigente');
    });

    it('caducada EXACTAMENTE al cumplirse: el borde no se regala', () => {
      const justo = new Date(AHORA.getTime() + VIDA_ABSOLUTA_MS);

      expect(estadoDeSesion(sesion({ lastSeenAt: justo }), justo)).toBe('caducada');
    });

    it('caduca aunque se haya usado sin parar: es lo que acota un token robado', () => {
      const despues = new Date(AHORA.getTime() + VIDA_ABSOLUTA_MS + UN_SEGUNDO_MS);
      const usandose = sesion({ lastSeenAt: despues });

      expect(estadoDeSesion(usandose, despues)).toBe('caducada');
    });
  });

  describe('inactividad', () => {
    it('vigente un segundo antes', () => {
      const casi = new Date(AHORA.getTime() + INACTIVIDAD_MAXIMA_MS - UN_SEGUNDO_MS);

      expect(estadoDeSesion(sesion(), casi)).toBe('vigente');
    });

    it('inactiva al cumplirse, con la sesion aun sin caducar', () => {
      const justo = new Date(AHORA.getTime() + INACTIVIDAD_MAXIMA_MS);

      expect(estadoDeSesion(sesion(), justo)).toBe('inactiva');
    });
  });
});
