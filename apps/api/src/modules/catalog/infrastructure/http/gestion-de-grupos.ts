/**
 * Crear y listar grupos, empaquetados como una sola dependencia.
 *
 * Misma razón que `RolesDeUsuario` en `iam`: el límite son tres parámetros por
 * constructor (CLAUDE.md §3) y agrupar los dos casos de uso que **son** el
 * mismo recurso es mejor que partirlo en un controlador de veinte líneas con la
 * misma cabecera.
 *
 * Y vive en su propio archivo por la razón que costó descubrir en P1:
 * `emitDecoratorMetadata` evalúa los tipos del constructor **en el momento** de
 * definir la clase decorada. Con las dos clases en el mismo archivo y esta
 * declarada después, eso revienta con «Cannot access before initialization» al
 * arrancar, no al compilar.
 */

import { CrearGrupo, ListarGrupos } from '../../application/casos-de-uso/items';

export class GestionDeGrupos {
  public constructor(
    public readonly crear: CrearGrupo,
    public readonly listar: ListarGrupos,
  ) {}
}
