/**
 * Un LOTE de precios de referencia.
 *
 * **R5 NO SE RELAJA AQUÍ, Y CONVIENE DECIR POR QUÉ.** «Ningún precio se mueve
 * solo»: los precios nacen sugeridos y pasan a vigentes cuando **un usuario los
 * confirma**. Cargar 149 precios y obligar a confirmarlos de uno en uno no
 * cumple mejor esa regla, solo la vuelve impracticable — y el resultado sería
 * un cliente cuyo costeo sale en blanco su primer día.
 *
 * La forma que sí la cumple: el lote se confirma **entero, en el acto y a
 * petición explícita** de quien lo carga, y queda un evento de auditoría con su
 * nombre. Lo que R5 prohíbe es que un precio se vuelva vigente sin que nadie lo
 * decida; no que alguien decida sobre 149 a la vez.
 *
 * ES DOMINIO PURO.
 */

import {
  PRIMERA_POSICION,
  clavePorNombre,
  type ProblemaDelLote,
} from '../../../shared/domain/lote/problemas';
import type { OrigenDePrecio } from './vigencia';

const DECIMAL = /^\d+(?:\.\d+)?$/u;

/** Separador de la clave compuesta. No puede aparecer dentro de un nombre. */
const SEPARADOR = '::';

export interface PrecioDelLote {
  /** El NOMBRE del ítem. */
  readonly item: string;
  /** El NOMBRE del artículo de compra. `null` en una preparación (R10). */
  readonly articulo: string | null;
  readonly precio: string;
  /** `null` toma la tasa de la company. La de la factura manda sobre ella. */
  readonly ivaCompra: string | null;
  readonly origen: OrigenDePrecio;
  readonly nota: string | null;
}

export function problemasDelLoteDePrecios(
  precios: readonly PrecioDelLote[],
): readonly ProblemaDelLote[] {
  const vistos = new Map<string, number>();
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, precio] of precios.entries()) {
    const posicion = indice + PRIMERA_POSICION;
    const anterior = vistos.get(claveDelPrecio(precio));

    if (anterior !== undefined) {
      problemas.push({ posicion, motivo: mensajeDePrecioRepetido(precio, anterior) });
      continue;
    }
    vistos.set(claveDelPrecio(precio), posicion);

    const motivo = motivoDelPrecio(precio);
    if (motivo !== null) problemas.push({ posicion, motivo });
  }

  return problemas;
}

/**
 * Un ítem puede tener varios precios a la vez —uno por artículo de compra—, así
 * que la clave es el par. Lo que no puede es traer dos veces el mismo par en el
 * mismo archivo: serían dos versiones con la misma vigencia, y cuál gana
 * quedaría en manos del desempate por `created_at`.
 */
function claveDelPrecio(precio: PrecioDelLote): string {
  return `${clavePorNombre(precio.item)}${SEPARADOR}${clavePorNombre(precio.articulo ?? '')}`;
}

function mensajeDePrecioRepetido(precio: PrecioDelLote, posicion: number): string {
  const donde = precio.articulo === null ? '' : ` con el artículo «${precio.articulo.trim()}»`;
  return `«${precio.item.trim()}»${donde} ya trae precio en la posición ${String(posicion)}.`;
}

function motivoDelPrecio(precio: PrecioDelLote): string | null {
  if (precio.item.trim().length === 0) return 'La fila no dice de qué ítem es este precio.';
  if (!DECIMAL.test(precio.precio)) return `El precio «${precio.precio}» no es un número.`;
  if (precio.ivaCompra !== null && !DECIMAL.test(precio.ivaCompra)) {
    return `El IVA de compra «${precio.ivaCompra}» no es un número.`;
  }
  return null;
}
