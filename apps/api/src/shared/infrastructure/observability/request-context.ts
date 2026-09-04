/**
 * Contexto de la solicitud en curso — el `correlation_id` de CLAUDE.md §13.
 *
 * POR QUE `AsyncLocalStorage` Y NO PASARLO POR PARAMETRO. El identificador de
 * correlacion tiene que aparecer en TODA linea de log y en TODA fila de
 * `audit_log` de una misma peticion. Propagarlo a mano significa anadirlo a la
 * firma de cada caso de uso y de cada repositorio; en la primera funcion donde
 * alguien se olvide, el rastro se corta justo en el punto que hacia falta
 * seguir. El almacen asincrono lo hace estructural en vez de disciplinado.
 *
 * POR QUE `enterWith` Y NO `run`. `run(store, callback)` necesita envolver el
 * resto de la peticion en un callback, y el unico sitio del arranque donde eso
 * seria posible es un middleware propio — que obligaria a garantizar que corre
 * ANTES que el de pino. El orden entre middlewares globales de distintos
 * modulos no es algo sobre lo que convenga apostar. `enterWith` establece el
 * contexto para el resto de la ejecucion sincrona actual y sus continuaciones
 * asincronas, que en una peticion HTTP es exactamente la cadena de manejadores,
 * y permite hacerlo desde `genReqId` — el primer punto del ciclo de vida donde
 * el identificador existe. Fuera de ese uso concreto no se emplea.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly correlationId: string;
}

const almacen = new AsyncLocalStorage<RequestContext>();

export function enterRequestContext(context: RequestContext): void {
  almacen.enterWith(context);
}

/**
 * @returns el contexto activo, o `null` fuera de una peticion (arranque,
 * trabajos en segundo plano, pruebas unitarias).
 */
export function currentRequestContext(): RequestContext | null {
  return almacen.getStore() ?? null;
}
