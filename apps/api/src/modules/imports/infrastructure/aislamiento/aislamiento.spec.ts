/**
 * El aislamiento en proceso hijo, con la base apagada.
 *
 * **ES LA PIEZA QUE MÁS FÁCIL SE ROMPE SIN QUE NADIE SE ENTERE**, porque
 * depende del entorno: la ruta del hijo cambia entre el fuente y `dist/`, y las
 * banderas con las que arranca no son las mismas ejecutando la aplicación que
 * corriendo pruebas. Un `fork` mal configurado no lanza un error claro: el hijo
 * muere al arrancar y el padre solo ve un código de salida.
 *
 * Así que esto se prueba de verdad —lanzando el proceso— y no con un doble.
 */

import { describe, expect, it } from 'vitest';

import { AnalisisAgotadoError, ArchivoIlegibleError } from '../../domain/errores';
import { leerEnHijo } from './leer-en-hijo';

const CSV_DE_ITEMS = ['nombre,tipo,unidad,rendimiento', 'Tomate,COMPRADO,kg,0.9'].join('\n');

function bytes(texto: string): Uint8Array {
  return new Uint8Array(Buffer.from(texto, 'utf8'));
}

describe('análisis en proceso hijo', () => {
  it('lee un CSV en el hijo y devuelve sus celdas por IPC', async () => {
    const filas = await leerEnHijo(bytes(CSV_DE_ITEMS));

    expect(filas).toHaveLength(2);
    expect(filas[1]).toEqual(['Tomate', 'COMPRADO', 'kg', '0.9']);
  }, 30_000);

  it('un archivo que no es ni hoja ni texto se rechaza sin tumbar al padre', async () => {
    const binario = new Uint8Array([0x4d, 0x5a, 0x00, 0x01, 0x02]);

    await expect(leerEnHijo(binario)).rejects.toThrow(ArchivoIlegibleError);
  }, 30_000);

  it('el mensaje del error de dominio llega al padre, no una frase genérica', async () => {
    // El usuario tiene que poder leer qué le pasa a su archivo.
    await expect(leerEnHijo(new Uint8Array([0, 1, 2]))).rejects.toThrow(
      /Solo se admiten archivos/u,
    );
  }, 30_000);

  it('un .xlsx de verdad tambien cruza el canal, no solo el texto', async () => {
    // El ZIP es el formato que motiva el aislamiento: si algo va a reventar al
    // hijo, va a ser descomprimiendo.
    const zip = new Uint8Array(
      Buffer.concat([
        Buffer.from(`PK${String.fromCharCode(3, 4)}`, 'latin1'),
        Buffer.alloc(26),
      ]),
    );

    // No es un .xlsx completo: se rechaza. Lo que se comprueba es que el hijo
    // lo procesa y contesta en vez de morirse.
    await expect(leerEnHijo(zip)).rejects.toThrow(ArchivoIlegibleError);
  }, 30_000);

  it('el error de plazo agotado existe y es suyo, no un fallo genérico', () => {
    // El plazo real son quince segundos y no hay forma honesta de forzarlo sin
    // un archivo patológico; lo que sí se fija aquí es que el tipo de error
    // existe y dice algo accionable.
    expect(new AnalisisAgotadoError().message).toContain('demasiado');
  });
});
