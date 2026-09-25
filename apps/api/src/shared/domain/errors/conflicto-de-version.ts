/**
 * Otra persona escribió el mismo agregado entre que este formulario lo leyó y
 * lo guardó — concurrencia optimista, D-16.11, ADR-023.
 *
 * VIVE EN `shared` PORQUE LO LANZAN TRES MÓDULOS: `catalog` (el ítem), `recipes`
 * (el producto y la receta) y, desde P16-C, `analytics` (la carga del mes). Es la misma regla rota con el mismo remedio, y dos
 * clases con el mismo `codigo` y el mismo texto son justo lo que
 * `audit:duplication` persigue.
 *
 * ES 409 Y NO 412. `412 Precondition Failed` es lo canónico cuando la versión
 * viaja en `If-Match`; aquí viaja en el cuerpo (D-16.100), y lo que el cliente
 * tiene que entender no es «tu cabecera no casa» sino «el estado cambió». Un
 * 409 con su propio `code` lo dice sin ambigüedad, y no se confunde con el
 * `CONFLICTO` genérico —un nombre repetido—, que se arregla cambiando el
 * nombre y no recargando.
 *
 * EL CUERPO NO TRAE LA VERSIÓN ACTUAL (D-16.104), y es a propósito. Con el
 * número dentro, lo fácil es reenviar con él y pisar lo que el otro acaba de
 * escribir: que es exactamente el cambio perdido que este error existe para
 * impedir. El cliente tiene que volver a leer el estado ENTERO.
 */

import { ErrorDeDominio, type CodigoDeDominio } from './error-de-dominio';

/** Qué se estaba editando: decide las palabras del mensaje, nada más. */
export type AgregadoVersionado = 'producto' | 'ítem' | 'receta' | 'carga del mes';

/**
 * CON SU ARTÍCULO, Y POR ESO UN REGISTRO Y NO UNA INTERPOLACIÓN. Hasta P16-C el
 * mensaje era «cambió este ${agregado}» y la receta salía como «este receta»; la
 * carga del mes, que llega aquí, no cabe en «este …» de ninguna forma.
 */
const LO_QUE_CAMBIO: Readonly<Record<AgregadoVersionado, string>> = {
  producto: 'este producto',
  'ítem': 'este ítem',
  receta: 'esta receta',
  'carga del mes': 'la carga de este mes',
};

export class ConflictoDeVersionError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO_DE_VERSION';

  public constructor(agregado: AgregadoVersionado) {
    super(
      `Alguien más cambió ${LO_QUE_CAMBIO[agregado]} mientras lo editabas. ` +
        'Recarga para ver lo que hay ahora y vuelve a aplicar tus cambios.',
      { agregado },
    );
  }
}
