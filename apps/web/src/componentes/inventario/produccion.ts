'use client';

/**
 * Un lote de una preparación — `POST /inventario/producciones`.
 *
 * **LA RECETA DA LA LISTA DE INSUMOS, NO LAS CANTIDADES.** Podría precargar «lo
 * que la receta manda por este tamaño de lote», y hacerlo sería dos cosas malas
 * a la vez: multiplicar decimales en el navegador (CLAUDE.md §8), e invitar a
 * confirmar sin pesar. **La producción registra lo que DE VERDAD entró**, y de
 * la diferencia con el estándar sale la varianza de R10. Precargar el teórico
 * convertiría esa varianza en cero por construcción, que es justo la mentira que
 * el sistema existe para no contar.
 *
 * **SOLO PREPARACIONES CON STOCK**: la API lanza `ItemNoProducible` para lo
 * demás, y ofrecerlo en la lista sería ofrecer un 400.
 */

import { llamar } from '../../lib/api';
import { textoOpcional } from '../../lib/campos';
import { conPuntoDecimal } from '../../lib/decimales';
import { instanteDelDia } from '../../lib/fechas';

export interface InsumoDelCatalogo {
  readonly id: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly tipo: string;
  readonly llevaStock: boolean | null;
}

export interface LineaDeLote {
  readonly clave: number;
  readonly itemId: string;
  readonly cantidad: string;
}

export interface BorradorDeLote {
  readonly itemId: string;
  readonly cantidad: string;
  readonly lineas: readonly LineaDeLote[];
  readonly fecha: string;
  readonly nota: string;
}

/** Una preparación que lleva stock: lo único que la API deja producir. */
export function preparacionesDe(insumos: readonly InsumoDelCatalogo[]): readonly InsumoDelCatalogo[] {
  return insumos.filter((uno) => uno.tipo === 'PRODUCIDO' && uno.llevaStock === true);
}

export async function lineasDeLaReceta(itemId: string, locationId: string): Promise<readonly LineaDeLote[]> {
  const receta = await llamar<{ readonly vigente: { readonly lineas: readonly { readonly itemId: string; readonly estado: string }[] } | null }>({
    ruta: `/recetas?locationId=${locationId}&itemId=${itemId}`,
  });

  // Una línea excluida no suma al costo teórico y tampoco se usa al producir.
  return (receta.vigente?.lineas ?? [])
    .filter((linea) => linea.estado === 'ACTIVA')
    .map((linea, posicion) => ({ clave: posicion, itemId: linea.itemId, cantidad: '' }));
}

export function cuerpoDelLote(borrador: BorradorDeLote, locationId: string) {
  return {
    locationId,
    itemId: borrador.itemId,
    cantidad: conPuntoDecimal(borrador.cantidad),
    insumos: borrador.lineas.map((linea) => ({
      itemId: linea.itemId,
      cantidad: conPuntoDecimal(linea.cantidad),
    })),
    occurredAt: instanteDelDia(borrador.fecha),
    note: textoOpcional(borrador.nota),
  };
}
