/**
 * Errores de `recipes`. Todos de dominio: no saben de HTTP.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

export class RecetaInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';
}

/**
 * Un nombre de producto repetido DENTRO de la company (D-16.194).
 *
 * Sale como 409 y no como 400 —igual que el nombre repetido del catálogo— porque
 * la petición está bien formada: lo que choca es el estado que ya hay. Y choca
 * solo dentro de la company: el índice es `product_company_id_name_key`, por
 * `(company_id, name)`, así que dos clientes pueden vender los dos su «Arroz
 * marinero» sin enterarse el uno del otro.
 */
export class ProductoRepetidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor() {
    super('Ya existe un producto con ese nombre.');
  }
}

export class ProductoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese producto no existe en tu company.');
  }
}

/**
 * El ítem que se quiere poner de empaque no existe en la company (D-16.112).
 *
 * ES 400 Y NO 404. La ruta —`PUT /productos/:id/empaque`— existe y el producto
 * también; lo que falla es una referencia DENTRO del cuerpo. Hasta P16-B salía
 * como «ese producto no existe», que mandaba a buscar el error en el sitio
 * equivocado.
 */
export class EmpaqueNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super('Ese ítem de empaque no existe en tu company.');
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
