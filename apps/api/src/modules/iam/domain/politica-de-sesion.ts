/**
 * Vigencia de una sesion — SEGURIDAD.md §2.2.
 *
 * DOS LIMITES, Y HACEN FALTA LOS DOS:
 *
 *   ABSOLUTO (12 h)      la sesion muere aunque se use sin parar. Es lo que
 *                        acota el dano de un token robado que el ladron
 *                        mantiene vivo a base de usarlo.
 *
 *   INACTIVIDAD (4 h)    la sesion muere si nadie la usa. Es lo que cierra la
 *                        tablet olvidada sobre la mesa de una cocina.
 *
 * POR QUE 4 HORAS Y NO 30 MINUTOS. Porque el producto se usa de pie, en una
 * cocina o una bodega (CLAUDE.md §10), en turnos de varias horas con
 * interrupciones largas. Una sesion que caduca cada media hora no produce
 * seguridad: produce contrasenas escritas en un papel pegado al monitor, que es
 * un fallo peor y ademas invisible. El limite absoluto de 12 h —un turno— es el
 * que pone el techo duro.
 *
 * ES DOMINIO PURO: recibe fechas, devuelve una decision. Ni base de datos, ni
 * reloj del sistema.
 */

const HORA_MS = 3_600_000;

const HORAS_DE_VIDA_ABSOLUTA = 12;
const HORAS_DE_INACTIVIDAD = 4;

export const VIDA_ABSOLUTA_MS = HORAS_DE_VIDA_ABSOLUTA * HORA_MS;
export const INACTIVIDAD_MAXIMA_MS = HORAS_DE_INACTIVIDAD * HORA_MS;

export interface VigenciaDeSesion {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export type EstadoDeSesion = 'vigente' | 'revocada' | 'caducada' | 'inactiva';

/** Momento en que caduca una sesion abierta ahora. */
export function caducidadDesde(ahora: Date): Date {
  return new Date(ahora.getTime() + VIDA_ABSOLUTA_MS);
}

/**
 * El orden de las comprobaciones importa para el diagnostico, no para la
 * seguridad: revocada primero porque es la unica que alguien decidio a mano, y
 * confundirla con una caducidad manda a soporte a mirar el sitio equivocado.
 */
export function estadoDeSesion(sesion: VigenciaDeSesion, ahora: Date): EstadoDeSesion {
  if (sesion.revokedAt !== null) {
    return 'revocada';
  }
  if (ahora.getTime() >= sesion.expiresAt.getTime()) {
    return 'caducada';
  }
  if (ahora.getTime() - sesion.lastSeenAt.getTime() >= INACTIVIDAD_MAXIMA_MS) {
    return 'inactiva';
  }
  return 'vigente';
}
