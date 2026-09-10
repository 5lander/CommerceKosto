/**
 * Crear, listar y actualizar artículos, empaquetados como una sola dependencia.
 *
 * Misma razón que `GestionDeGrupos`: el límite son tres parámetros por
 * constructor (CLAUDE.md §3), y con el `PUT` de P16-A1 el controlador de
 * artículos y grupos necesitaría cinco. Agrupar los casos de uso que **son** el
 * mismo recurso es mejor que partir el controlador.
 *
 * Y en su propio archivo por lo que costó descubrir en P1: `emitDecoratorMetadata`
 * evalúa los tipos del constructor **al definir** la clase decorada, y una
 * clase declarada después en el mismo archivo revienta al arrancar con «Cannot
 * access before initialization».
 */

import {
  ActualizarArticulo,
  CrearArticulo,
  ListarArticulos,
} from '../../application/casos-de-uso/articulos';

export class GestionDeArticulos {
  public constructor(
    public readonly crear: CrearArticulo,
    public readonly listar: ListarArticulos,
    public readonly actualizar: ActualizarArticulo,
  ) {}
}
