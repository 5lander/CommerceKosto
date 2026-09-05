/**
 * Las transiciones de un período — D6.
 *
 * **LA AUSENCIA DE FILA ES EL ESTADO ABIERTO.** Un mes del que nadie se ha
 * ocupado todavía no tiene fila en `period`, y eso significa abierto. La
 * alternativa —exigir que alguien abra el mes antes de poder registrar nada—
 * falla cerrado en el sitio equivocado: una company recién creada no podría
 * anotar su primera compra hasta que alguien recordara abrir el mes, y el
 * primer día de cada mes el sistema dejaría de funcionar solo.
 *
 * Cerrar es un acto explícito. Bloquear el libro también debe serlo.
 */

import {
  PeriodoCerradoError,
  PeriodoNoCerradoError,
  PeriodoNoTerminadoError,
  PeriodoYaCerradoError,
} from './errores';
import type { Periodo } from './periodo';

export type EstadoDePeriodo = 'ABIERTO' | 'CERRADO';

export const ABIERTO: EstadoDePeriodo = 'ABIERTO';
export const CERRADO: EstadoDePeriodo = 'CERRADO';

/**
 * ¿Se puede cerrar este mes?
 *
 * @throws {PeriodoYaCerradoError} @throws {PeriodoNoTerminadoError}
 */
export function exigirCerrable(entrada: {
  readonly periodo: Periodo;
  readonly estadoActual: EstadoDePeriodo;
  readonly ahora: Date;
}): void {
  if (entrada.estadoActual === CERRADO) {
    throw new PeriodoYaCerradoError(entrada.periodo.etiqueta);
  }
  if (!entrada.periodo.haTerminado(entrada.ahora)) {
    throw new PeriodoNoTerminadoError(entrada.periodo.etiqueta);
  }
}

/** @throws {PeriodoNoCerradoError} */
export function exigirReabrible(entrada: {
  readonly periodo: Periodo;
  readonly estadoActual: EstadoDePeriodo;
}): void {
  if (entrada.estadoActual !== CERRADO) {
    throw new PeriodoNoCerradoError(entrada.periodo.etiqueta);
  }
}

/**
 * Un mes cerrado no admite datos nuevos, y eso no es solo el libro.
 *
 * Las unidades vendidas y los costos fijos de P8 tambien caen aqui: si la cifra
 * de ventas de un mes sellado pudiera cambiar, el food cost real de ese mes
 * cambiaria con ella, y ese mes ya se informo.
 *
 * **NO HAY TRIGGER DE RESPALDO PARA ESAS DOS TABLAS**, a diferencia del libro:
 * el vinculo con el periodo es una clave foranea, y un `CHECK` no puede
 * seguirla. Esta guarda es lo unico que las protege.
 *
 * @throws {PeriodoCerradoError}
 */
export function exigirAbierto(entrada: {
  readonly periodo: Periodo;
  readonly estadoActual: EstadoDePeriodo;
}): void {
  if (entrada.estadoActual === CERRADO) {
    throw new PeriodoCerradoError(entrada.periodo.etiqueta);
  }
}
