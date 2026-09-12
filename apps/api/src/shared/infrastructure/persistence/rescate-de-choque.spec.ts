/**
 * Las tres ramas del rescate de un choque de lote, con la base apagada.
 *
 * Existen porque la carrera que rescatan **no se puede provocar a voluntad**
 * contra PostgreSQL: entre la lectura de nombres y el `createMany` cabe otra
 * transacción, y esperar a que ocurra no es una prueba. Aquí el `P2002` se
 * inyecta, que es la única forma de fijar el comportamiento.
 *
 * La rama que más importa es la tercera —la relectura vacía—: tiene que
 * relanzar el error ORIGINAL y no devolver una lista de choques vacía, porque
 * un «estos ya existen: » sin nombres manda a buscar donde no hay nada.
 */

import { describe, expect, it, vi } from 'vitest';

import { aPruebaDeChoques, esViolacionDeUnico } from './rescate-de-choque';

/** Lo que Prisma lanza al violarse una restricción única: un `Error` con `code`. */
class ErrorDeDuplicado extends Error {
  public readonly code = 'P2002';

  public constructor() {
    super('Unique constraint failed on the fields: (`company_id`,`name`)');
  }
}

const DUPLICADO = new ErrorDeDuplicado();

type Desenlace = { readonly clase: 'escrito' } | { readonly clase: 'chocan'; readonly nombres: readonly string[] };

function alChocar(nombres: readonly string[]): Desenlace {
  return { clase: 'chocan', nombres };
}

describe('esViolacionDeUnico', () => {
  it('reconoce el P2002 por su forma, y nada más', () => {
    expect(esViolacionDeUnico(DUPLICADO)).toBe(true);
    expect(esViolacionDeUnico({ code: 'P2002' })).toBe(true);
    expect(esViolacionDeUnico({ code: 'P2003' })).toBe(false);
    expect(esViolacionDeUnico(new Error('P2002'))).toBe(false);
    expect(esViolacionDeUnico(null)).toBe(false);
    expect(esViolacionDeUnico('P2002')).toBe(false);
  });
});

describe('aPruebaDeChoques', () => {
  it('si la escritura entra, devuelve su resultado y NO relee', async () => {
    const releer = vi.fn<() => Promise<readonly string[]>>();

    const resultado = await aPruebaDeChoques<Desenlace>({
      entrantes: ['Harina'],
      escribir: () => Promise.resolve<Desenlace>({ clase: 'escrito' }),
      releer,
      alChocar,
    });

    expect(resultado).toEqual({ clase: 'escrito' });
    expect(releer).not.toHaveBeenCalled();
  });

  it('un error que no es de duplicado se relanza tal cual, sin releer', async () => {
    const releer = vi.fn<() => Promise<readonly string[]>>();
    const roto = new Error('la conexión se cayó');

    await expect(
      aPruebaDeChoques<Desenlace>({
        entrantes: ['Harina'],
        escribir: () => Promise.reject(roto),
        releer,
        alChocar,
      }),
    ).rejects.toBe(roto);
    expect(releer).not.toHaveBeenCalled();
  });

  it('con el P2002, la relectura dice QUÉ nombres sobran', async () => {
    const resultado = await aPruebaDeChoques<Desenlace>({
      entrantes: ['Harina', 'Azúcar'],
      escribir: () => Promise.reject(DUPLICADO),
      releer: () => Promise.resolve(['Azúcar', 'Sal']),
      alChocar,
    });

    expect(resultado).toEqual({ clase: 'chocan', nombres: ['Azúcar'] });
  });

  /**
   * LA RAMA QUE NO ES OBVIA. El `P2002` puede venir de otro índice —otra
   * columna, otra tabla de la misma transacción—, y entonces ninguno de los
   * nombres entrantes está repetido.
   */
  it('si la relectura no encuentra ninguno, relanza el error ORIGINAL', async () => {
    const promesa = aPruebaDeChoques<Desenlace>({
      entrantes: ['Harina'],
      escribir: () => Promise.reject(DUPLICADO),
      releer: () => Promise.resolve(['Azúcar', 'Sal']),
      alChocar,
    });

    await expect(promesa).rejects.toBe(DUPLICADO);
  });

  /**
   * El choque se decide con `clavePorNombre`, que es MÁS ESTRICTO que el
   * índice único de la base: este caso no habría dado `P2002`, pero una vez
   * dado, el nombre que se nombra es el del archivo, no el de la base.
   */
  it('compara sin distinguir mayúsculas ni espacios de sobra', async () => {
    const resultado = await aPruebaDeChoques<Desenlace>({
      entrantes: ['  HARINA ya 2kg  '],
      escribir: () => Promise.reject(DUPLICADO),
      releer: () => Promise.resolve(['Harina Ya 2kg']),
      alChocar,
    });

    expect(resultado).toEqual({ clase: 'chocan', nombres: ['HARINA ya 2kg'] });
  });
});
