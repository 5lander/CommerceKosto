/**
 * El desenlace de una escritura EN LOTE.
 *
 * **UNIÓN, NO EXCEPCIÓN**, por lo mismo que `ResultadoDeAlta` en `catalog`: que
 * un nombre ya exista no es un fallo del programa, es algo que pasa todos los
 * días al capturar un catálogo. Modelarlo en el tipo obliga a tratarlo; un
 * `throw` se olvida.
 *
 * **LO COMPARTEN LOS CUATRO MÓDULOS QUE RECIBEN LOTES** —`catalog`, `pricing`,
 * `recipes` e `inventory`—, y por eso vive en `shared/application` y no en el
 * puerto de uno de ellos: si viviera en `catalog`, los otros tres tendrían que
 * importarlo de allí y `audit:arch` lo pararía, con razón.
 */

export type ResultadoDeLote =
  | { readonly clase: 'escrito'; readonly filas: number }
  /**
   * Nada se escribió. `nombres` son los que ya existían en la company: se
   * devuelven TODOS, no el primero, porque quien migra quiere la lista para
   * decidir de una vez si renombra, si omite o si aborta.
   */
  | { readonly clase: 'nombres_en_uso'; readonly nombres: readonly string[] };
