/**
 * P15 — el caracter de control no llega nunca a la base.
 *
 * ESTA PRUEBA EXISTE PORQUE EL PENTEST ENCONTRO UN 500. Un `NUL` en cualquier
 * campo de texto llegaba intacto hasta PostgreSQL, que no puede guardarlo en una
 * columna de texto, y su rechazo salia como `INTERNAL_ERROR 500`. Es INC-012
 * otra vez: una restriccion de la base que nadie tradujo a un 400.
 *
 * Los casos que importan son dos, y ninguno se prueba solo:
 *
 * 1. **El control acompanado de OTRO error.** Es la trampa de INC-008 al reves:
 *    si la comprobacion viviera en un refinamiento de objeto, no se ejecutaria
 *    cuando otro campo ya hubiera fallado. Aqui corre antes que Zod, asi que
 *    manda ella.
 * 2. **El control ENTERRADO.** Un `return` silencioso al llegar al limite de
 *    profundidad convertiria el anidamiento en la manera de saltarse la
 *    comprobacion.
 *
 * Sin base de datos: es un pipe puro sobre un esquema.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { EntradaInvalidaError } from '../../domain/errors/entrada-invalida';
import { EsquemaPipe } from './esquema.pipe';

/** El byte que rompia. Escrito por codigo para no meterlo crudo en el fuente. */
const NUL = String.fromCodePoint(0);

const ESQUEMA = z
  .object({
    nombre: z.string().min(1),
    cantidad: z.string(),
  })
  .strict();

const pipe = new EsquemaPipe(ESQUEMA);

describe('EsquemaPipe · caracteres de control', () => {
  it('acepta un cuerpo normal', () => {
    expect(pipe.transform({ nombre: 'Aji picante', cantidad: '2' })).toEqual({
      nombre: 'Aji picante',
      cantidad: '2',
    });
  });

  it('rechaza un NUL con 400 y no lo deja llegar a la base', () => {
    expect(() => pipe.transform({ nombre: `${NUL}nulo`, cantidad: '2' })).toThrow(
      EntradaInvalidaError,
    );
  });

  it('rechaza el NUL AUNQUE otro campo tambien este mal (INC-008)', () => {
    // Este es el caso que se escapa siempre. Si la comprobacion viviera en un
    // refinamiento de objeto, `cantidad` invalida la desactivaria en silencio.
    let capturado: unknown = null;
    try {
      pipe.transform({ nombre: `${NUL}nulo`, cantidad: 42 });
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(EntradaInvalidaError);
    expect((capturado as Error).message).toContain('caracteres de control');
  });

  it('encuentra el control dentro de un array', () => {
    const anidado = new EsquemaPipe(z.object({ lineas: z.array(z.string()) }).strict());

    expect(() => anidado.transform({ lineas: ['bien', `mal${NUL}`] })).toThrow(EntradaInvalidaError);
  });

  it('rechaza —no ignora— un cuerpo enterrado mas hondo que el limite', () => {
    // ENTERRARLO NO PUEDE SER LA VIA DE ESCAPE. Se comprueba con el pipe de
    // arriba a proposito: lo que se mide es que el recorrido se planta, no que
    // el esquema lo rechace por su forma.
    let hondo: unknown = `mal${NUL}`;
    for (let nivel = 0; nivel < 12; nivel += 1) hondo = { dentro: hondo };

    expect(() => pipe.transform(hondo)).toThrow(EntradaInvalidaError);
  });

  it('deja pasar el tabulador y el salto de linea, que son texto legitimo', () => {
    const conSaltos = { nombre: 'primera\nsegunda\tcon tabulador', cantidad: '1' };

    expect(pipe.transform(conSaltos)).toEqual(conSaltos);
  });
});

/**
 * LA REVISION DE P16-A2: `.strict()` abrio en la otra puerta el eco que
 * `valorParaMensaje` acababa de cerrar.
 *
 * El mensaje que Zod escribe para las claves sobrantes las lleva dentro tal
 * cual, y desde que los ocho `CONSULTA_*` son estrictos ese texto sale al
 * cliente en el cuerpo del 400. Una clave de 300 caracteres volvia entera.
 *
 * Se comprueba lo que importa —que el mensaje NO es un eco— y no solo que hay
 * un 400: el 400 ya lo daba antes, y verlo verde no distinguia una cosa de la
 * otra (INC-007).
 */
describe('EsquemaPipe · las claves que sobran no vuelven como eco', () => {
  const CLAVE_LARGA = 'u'.repeat(300);

  it('nombra que sobran parametros, en espanol y con el numero', () => {
    let capturado: unknown = null;
    try {
      pipe.transform({ nombre: 'Aji', cantidad: '2', utm_source: 'boletin', gclid: 'x' });
    } catch (error) {
      capturado = error;
    }

    expect(capturado).toBeInstanceOf(EntradaInvalidaError);
    expect((capturado as Error).message).toContain('sobran parametros (2)');
    expect((capturado as Error).message).toContain('utm_source');
  });

  it('recorta la clave sobrante: el mensaje no devuelve la peticion entera', () => {
    let capturado: unknown = null;
    try {
      pipe.transform({ nombre: 'Aji', cantidad: '2', [CLAVE_LARGA]: '1' });
    } catch (error) {
      capturado = error;
    }

    expect((capturado as Error).message).not.toContain(CLAVE_LARGA);
    expect((capturado as Error).message.length).toBeLessThan(CLAVE_LARGA.length);
  });

  it('y la limpia: una clave con un control no parte la linea del log en dos', () => {
    let capturado: unknown = null;
    try {
      pipe.transform({ nombre: 'Aji', cantidad: '2', [`sobra${NUL}`]: '1' });
    } catch (error) {
      capturado = error;
    }

    expect((capturado as Error).message).not.toContain(NUL);
  });
});
