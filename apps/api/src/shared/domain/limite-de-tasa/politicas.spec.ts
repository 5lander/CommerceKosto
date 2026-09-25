/**
 * Los numeros de D-16.50, escritos como prueba para que nadie los mueva sin
 * que se note, y el error que los hace visibles al cliente.
 */

import { describe, expect, it } from 'vitest';

import { evaluarIntentos } from '../acceso/politica-de-intentos';
import { LimiteDeSolicitudesError, POLITICAS_DE_LIMITE, VENTANA_DE_LIMITE_MS } from './politicas';

const AHORA = new Date('2026-09-10T12:00:00.000Z');
const MINUTO = 60_000;
const HORA = 60 * MINUTO;

function golpes(cuantos: number): Date[] {
  return Array.from({ length: cuantos }, (_v, i) => new Date(AHORA.getTime() - i * 1_000));
}

describe('las politicas por kind (D-16.50)', () => {
  it.each([
    ['password.olvido', 10, 3],
    ['password.restablecimiento', 10, null],
    ['usuario.invitar', 30, 3],
    ['usuario.reenvio', 30, 3],
  ] as const)('%s: IP %i/h · destinatario %s/h', (kind, porIp, porDestinatario) => {
    const politica = POLITICAS_DE_LIMITE[kind];

    expect(politica.ip.umbral).toBe(porIp);
    expect(politica.destinatario?.umbral ?? null).toBe(porDestinatario);
  });

  it('la ventana es de una hora en los dos ejes, y el bloqueo dura una hora desde el ultimo golpe', () => {
    const politica = POLITICAS_DE_LIMITE['password.olvido'];

    expect(politica.ip.ventanaDeDisparoMs).toBe(HORA);
    expect(politica.ip.ventanaDeEscaladaMs).toBe(HORA);
    expect(politica.ip.escalaDeBloqueoMinutos).toEqual([60]);
    expect(VENTANA_DE_LIMITE_MS).toBe(HORA);
  });

  it('el enesimo golpe pasa y el enesimo+1 no: el umbral es "por hora", no "menos de"', () => {
    const { ip } = POLITICAS_DE_LIMITE['password.olvido'];

    expect(evaluarIntentos({ fallos: golpes(9), ahora: AHORA, politica: ip }).permitido).toBe(true);
    expect(evaluarIntentos({ fallos: golpes(10), ahora: AHORA, politica: ip }).permitido).toBe(false);
  });

  it('el mismo umbral, una hora despues, vuelve a estar disponible', () => {
    const { ip } = POLITICAS_DE_LIMITE['password.olvido'];
    const dentroDeUnaHoraYUnSegundo = new Date(AHORA.getTime() + HORA + 1_000);

    expect(evaluarIntentos({ fallos: golpes(10), ahora: dentroDeUnaHoraYUnSegundo, politica: ip }).permitido).toBe(true);
  });
});

describe('LimiteDeSolicitudesError', () => {
  it('es 429 LIMITE_DE_SOLICITUDES, dice el minuto y trae los segundos para Retry-After', () => {
    const error = new LimiteDeSolicitudesError({
      kind: 'password.olvido',
      bloqueadoHasta: new Date(AHORA.getTime() + 2 * MINUTO + 30_000),
      ahora: AHORA,
    });

    expect(error.codigo).toBe('LIMITE_DE_SOLICITUDES');
    expect(error.reintentarEnSegundos).toBe(150);
    expect(error.message).toBe('Demasiadas solicitudes. Vuelve a intentarlo en 3 minutos.');
    expect(error.detalle).toEqual({
      kind: 'password.olvido',
      bloqueadoHasta: '2026-09-10T12:02:30.000Z',
    });
  });

  it('un minuto va en singular', () => {
    const error = new LimiteDeSolicitudesError({
      kind: 'usuario.invitar',
      bloqueadoHasta: new Date(AHORA.getTime() + 20_000),
      ahora: AHORA,
    });

    expect(error.message).toContain('en 1 minuto.');
    expect(error.reintentarEnSegundos).toBe(20);
  });

  it('nunca pide esperar cero: un bloqueo que ya paso sigue siendo al menos un segundo', () => {
    const error = new LimiteDeSolicitudesError({
      kind: 'usuario.reenvio',
      bloqueadoHasta: new Date(AHORA.getTime() - MINUTO),
      ahora: AHORA,
    });

    expect(error.reintentarEnSegundos).toBe(1);
    expect(error.message).toContain('en 1 minuto.');
  });

  it('el mensaje no lleva la clave, el correo ni la IP', () => {
    const error = new LimiteDeSolicitudesError({
      kind: 'usuario.invitar',
      bloqueadoHasta: new Date(AHORA.getTime() + MINUTO),
      ahora: AHORA,
    });

    expect(error.message).not.toContain('@');
    expect(error.message).not.toContain('ip:');
  });
});
