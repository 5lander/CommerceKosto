/**
 * El limite de tasa de los endpoints que escriben sin sesion o mandan correo
 * — D-16.17, D-16.24, D-16.50; SEGURIDAD.md §2.1.
 *
 * CUATRO SUPERFICIES, DOS EJES. Cada `kind` es un endpoint y lleva su politica
 * por IP y, si tiene sentido, por destinatario:
 *
 *   password.olvido            IP 10/h · destinatario 3/h
 *   password.restablecimiento  IP 10/h
 *   usuario.invitar            IP 30/h · destinatario 3/h
 *   usuario.reenvio            IP 30/h · destinatario 3/h
 *
 * POR QUE DOS EJES. El de IP corta a quien enumera: con `/olvido` respondiendo
 * 202 exista o no el correo, lo unico que le queda a un atacante es el canal
 * de tiempo (ADR-025), y diez muestras por hora no dan para medir nada. El de
 * destinatario corta la INUNDACION DE UN BUZON: sin el, cualquiera podria
 * mandarle a un usuario un enlace de restablecimiento cada segundo desde mil
 * direcciones, y entrenarlo a ignorar el correo que un dia si importe.
 *
 * ES LA MISMA REGLA QUE EL LOGIN (`shared/domain/acceso`), con ventana de
 * una hora y un solo escalon de bloqueo de una hora: al superar el umbral, la
 * espera cuenta desde el ULTIMO golpe, asi que insistir la alarga.
 *
 * EL `kind` LO FIJA EL CODIGO, NUNCA UNA PETICION, y la base lo repite en el
 * CHECK `rate_limit_hit_kind_conocido`: anadir uno aqui sin anadirlo alli
 * falla en el primer golpe, en alto.
 */

import { MINUTO_MS, type PoliticaDeIntentos } from '../acceso/politica-de-intentos';
import { ErrorDeDominio, type CodigoDeDominio } from '../errors/error-de-dominio';

export type KindDeLimite =
  | 'password.olvido'
  | 'password.restablecimiento'
  | 'usuario.invitar'
  | 'usuario.reenvio';

export type EjeDeLimite = 'ip' | 'destinatario';

export interface PoliticaDeLimite {
  readonly ip: PoliticaDeIntentos;
  /** `null`: el endpoint no tiene destinatario (el restablecimiento lleva un token, no un correo). */
  readonly destinatario: PoliticaDeIntentos | null;
}

const MINUTOS_POR_HORA = 60;
const HORA_MS = MINUTOS_POR_HORA * MINUTO_MS;
const MINUTOS_DE_BLOQUEO = 60;

const IP_DE_CONTRASENA_POR_HORA = 10;
const IP_DE_INVITACION_POR_HORA = 30;
const POR_DESTINATARIO_POR_HORA = 3;

function porHora(umbral: number): PoliticaDeIntentos {
  return {
    umbral,
    ventanaDeDisparoMs: HORA_MS,
    ventanaDeEscaladaMs: HORA_MS,
    escalaDeBloqueoMinutos: [MINUTOS_DE_BLOQUEO],
  };
}

export const POLITICAS_DE_LIMITE: Readonly<Record<KindDeLimite, PoliticaDeLimite>> = {
  'password.olvido': {
    ip: porHora(IP_DE_CONTRASENA_POR_HORA),
    destinatario: porHora(POR_DESTINATARIO_POR_HORA),
  },
  'password.restablecimiento': {
    ip: porHora(IP_DE_CONTRASENA_POR_HORA),
    destinatario: null,
  },
  'usuario.invitar': {
    ip: porHora(IP_DE_INVITACION_POR_HORA),
    destinatario: porHora(POR_DESTINATARIO_POR_HORA),
  },
  'usuario.reenvio': {
    ip: porHora(IP_DE_INVITACION_POR_HORA),
    destinatario: porHora(POR_DESTINATARIO_POR_HORA),
  },
};

/**
 * Cuanto tiempo atras necesita mirar el registro. Vive junto a las politicas
 * por la misma razon que `VENTANA_A_CONSULTAR_MS` en el login: la consulta y
 * la regla no pueden separarse.
 */
export const VENTANA_DE_LIMITE_MS: number = HORA_MS;

const SEGUNDO_MS = 1_000;
const SEGUNDOS_POR_MINUTO = 60;

/**
 * 429 `LIMITE_DE_SOLICITUDES`. Es OTRO error que `ACCESO_BLOQUEADO` (el login)
 * y que `TOO_MANY_REQUESTS` (el limitador global): un cliente tiene que poder
 * distinguir "tu cuenta esta bloqueada" de "espera un momento" de "ya pediste
 * esto demasiadas veces".
 *
 * LLEVA `reintentarEnSegundos` para que el filtro emita `Retry-After`, y el
 * mensaje dice el minuto: es lo unico que un usuario legitimo necesita, y no
 * le da al atacante nada que no supiera (la ventana es publica: esta aqui).
 */
export class LimiteDeSolicitudesError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'LIMITE_DE_SOLICITUDES';

  /** Nunca menor que 1: un `Retry-After: 0` no es una espera. */
  public readonly reintentarEnSegundos: number;

  public constructor(entrada: {
    readonly kind: KindDeLimite;
    readonly bloqueadoHasta: Date;
    readonly ahora: Date;
  }) {
    const segundos = Math.max(
      1,
      Math.ceil((entrada.bloqueadoHasta.getTime() - entrada.ahora.getTime()) / SEGUNDO_MS),
    );
    const minutos = Math.max(1, Math.ceil(segundos / SEGUNDOS_POR_MINUTO));

    super(
      `Demasiadas solicitudes. Vuelve a intentarlo en ${String(minutos)} ${minutos === 1 ? 'minuto' : 'minutos'}.`,
      { kind: entrada.kind, bloqueadoHasta: entrada.bloqueadoHasta.toISOString() },
    );
    this.reintentarEnSegundos = segundos;
  }
}
