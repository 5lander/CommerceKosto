/**
 * El destino de una receta, sacado de los parámetros de consulta.
 *
 * Exactamente uno de los dos tiene que venir. Vive aparte porque lo usan dos
 * controladores —la receta vigente y sus versiones— y copiarlo son dos sitios
 * donde decidir qué pasa si vienen los dos.
 */

import { itemId, productId } from '../../../../shared/domain/identity/identificadores';
import type { DestinoDeReceta } from '../../application/ports/repositorio-de-recetas.port';
import { RecetaInvalidaError } from '../../domain/errores';

export function destinoDeConsulta(consulta: {
  readonly productId?: string | undefined;
  readonly itemId?: string | undefined;
}): DestinoDeReceta {
  if (consulta.productId !== undefined && consulta.itemId === undefined) {
    return { clase: 'producto', productId: productId(consulta.productId) };
  }
  if (consulta.itemId !== undefined && consulta.productId === undefined) {
    return { clase: 'item', itemId: itemId(consulta.itemId) };
  }
  throw new RecetaInvalidaError('Indica productId o itemId, exactamente uno de los dos.');
}
