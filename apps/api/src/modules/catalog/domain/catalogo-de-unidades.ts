/**
 * Buscar una unidad en el catálogo, y explicar bien cuando no está.
 *
 * **POR QUÉ EXISTE ESTE ARCHIVO: INC-012.** `unidadDeUso()` comprueba la FORMA
 * del código —minúsculas, corto, sin espacios— y por eso deja pasar `"l"`, que
 * está perfectamente formado y no existe: el litro es `lt`. Esa fila llegaba
 * hasta el `INSERT` y reventaba con
 * `Foreign key constraint violated on the constraint: "item_unit_of_use_fkey"`,
 * que sale como **500** y no dice ni qué columna ni cuáles son las buenas. La
 * clave foránea sigue siendo la garantía; esto es la explicación.
 *
 * **LA MISMA COMPROBACIÓN ESTABA ESCRITA TRES VECES** —el alta de artículo, el
 * lote de ítems y el lote de artículos— con tres mensajes distintos y solo uno
 * de ellos enumerando las unidades válidas, que es el dato que hace falta para
 * corregir. Aquí está una vez, con el mensaje bueno, y las tres la llaman. El
 * alta suelta de ítem, que no comprobaba nada, es la cuarta.
 *
 * ES DOMINIO PURO: entra la lista que el repositorio leyó y un código; sale la
 * unidad, `null` o un error tipado. No consulta nada.
 */

import type { UnidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import type { UnidadDelCatalogo } from './conversion';
import { EntradaDeCatalogoInvalidaError } from './errores';

/** La unidad, o `null` si el catálogo no la tiene. */
export function buscarUnidad(
  catalogo: readonly UnidadDelCatalogo[],
  codigo: UnidadDeUso,
): UnidadDelCatalogo | null {
  return catalogo.find((unidad) => unidad.codigo === codigo) ?? null;
}

/**
 * El motivo, con la lista de unidades válidas dentro.
 *
 * La lista va ordenada y completa a propósito: son diez códigos cortos, y quien
 * escribió `l` necesita ver `lt` para arreglarlo sin abrir otra pantalla. Es la
 * diferencia entre un mensaje que se lee y uno que se reenvía a soporte.
 */
export function mensajeDeUnidadDesconocida(
  catalogo: readonly UnidadDelCatalogo[],
  codigo: string,
): string {
  const validas = catalogo
    .map((unidad) => unidad.codigo as string)
    .sort()
    .join(', ');

  return `La unidad "${codigo}" no está en el catálogo. Las válidas son: ${validas}.`;
}

/**
 * La unidad, o un 400 con el motivo.
 *
 * Lanza en vez de devolver `null` porque quien pide UNA unidad —el alta de un
 * ítem, el alta de un artículo— no tiene nada sensato que hacer con la
 * ausencia salvo rechazar. Quien valida un LOTE usa `buscarUnidad` y
 * `mensajeDeUnidadDesconocida` por separado, para poder recoger todas las
 * filas malas en una pasada en vez de parar en la primera.
 *
 * @throws {EntradaDeCatalogoInvalidaError}
 */
export function exigirUnidad(
  catalogo: readonly UnidadDelCatalogo[],
  codigo: UnidadDeUso,
): UnidadDelCatalogo {
  const encontrada = buscarUnidad(catalogo, codigo);
  if (encontrada === null) {
    throw new EntradaDeCatalogoInvalidaError(mensajeDeUnidadDesconocida(catalogo, codigo));
  }
  return encontrada;
}
