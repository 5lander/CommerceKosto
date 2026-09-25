/**
 * Las plantillas, con la base apagada: lo que un correo DEBE decir y, sobre
 * todo, lo que NO debe llevar dentro.
 */

import { describe, expect, it } from 'vitest';

import type { ContenidoDeCorreo } from './correo-a-encolar';
import { renderizar } from './plantillas';

const PRODUCTO = 'costeo-saas';
const ENLACE = 'http://localhost:3001/activacion?token=abc-123_XYZ';
const CADUCA = '2026-09-17T13:05:00.000Z';

const INVITACION: ContenidoDeCorreo = { plantilla: 'INVITACION', datos: { enlace: ENLACE, caducaEn: CADUCA } };
const RESTABLECIMIENTO: ContenidoDeCorreo = {
  plantilla: 'RESTABLECIMIENTO',
  datos: { enlace: ENLACE, caducaEn: CADUCA },
};
const BLOQUEO: ContenidoDeCorreo = { plantilla: 'BLOQUEO', datos: {} };

describe('renderizar', () => {
  describe('INVITACION', () => {
    const correo = renderizar(INVITACION, PRODUCTO);

    it('lleva el enlace tal cual, en su propia linea', () => {
      expect(correo.body.split('\n')).toContain(ENLACE);
    });

    it('dice hasta cuando vale, hasta los minutos y en UTC', () => {
      expect(correo.body).toContain('caduca el 2026-09-17 13:05 UTC');
    });

    it('nombra el producto en el asunto', () => {
      expect(correo.subject).toBe('Te han invitado a costeo-saas');
    });

    it('no lleva ninguna contrasena ni pide una por correo', () => {
      // La contrasena la elige quien activa, en la pantalla. Un correo que la
      // trajera dentro seria una credencial viajando por buzones ajenos.
      expect(correo.body.toLowerCase()).not.toMatch(/contrasena:/u);
      expect(correo.body).not.toMatch(/\$argon2/u);
    });
  });

  describe('RESTABLECIMIENTO', () => {
    const correo = renderizar(RESTABLECIMIENTO, PRODUCTO);

    it('lleva el enlace y la caducidad', () => {
      expect(correo.body.split('\n')).toContain(ENLACE);
      expect(correo.body).toContain('2026-09-17 13:05 UTC');
    });

    it('dice que sirve una sola vez y que no pedirlo no cambia nada', () => {
      expect(correo.body).toContain('una sola vez');
      expect(correo.body).toContain('tu contrasena sigue siendo la misma');
    });

    it('el asunto nombra el producto', () => {
      expect(correo.subject).toBe('Restablece tu contrasena de costeo-saas');
    });
  });

  describe('BLOQUEO', () => {
    const correo = renderizar(BLOQUEO, PRODUCTO);

    it('no lleva enlaces: seria indistinguible de una suplantacion', () => {
      expect(correo.body).not.toMatch(/https?:\/\//u);
      expect(correo.body).not.toContain('enlace');
    });

    it('dice que fue un bloqueo temporal y que cambie la contrasena por el camino de siempre', () => {
      expect(correo.subject).toBe('Intentos de acceso fallidos en tu cuenta de costeo-saas');
      expect(correo.body).toContain('bloqueado temporalmente');
      expect(correo.body).toContain('cambia tu contrasena');
    });
  });

  it('una caducidad ilegible se ensena tal cual antes que inventar una fecha', () => {
    const correo = renderizar({ plantilla: 'INVITACION', datos: { enlace: ENLACE, caducaEn: 'manana' } }, PRODUCTO);
    expect(correo.body).toContain('caduca el manana');
  });

  it('ninguna plantilla incluye texto HTML: son texto plano a proposito', () => {
    for (const contenido of [INVITACION, RESTABLECIMIENTO, BLOQUEO]) {
      const { body } = renderizar(contenido, PRODUCTO);
      expect(body).not.toMatch(/<[a-z]+[^>]*>/iu);
    }
  });
});
