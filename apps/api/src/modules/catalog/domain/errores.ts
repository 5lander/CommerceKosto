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
import { mensajeDeProblemas, type ProblemaDelLote } from '../../../shared/domain/lote/problemas';

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

/**
 * Un LOTE que no se puede escribir, con todos sus problemas dentro.
 *
 * Es `ENTRADA_INVALIDA` y no `CONFLICTO` aunque algunos de sus motivos sean
 * nombres repetidos: lo que se rechaza es el ARCHIVO, y un archivo con una fila
 * repetida está mal formado, no en conflicto con el estado de la base.
 *
 * **Lleva los problemas, no solo el primero.** Quien migra un catálogo arregla
 * el archivo entero de una pasada; devolverle un error por reintento convierte
 * una tarde en tres.
 */
export class LoteDeCatalogoInvalidoError extends EntradaDeCatalogoInvalidaError {
  public constructor(public readonly problemas: readonly ProblemaDelLote[]) {
    super(mensajeDeProblemas(problemas));
  }
}

export class ArticuloNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese artículo de compra no existe en tu company.');
  }
}

export class GrupoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese grupo no existe en tu company.');
  }
}
