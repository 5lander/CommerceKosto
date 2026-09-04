/**
 * Errores de `recipes`. Todos de dominio: no saben de HTTP.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

export class RecetaInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

export class ProductoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese producto no existe en tu company.');
  }
}

export class PropagacionNoEncontradaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Esa propagación no existe en tu company.');
  }
}

/**
 * La escalada horizontal aplicada a recetas.
 *
 * RLS garantiza que no se vean recetas de otra company; no sabe nada de que un
 * `GERENTE_LOCAL` solo puede tocar la suya. Sale como 403 y no como 404 porque
 * quien pregunta **sí** pertenece a la company: lo que le falta es alcance, y
 * decírselo no revela nada que no supiera.
 */
export class PropagacionYaRevertidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super('Esa propagación ya fue revertida.');
  }
}
