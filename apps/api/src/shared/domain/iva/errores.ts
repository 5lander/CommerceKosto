/**
 * Errores del IVA de compra. De dominio: no saben de HTTP.
 *
 * Los dos son `ENTRADA_INVALIDA` (400) y los dos llevan el mensaje completo:
 * quien registra una compra ya está dentro de su company, y decirle DÓNDE
 * poner la tarifa le ahorra una tarde sin revelar nada a nadie.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../errors/error-de-dominio';

/**
 * Ningún nivel define la tarifa: ni el cuerpo, ni el artículo, ni el grupo.
 *
 * **NO SE ASUME NINGUNA** (D-16.9). El mensaje dice los tres sitios donde
 * ponerla, en el orden en que se leen.
 */
export class TarifaDeIvaDesconocidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super(
      'No hay tarifa de IVA para esta compra y nunca se asume una. Mándala en el cuerpo ' +
        '(«ivaTarifa»), o fíjala en el artículo de compra (PUT /catalogo/articulos/:id) ' +
        'o en el grupo del ítem (PUT /catalogo/grupos/:id).',
    );
  }
}

/** Un IVA de 15 donde va 0.15 multiplicaría el costo por dieciséis al revés. */
export class TarifaDeIvaInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(tarifa: string) {
    super(
      `La tarifa de IVA «${tarifa}» no es una fracción: va entre 0 y 1. Un IVA se escribe 0.15, no 15.`,
      { tarifa },
    );
  }
}
