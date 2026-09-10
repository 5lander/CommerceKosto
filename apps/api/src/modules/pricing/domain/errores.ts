/**
 * Errores de `pricing`. Todos de dominio: no saben de HTTP.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';
import { mensajeDeProblemas, type ProblemaDelLote } from '../../../shared/domain/lote/problemas';

export class PrecioNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese precio o ese ítem no existe en tu company.');
  }
}

/**
 * Dos administradores que confirman a la vez: gana uno y el otro se entera.
 *
 * Responder 204 a los dos dejaría a alguien creyendo que confirmó lo que en
 * realidad rechazó el otro, y sobre ese precio se calculan todos los costos.
 */
export class ConflictoDePrecioError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';
}

/**
 * No es un fallo: es el estado normal de un ítem recién creado.
 *
 * Sale como 404 y no como 500 porque la pregunta «¿cuánto cuesta?» tiene una
 * respuesta legítima —«todavía nada»— y quien la recibe tiene algo que hacer
 * con ella: capturar un precio.
 */
export class ItemSinPrecioError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';
}

export class AjustesInvalidosError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

/**
 * Una preparación con IVA de compra distinto de cero (D-16.51). Su precio es
 * el costo estándar, ya neto (R10): netearlo otra vez subcostearía el plato.
 */
export class PreparacionConIvaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

/** Un lote de precios que no se puede escribir, con todos sus problemas dentro. */
export class LoteDePreciosInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(public readonly problemas: readonly ProblemaDelLote[]) {
    super(mensajeDeProblemas(problemas));
  }
}
