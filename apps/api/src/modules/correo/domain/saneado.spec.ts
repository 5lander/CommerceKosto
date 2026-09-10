/**
 * El saneado de `datos`, con la base apagada — D-16.34.
 */

import { describe, expect, it } from 'vitest';

import { datosSaneados } from './saneado';

describe('datosSaneados', () => {
  it('conserva exactamente plantilla y destinatario, y nada mas', () => {
    const datos = datosSaneados('INVITACION', 'ana@snacklab.ec');

    expect(datos).toEqual({ plantilla: 'INVITACION', destinatario: 'ana@snacklab.ec' });
    expect(Object.keys(datos)).toEqual(['plantilla', 'destinatario']);
  });

  it('no puede llevar un enlace ni un token: no hay por donde meterlos', () => {
    const texto = JSON.stringify(datosSaneados('RESTABLECIMIENTO', 'ana@snacklab.ec'));

    expect(texto).not.toContain('token=');
    expect(texto).not.toContain('enlace');
    expect(texto).not.toContain('caducaEn');
  });
});
