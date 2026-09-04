/**
 * Los tres casos de uso de propagacion, empaquetados como una dependencia.
 *
 * Misma razon que `RolesDeUsuario`, `GestionDeGrupos` y `ResolucionYCosto`: el
 * limite son tres parametros por constructor (CLAUDE.md §3), y los tres son el
 * mismo recurso —previsualizar, propagar, revertir— visto en tres momentos.
 *
 * En su propio archivo por la razon de P1: `emitDecoratorMetadata` evalua los
 * tipos del constructor EN EL MOMENTO de definir la clase decorada, asi que una
 * clase declarada despues en el mismo archivo revienta al arrancar.
 */

import {
  PrevisualizarPropagacion,
  PropagarReceta,
  RevertirPropagacion,
} from '../../application/casos-de-uso/propagacion';

export class Propagacion {
  public constructor(
    public readonly previsualizar: PrevisualizarPropagacion,
    public readonly propagar: PropagarReceta,
    public readonly revertir: RevertirPropagacion,
  ) {}
}
