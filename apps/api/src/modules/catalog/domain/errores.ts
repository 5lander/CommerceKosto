/**
 * Errores de `catalog`. Todos son de dominio: no saben de HTTP.
 *
 * Aquí los mensajes SÍ salen tal cual, al contrario que en el login. La razón
 * es la asimetría de siempre: quien captura un ítem ya está autenticado y
 * dentro de su company, así que decirle «el rendimiento va entre 0 y 1» no
 * revela nada a nadie y le ahorra una tarde. Callar solo tiene sentido cuando
 * el que pregunta puede no ser quien dice ser.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

export class EntradaDeCatalogoInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

/**
 * Un nombre repetido. Sale como 409 y no como 400 porque la peticion esta bien
 * formada: lo que choca es el estado que ya hay en la base.
 */
export class ConflictoDeCatalogoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';
}

export class ItemNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese ítem no existe en tu company.');
  }
}
