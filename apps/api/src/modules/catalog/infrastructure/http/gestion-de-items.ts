/**
 * Crear, listar y actualizar ítems, empaquetados como una sola dependencia.
 *
 * Misma razón y mismo patrón que `GestionDeArticulos` y `GestionDeGrupos`: el
 * límite son tres parámetros por constructor (CLAUDE.md §3), y con la ficha de
 * P16-A2 el controlador de ítems necesitaría cuatro.
 *
 * **LA FICHA SE QUEDA FUERA DEL GRUPO, Y NO ES UN DESCUIDO.** Meterla aquí
 * dejaría este envoltorio en el límite y el siguiente añadido volvería a partir
 * el controlador; con la ficha aparte, el controlador tiene dos parámetros y
 * sitio para uno más. Además son dos cosas distintas: esto es el recurso
 * `items` como colección, aquello es un ítem con todo lo que le cuelga.
 *
 * Y en su propio archivo por lo que costó descubrir en P1: `emitDecoratorMetadata`
 * evalúa los tipos del constructor **al definir** la clase decorada, y una
 * clase declarada después en el mismo archivo revienta al arrancar con «Cannot
 * access before initialization».
 */

import { ActualizarItem, CrearItem, ListarItems } from '../../application/casos-de-uso/items';

export class GestionDeItems {
  public constructor(
    public readonly crear: CrearItem,
    public readonly listar: ListarItems,
    public readonly actualizar: ActualizarItem,
  ) {}
}
