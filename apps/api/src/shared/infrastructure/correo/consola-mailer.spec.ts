/**
 * El adaptador por consola, sin tocar `stdout`.
 */

import { describe, expect, it } from 'vitest';

import { ConsolaMailer } from './consola-mailer';

const CORREO = {
  to: 'ana@snacklab.ec',
  subject: 'Te han invitado a costeo-saas',
  body: 'abre este enlace:\n\nhttp://localhost:3001/activacion?token=abc',
};

function capturado(conCuerpo: boolean): Promise<string> {
  let salida = '';
  const mailer = new ConsolaMailer({
    conCuerpo,
    escribir: (texto) => {
      salida += texto;
    },
  });
  return mailer.send(CORREO).then(() => salida);
}

describe('ConsolaMailer', () => {
  it('fuera de produccion escribe destinatario, asunto y el cuerpo entero', async () => {
    const salida = await capturado(true);

    expect(salida).toContain('para: ana@snacklab.ec');
    expect(salida).toContain('asunto: Te han invitado a costeo-saas');
    expect(salida).toContain('token=abc');
  });

  it('en produccion escribe destinatario y asunto, y NUNCA el cuerpo: el enlace no va a un log', async () => {
    const salida = await capturado(false);

    expect(salida).toContain('para: ana@snacklab.ec');
    expect(salida).toContain('asunto:');
    expect(salida).not.toContain('token=');
    expect(salida).not.toContain('enlace');
  });
});
