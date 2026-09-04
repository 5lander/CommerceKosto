/**
 * Errores de `costing`. Todos de dominio: no saben de HTTP.
 *
 * Los dos de la cascada —`CicloEnCascadaError` e `ItemFueraDelCatalogoError`—
 * viven en `cascada.ts`, junto a la regla que los levanta.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/**
 * Se pidió el costeo de un producto que no existe en la company.
 *
 * No distingue «no existe» de «no está en esta ubicación» a propósito: un
 * producto sin fila en `product_location` **sí** se costea (el costo no depende
 * del local salvo por el PVP) y sale marcado como inactivo. Si aquí no está, es
 * que el producto no existe.
 */
export class ProductoSinCosteoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese producto no existe en tu company.');
  }
}
