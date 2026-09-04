/**
 * El interceptor de timeout se prueba en unitarias porque no necesita HTTP ni
 * base de datos: recibe un `Observable` y decide cuando cortarlo.
 */

import { RequestTimeoutException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { type Observable, firstValueFrom, of, timer } from 'rxjs';
import { map } from 'rxjs/operators';
import { describe, expect, it } from 'vitest';

import type { Configuration } from '../config/environment';
import { TimeoutInterceptor } from './timeout.interceptor';

const TIMEOUT_MS = 20;
const MAS_LENTO_QUE_EL_TIMEOUT_MS = 200;

const config = { requestTimeoutMs: TIMEOUT_MS } as Configuration;
const contexto = {} as ExecutionContext;

function manejador(observable: Observable<unknown>): CallHandler {
  return { handle: () => observable };
}

describe('TimeoutInterceptor', () => {
  it('deja pasar una respuesta que llega a tiempo', async () => {
    const interceptor = new TimeoutInterceptor(config);

    const resultado = await firstValueFrom(
      interceptor.intercept(contexto, manejador(of('a tiempo'))),
    );

    expect(resultado).toBe('a tiempo');
  });

  it('corta la que tarda de mas, y lo hace con un 408', async () => {
    const interceptor = new TimeoutInterceptor(config);
    const lento = timer(MAS_LENTO_QUE_EL_TIMEOUT_MS).pipe(map(() => 'tarde'));

    await expect(firstValueFrom(interceptor.intercept(contexto, manejador(lento)))).rejects.toThrow(
      RequestTimeoutException,
    );
  });

  it('no convierte en timeout un error que no lo es', async () => {
    // Si el `catchError` no distinguiera, todo fallo de la aplicacion saldria
    // como 408 y el diagnostico apuntaria siempre al sitio equivocado.
    const interceptor = new TimeoutInterceptor(config);
    const rota = timer(0).pipe(
      map(() => {
        throw new Error('fallo de dominio');
      }),
    );

    await expect(firstValueFrom(interceptor.intercept(contexto, manejador(rota)))).rejects.toThrow(
      'fallo de dominio',
    );
  });
});
