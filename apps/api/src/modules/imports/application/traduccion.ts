/**
 * De las celdas del archivo a los tipos de cada módulo dueño.
 *
 * **ES LA FRONTERA, Y POR ESO ESTÁ SOLA EN UN ARCHIVO.** A la izquierda,
 * `Record<string, string>` — lo que un descriptor extrajo de una hoja, todo
 * texto. A la derecha, `ItemDelLote`, `PrecioDelLote`, `ProductoDelLote`… los
 * tipos que `catalog`, `pricing` y `recipes` validan con sus propias reglas.
 * Aquí no se valida nada: solo se traduce. Si algo no cuadra, lo dirá el dominio
 * del módulo dueño, que es quien sabe.
 *
 * **LA HORA DE UNA FECHA ES LAS 12:00Z, Y NO ES ARBITRARIO.** Es la convención
 * del proyecto, escrita en `ESTADO.md`: las cinco primeras horas UTC de un día 1
 * son del mes anterior en Ecuador, así que un `2026-03-01T00:00:00Z` acabaría
 * contado en febrero. Al mediodía UTC la fecha cae en el mismo día natural en
 * toda América. Es INC-013.
 */

import type { ArticuloDelLote, ItemDelLote } from '../../catalog/domain/lote';
import type { MovimientoDelLote } from '../../inventory/domain/lote';
import type { TipoDeMovimiento } from '../../inventory/domain/movimiento';
import type { PrecioDelLote } from '../../pricing/domain/lote';
import type { LineaDelLote, ProductoDelLote } from '../../recipes/domain/lote';
import type { BaseDeLinea } from '../../recipes/domain/linea-de-receta';
import type { TipoDeProducto } from '../../recipes/application/ports/repositorio-de-recetas.port';
import type { ConfianzaDePrecio, TipoDeItem } from '../../catalog/domain/item';
import type { FilaValida } from '../domain/analisis';

/** El mediodía UTC: el mismo día natural en toda América (INC-013). */
const MEDIODIA_UTC = 'T12:00:00.000Z';

const ORIGEN_MANUAL = 'MANUAL';

const AFIRMATIVO = 'SI';

const TIPO_PRODUCIDO = 'PRODUCIDO';

type Celdas = Readonly<Record<string, string>>;

export function comoItem(fila: FilaValida): ItemDelLote {
  const tipo = leer(fila.valores, 'tipo').toUpperCase() as TipoDeItem;

  return {
    nombre: leer(fila.valores, 'nombre'),
    tipo,
    unidadDeUso: leer(fila.valores, 'unidadDeUso'),
    rendimiento: leer(fila.valores, 'rendimiento'),
    grupo: opcional(fila.valores, 'grupo'),
    confianzaDePrecio: leer(fila.valores, 'confianzaDePrecio').toUpperCase() as ConfianzaDePrecio,
    // El interruptor de stock solo existe en una preparación, y el archivo no
    // lo trae: se asume que la preparación se produce en lote y aparece en
    // inventario, que es el caso que P6 modela. Un comprado siempre lleva
    // stock, y por eso ahí va `null`.
    llevaStock: tipo === TIPO_PRODUCIDO ? true : null,
  };
}

export function comoArticulo(fila: FilaValida): ArticuloDelLote {
  return {
    item: leer(fila.valores, 'item'),
    nombre: leer(fila.valores, 'nombre'),
    marca: opcional(fila.valores, 'marca'),
    proveedor: opcional(fila.valores, 'proveedor'),
    presentacion: leer(fila.valores, 'presentacion'),
    unidadDePresentacion: leer(fila.valores, 'unidadDePresentacion'),
    factorExplicito: opcional(fila.valores, 'factorExplicito'),
  };
}

export function comoPrecio(fila: FilaValida): PrecioDelLote {
  return {
    item: leer(fila.valores, 'item'),
    articulo: opcional(fila.valores, 'articulo'),
    precio: leer(fila.valores, 'precio'),
    ivaCompra: opcional(fila.valores, 'ivaCompra'),
    origen: ORIGEN_MANUAL,
    nota: opcional(fila.valores, 'nota'),
  };
}

export function comoProducto(fila: FilaValida): ProductoDelLote {
  return {
    nombre: leer(fila.valores, 'nombre'),
    tipo: leer(fila.valores, 'tipo').toUpperCase() as TipoDeProducto,
    categoria: opcional(fila.valores, 'categoria'),
    pvp: opcional(fila.valores, 'pvp'),
    rendimientoPorciones: opcional(fila.valores, 'rendimientoPorciones'),
    empaque: opcional(fila.valores, 'empaque'),
    activo: leer(fila.valores, 'activo') === AFIRMATIVO,
  };
}

export function comoLineaDeReceta(fila: FilaValida): LineaDelLote {
  return {
    producto: leer(fila.valores, 'producto'),
    componente: leer(fila.valores, 'item'),
    cantidad: leer(fila.valores, 'cantidad'),
    base: leer(fila.valores, 'base').toUpperCase() as BaseDeLinea,
  };
}

export function comoMovimiento(fila: FilaValida): MovimientoDelLote {
  return {
    item: leer(fila.valores, 'item'),
    tipo: leer(fila.valores, 'tipo').toUpperCase() as TipoDeMovimiento,
    cantidad: leer(fila.valores, 'cantidad'),
    costoTotal: opcional(fila.valores, 'costoTotal'),
    occurredAt: comoInstante(leer(fila.valores, 'fecha')),
    note: null,
  };
}

/**
 * `AAAA-MM-DD` a las 12:00 UTC.
 *
 * El descriptor ya normalizó la fecha y dejó a propósito la hora sin poner —su
 * comentario lo dice—, porque quien conoce la convención del proyecto es esta
 * capa, no el que lee celdas.
 */
export function comoInstante(fecha: string): Date {
  return new Date(`${fecha}${MEDIODIA_UTC}`);
}

function leer(celdas: Celdas, clave: string): string {
  return celdas[clave] ?? '';
}

/** La celda vacía es `null`, no `''`: «no lo dijeron» y «lo dijeron vacío» son lo mismo aquí. */
function opcional(celdas: Celdas, clave: string): string | null {
  const valor = leer(celdas, clave).trim();
  return valor === '' ? null : valor;
}
