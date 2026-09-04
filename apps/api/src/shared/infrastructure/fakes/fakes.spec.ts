/**
 * Los falsos son codigo mantenido, no un descarte (CLAUDE.md §12): son la base
 * de las pruebas de integracion de todos los paquetes siguientes. Lo que se
 * prueba aqui es lo que los hace utiles — que simulen fallo — y lo que los hace
 * fiables — que no compartan estado con quien los llama.
 */

import { describe, expect, it } from 'vitest';

import { FakeFileStorage } from './fake-file-storage';
import { FakeMailer } from './fake-mailer';
import { ExternalServiceFailure } from './simulation';

const CORREO = { to: 'gerente@ejemplo.test', subject: 'Invitacion', body: 'Hola' };

describe('FakeMailer', () => {
  it('guarda lo enviado para que la prueba pueda inspeccionarlo', async () => {
    const mailer = new FakeMailer();

    await mailer.send(CORREO);

    expect(mailer.sent).toEqual([CORREO]);
  });

  it('falla cuando se le arma un fallo, y solo esa vez', async () => {
    const mailer = new FakeMailer();
    mailer.simulation.failNext();

    await expect(mailer.send(CORREO)).rejects.toThrow(ExternalServiceFailure);
    await expect(mailer.send(CORREO)).resolves.toBeUndefined();
    expect(mailer.sent).toHaveLength(1);
  });
});

describe('FakeFileStorage', () => {
  it('devuelve lo guardado', async () => {
    const storage = new FakeFileStorage();
    const archivo = { key: 'importaciones/enero.csv', contentType: 'text/csv', bytes: Uint8Array.from([1, 2, 3]) };

    await storage.put(archivo);

    await expect(storage.get(archivo.key)).resolves.toEqual(archivo);
  });

  it('devuelve null para una clave que no existe, no lanza', async () => {
    await expect(new FakeFileStorage().get('no-existe')).resolves.toBeNull();
  });

  it('COPIA los bytes: mutar el original no cambia lo almacenado', async () => {
    // Un falso que comparte el buffer con quien lo llamo deja que la prueba
    // pase por una razon que en produccion no existe.
    const storage = new FakeFileStorage();
    const bytes = Uint8Array.from([1, 2, 3]);
    await storage.put({ key: 'k', contentType: 'text/csv', bytes });

    bytes[0] = 99;

    const recuperado = await storage.get('k');
    expect(recuperado?.bytes[0]).toBe(1);
  });
});
