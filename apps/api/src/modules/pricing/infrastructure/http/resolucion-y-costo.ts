/**
 * Resolver un precio y costear un item, empaquetados como una dependencia.
 *
 * Misma razon que `RolesDeUsuario` y `GestionDeGrupos`: el limite son tres
 * parametros por constructor (CLAUDE.md §3). Y vive en su propio archivo por la
 * razon que costo descubrir en P1: `emitDecoratorMetadata` evalua los tipos del
 * constructor EN EL MOMENTO de definir la clase decorada, asi que una clase
 * declarada despues en el mismo archivo revienta al arrancar.
 */

import { CostoDeItem, ResolverPrecio } from '../../application/casos-de-uso/precios';

export class ResolucionYCosto {
  public constructor(
    public readonly resolver: ResolverPrecio,
    public readonly costo: CostoDeItem,
  ) {}
}
