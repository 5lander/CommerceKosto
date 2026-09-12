/**
 * El desenlace de una escritura con concurrencia optimista — D-16.100, ADR-023.
 *
 * VIVE EN `shared/application` PORQUE ES PARTE DE DOS PUERTOS: el del catálogo
 * (el ítem) y el de recetas (el producto). Los repositorios lo devuelven y los
 * casos de uso lo traducen a error; ninguno de los dos necesita saber cómo se
 * comprobó.
 *
 * TRES DESENLACES Y NO DOS, y el tercero es el que importa. Con un `boolean`,
 * «no existe» y «existe pero alguien lo cambió» serían el mismo `false`, y el
 * usuario recibiría un 404 sobre el producto que tiene delante en la pantalla
 * —o un 409 sobre uno que otra persona archivó—. Son dos cosas distintas que
 * se arreglan distinto.
 */

export type DesenlaceVersionado =
  /** Escrito. `version` es la NUEVA, la que el formulario debe usar en la próxima escritura. */
  | { readonly clase: 'escrito'; readonly version: number }
  | { readonly clase: 'no_encontrado' }
  /** Existe, y su versión ya no es la que el formulario leyó. */
  | { readonly clase: 'conflicto_de_version' };
