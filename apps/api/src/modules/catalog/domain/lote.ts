/**
 * Un LOTE de ítems — lo que la importación necesita y un alta a alta no da.
 *
 * **POR QUÉ EXISTE ESTE ARCHIVO Y NO SE REUSA `CrearItem` EN UN BUCLE.** Cada
 * método del repositorio abre su propia transacción, así que doscientas altas
 * son doscientas transacciones: la fila 150 mala deja escritas las 149 buenas,
 * que es exactamente lo que el criterio de aceptación de P10 prohíbe. La forma
 * de arreglarlo es validar el lote ENTERO aquí, en dominio puro, y escribirlo
 * después en una sola transacción.
 *
 * **DEVUELVE TODOS LOS PROBLEMAS, NO EL PRIMERO.** Es la misma decisión que
 * `analizar()` toma en `imports`: quien está migrando un catálogo quiere la
 * lista completa para arreglarla de una pasada, no descubrir el siguiente error
 * cada vez que reintenta.
 *
 * **LOS NOMBRES SE COMPARAN NORMALIZADOS** con `clavePorNombre`, que es más
 * estricto que el índice único de la base. El porqué está donde vive esa
 * función, en `shared/domain/lote/problemas.ts`.
 *
 * ES DOMINIO PURO.
 */

import {
  PRIMERA_POSICION,
  clavePorNombre,
  mensajeDeRepetido,
  type ProblemaDelLote,
} from '../../../shared/domain/lote/problemas';
import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { esUnidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import {
  LARGO_MAXIMO_DE_NOMBRE,
  mensajeDelProblemaDeItem,
  problemaDeItem,
  type ConfianzaDePrecio,
  type TipoDeItem,
} from './item';

/**
 * Decimal sin signo. Se comprueba con la expresión regular ANTES de construir
 * el `Ratio` a propósito: una excepción como control de flujo escondería la
 * diferencia entre «no es un número» y cualquier otro fallo del constructor.
 */
const DECIMAL = /^\d+(?:\.\d+)?$/u;

export interface ItemDelLote {
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly unidadDeUso: string;
  /** Decimal exacto como cadena. Nunca `number` (CLAUDE.md §3). */
  readonly rendimiento: string;
  /** El NOMBRE del grupo, no su id: el lote crea los que falten. */
  readonly grupo: string | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly llevaStock: boolean | null;
}

export function problemasDelLoteDeItems(items: readonly ItemDelLote[]): readonly ProblemaDelLote[] {
  const vistos = new Map<string, number>();
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, item] of items.entries()) {
    const posicion = indice + PRIMERA_POSICION;
    const anterior = vistos.get(clavePorNombre(item.nombre));

    if (anterior !== undefined) {
      problemas.push({ posicion, motivo: mensajeDeRepetido(item.nombre, anterior) });
      continue;
    }
    vistos.set(clavePorNombre(item.nombre), posicion);

    const motivo = motivoDelItem(item);
    if (motivo !== null) problemas.push({ posicion, motivo });
  }

  return problemas;
}

function motivoDelItem(item: ItemDelLote): string | null {
  if (!DECIMAL.test(item.rendimiento)) {
    return `El rendimiento «${item.rendimiento}» no es un número.`;
  }
  if (!esUnidadDeUso(item.unidadDeUso)) {
    return `La unidad de uso «${item.unidadDeUso}» no es un código válido (por ejemplo «kg», «lt», «unid»).`;
  }

  const problema = problemaDeItem({
    nombre: item.nombre,
    tipo: item.tipo,
    rendimiento: Ratio.fromDecimalString(item.rendimiento),
    llevaStock: item.llevaStock,
  });

  return problema === null ? null : mensajeDelProblemaDeItem(problema);
}

export interface ArticuloDelLote {
  /** El NOMBRE del ítem al que pertenece: es lo que trae un archivo. */
  readonly item: string;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
  readonly factorExplicito: string | null;
}

/**
 * Lo que se puede saber de un lote de artículos **sin leer la base**.
 *
 * El factor de conversión NO se comprueba aquí: necesita el catálogo de
 * unidades y la unidad de uso del ítem, que son dos lecturas. Lo hace el caso
 * de uso, con `factorDeConversion`, y convierte cada fallo en un problema con
 * su posición — la misma forma que devuelve esta función.
 */
export function problemasDelLoteDeArticulos(
  articulos: readonly ArticuloDelLote[],
): readonly ProblemaDelLote[] {
  const vistos = new Map<string, number>();
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, articulo] of articulos.entries()) {
    const posicion = indice + PRIMERA_POSICION;
    const anterior = vistos.get(clavePorNombre(articulo.nombre));

    if (anterior !== undefined) {
      problemas.push({ posicion, motivo: mensajeDeRepetido(articulo.nombre, anterior) });
      continue;
    }
    vistos.set(clavePorNombre(articulo.nombre), posicion);

    const motivo = motivoDelArticulo(articulo);
    if (motivo !== null) problemas.push({ posicion, motivo });
  }

  return problemas;
}

function motivoDelArticulo(articulo: ArticuloDelLote): string | null {
  const nombre = articulo.nombre.trim();

  if (articulo.item.trim().length === 0) return 'La fila no dice de qué ítem es este artículo.';
  if (nombre.length === 0) return 'El artículo necesita un nombre.';
  if (nombre.length > LARGO_MAXIMO_DE_NOMBRE) {
    return `El nombre no puede pasar de ${String(LARGO_MAXIMO_DE_NOMBRE)} caracteres.`;
  }
  if (!DECIMAL.test(articulo.presentacion)) {
    return `La presentación «${articulo.presentacion}» no es un número.`;
  }
  if (!esUnidadDeUso(articulo.unidadDePresentacion)) {
    return `La unidad de compra «${articulo.unidadDePresentacion}» no es un código válido.`;
  }
  if (articulo.factorExplicito !== null && !DECIMAL.test(articulo.factorExplicito)) {
    return `El factor de conversión «${articulo.factorExplicito}» no es un número.`;
  }

  return null;
}
