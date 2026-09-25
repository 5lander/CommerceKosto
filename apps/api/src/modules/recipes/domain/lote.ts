/**
 * Un LOTE de productos y de recetas.
 *
 * **CÓMO SE DISTINGUE UNA LÍNEA DE RECETA DE UN COMPONENTE DE COMBO, que es la
 * decisión de este archivo.** No hay una columna que lo diga, y no hace falta:
 * lo decide el TIPO DEL PRODUCTO DESTINO. SPEC §8 lo fija — «`SIMPLE` (receta a
 * ítems) · `COMBO` (componentes que son productos simples)»—, así que una línea
 * de un producto SIMPLE apunta a un ítem y una de un COMBO apunta a otro
 * producto. Pedirle al archivo que lo declare sería pedirle que repita algo que
 * ya dijo, con la posibilidad de contradecirse.
 *
 * **UN COMBO NO PUEDE CONTENER OTRO COMBO.** Es lo que SPEC §8 quiere decir con
 * «componentes que son productos simples», y es también lo que evita que haya
 * que validar ciclos aquí: sin anidamiento no hay ciclo posible. La comprobación
 * necesita saber el tipo de cada componente, así que vive en el caso de uso,
 * que es quien lee el catálogo de productos.
 *
 * ES DOMINIO PURO.
 */

import {
  PRIMERA_POSICION,
  clavePorNombre,
  mensajeDeRepetido,
  type ProblemaDelLote,
} from '../../../shared/domain/lote/problemas';
import type { BaseDeLinea, TipoDeProducto } from './linea-de-receta';

const DECIMAL = /^\d+(?:\.\d+)?$/u;

/** Separador de la clave compuesta. No puede aparecer dentro de un nombre. */
const SEPARADOR = '::';

const LARGO_MAXIMO_DE_NOMBRE = 200;

/**
 * Un decimal que vale cero, escrito como sea: `0`, `0.0`, `00.000`.
 *
 * Se comprueba sobre la CADENA y no con `parseFloat` a proposito. CLAUDE.md §3
 * prohibe el punto flotante para cantidades, y no por purismo: `parseFloat`
 * sobre una cantidad la convierte en un `number` antes de compararla, que es
 * justo el paso que este proyecto no da en ningun sitio.
 */
const ES_CERO = /^0+(?:\.0+)?$/u;

export interface ProductoDelLote {
  readonly nombre: string;
  readonly tipo: TipoDeProducto;
  readonly categoria: string | null;
  /** PVP CON IVA (R14). `null` = todavía sin precio fijado. */
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
  /** El NOMBRE del ítem que hace de empaque (ADR-008 §12). */
  readonly empaque: string | null;
  readonly activo: boolean;
}

export interface LineaDelLote {
  /** El NOMBRE del producto al que pertenece la línea. */
  readonly producto: string;
  /**
   * El NOMBRE de lo que consume: un ítem si el producto es `SIMPLE`, otro
   * producto si es `COMBO`. Lo decide el tipo del destino, no esta fila.
   */
  readonly componente: string;
  readonly cantidad: string;
  readonly base: BaseDeLinea;
}

export function problemasDelLoteDeProductos(
  productos: readonly ProductoDelLote[],
): readonly ProblemaDelLote[] {
  const vistos = new Map<string, number>();
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, producto] of productos.entries()) {
    const posicion = indice + PRIMERA_POSICION;
    const anterior = vistos.get(clavePorNombre(producto.nombre));

    if (anterior !== undefined) {
      problemas.push({ posicion, motivo: mensajeDeRepetido(producto.nombre, anterior) });
      continue;
    }
    vistos.set(clavePorNombre(producto.nombre), posicion);

    const motivo = motivoDelProducto(producto);
    if (motivo !== null) problemas.push({ posicion, motivo });
  }

  return problemas;
}

export function problemasDelLoteDeRecetas(
  lineas: readonly LineaDelLote[],
): readonly ProblemaDelLote[] {
  const vistos = new Map<string, number>();
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, linea] of lineas.entries()) {
    const posicion = indice + PRIMERA_POSICION;
    const clave = claveDeLinea(linea);
    const anterior = vistos.get(clave);

    if (anterior !== undefined) {
      problemas.push({ posicion, motivo: mensajeDeLineaRepetida(linea, anterior) });
      continue;
    }
    vistos.set(clave, posicion);

    const motivo = motivoDeLinea(linea);
    if (motivo !== null) problemas.push({ posicion, motivo });
  }

  return problemas;
}

function motivoDelProducto(producto: ProductoDelLote): string | null {
  const nombre = producto.nombre.trim();

  if (nombre.length === 0) return 'El producto necesita un nombre.';
  if (nombre.length > LARGO_MAXIMO_DE_NOMBRE) {
    return `El nombre no puede pasar de ${String(LARGO_MAXIMO_DE_NOMBRE)} caracteres.`;
  }
  if (producto.pvp !== null && !DECIMAL.test(producto.pvp)) {
    return `El PVP «${producto.pvp}» no es un número.`;
  }
  if (producto.activo && producto.pvp === null) {
    return 'Un producto activo necesita PVP: sin precio no hay margen ni food cost que calcular.';
  }
  return motivoDelRendimiento(producto.rendimientoPorciones);
}

/**
 * El rendimiento por lote **divide** al costear (`costo_por_porcion =
 * costo_neto_lote / rendimiento`, SPEC §14), así que un cero no es un valor
 * raro: es una división por cero. Es el mismo fallo que ADR-011 §1 destapó, y
 * la razón de que once de los 48 productos del Excel de referencia importen.
 */
function motivoDelRendimiento(rendimiento: string | null): string | null {
  if (rendimiento === null) return null;
  if (!DECIMAL.test(rendimiento)) return `El rendimiento «${rendimiento}» no es un número.`;
  if (ES_CERO.test(rendimiento)) {
    return 'El rendimiento por lote no puede ser cero: al costear se divide por él.';
  }
  return null;
}

function claveDeLinea(linea: LineaDelLote): string {
  return `${clavePorNombre(linea.producto)}${SEPARADOR}${clavePorNombre(linea.componente)}`;
}

function mensajeDeLineaRepetida(linea: LineaDelLote, posicion: number): string {
  return (
    `«${linea.componente.trim()}» ya está en la receta de «${linea.producto.trim()}», ` +
    `en la posición ${String(posicion)}. Súmalo en una sola línea.`
  );
}

function motivoDeLinea(linea: LineaDelLote): string | null {
  if (linea.producto.trim().length === 0) return 'La fila no dice de qué producto es esta línea.';
  if (linea.componente.trim().length === 0) return 'La fila no dice qué consume esta línea.';
  if (!DECIMAL.test(linea.cantidad)) return `La cantidad «${linea.cantidad}» no es un número.`;
  if (ES_CERO.test(linea.cantidad)) {
    return 'Una línea de receta con cantidad cero no consume nada: sobra.';
  }
  return null;
}
