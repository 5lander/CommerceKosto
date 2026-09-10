/**
 * La eleccion del adaptador: con `resend` a medias no se arranca.
 */

import { describe, expect, it } from 'vitest';

import { MAILER_PORT } from '../../application/ports/mailer.port';
import { ConfiguracionDeCorreoIncompletaError, mailerProvider } from './mailer.provider';

const SIN_RESEND = { apiKey: undefined, remitente: undefined };

describe('mailerProvider', () => {
  it('fake y consola no exigen ninguna credencial', () => {
    for (const mailAdapter of ['fake', 'consola'] as const) {
      const proveedor = mailerProvider({ mailAdapter, resend: SIN_RESEND, isProduction: false });
      expect(proveedor).toMatchObject({ provide: MAILER_PORT });
    }
  });

  it('resend sin clave no arranca, y el error dice que variable falta', () => {
    expect(() =>
      mailerProvider({ mailAdapter: 'resend', resend: { apiKey: undefined, remitente: 'a@b.co' }, isProduction: true }),
    ).toThrow(ConfiguracionDeCorreoIncompletaError);
    expect(() =>
      mailerProvider({ mailAdapter: 'resend', resend: { apiKey: undefined, remitente: 'a@b.co' }, isProduction: true }),
    ).toThrow(/RESEND_API_KEY/u);
  });

  it('resend sin remitente tampoco', () => {
    expect(() =>
      mailerProvider({ mailAdapter: 'resend', resend: { apiKey: 're_x', remitente: undefined }, isProduction: true }),
    ).toThrow(/RESEND_REMITENTE/u);
  });

  it('resend con las dos, arranca', () => {
    const proveedor = mailerProvider({
      mailAdapter: 'resend',
      resend: { apiKey: 're_x', remitente: 'a@b.co' },
      isProduction: true,
    });

    expect(proveedor).toMatchObject({ provide: MAILER_PORT });
  });
});
