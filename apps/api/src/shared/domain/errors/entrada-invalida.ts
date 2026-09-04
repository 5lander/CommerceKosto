/**
 * Lo que el cliente mando no cumple el esquema.
 *
 * EL DETALLE SI SALE, y aqui no hay contradiccion con "el mensaje al usuario y
 * el detalle del log son cosas distintas": lo que sale describe LA PETICION DEL
 * PROPIO CLIENTE —que campo falta, cual sobra— y no revela nada del interior
 * del sistema. Ocultarlo no protegeria nada y convertiria cada error de
 * integracion en una sesion de adivinanzas.
 */

import { ErrorDeDominio, type CodigoDeDominio } from './error-de-dominio';

export class EntradaInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(problemas: readonly string[]) {
    super(`Peticion invalida: ${problemas.join('; ')}`, { problemas: problemas.join('; ') });
  }
}
