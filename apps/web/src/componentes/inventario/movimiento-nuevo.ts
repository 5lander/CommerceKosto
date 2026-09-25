'use client';

/**
 * Lo que se teclea para registrar un movimiento, y en qué se convierte al salir.
 *
 * **EL SIGNO NO SE PONE AQUÍ.** `COMPRA` y `MERMA` piden la cantidad **en
 * positivo** y el dominio les da su dirección (`movimiento.ts`: «el signo no lo
 * elige quien llama»); `AJUSTE` es el único tipo donde el signo viaja desde
 * fuera, y por eso es el único campo que admite el menos. Restar aquí sería la
 * misma regla escrita dos veces, que es como nació INC-029.
 *
 * **EL IMPORTE QUE SE ESCRIBE ES EL BRUTO** (D-16.9): «el total de la factura,
 * con IVA». Quien compra lee un papel, no un neto; el neteo lo hace la API según
 * la tarifa y si la company recupera el IVA (R13).
 */

import { textoOpcional } from '../../lib/campos';
import { conPuntoDecimal, fraccionDePorcentaje } from '../../lib/decimales';
import { instanteDelDia } from '../../lib/fechas';

/** Los tres que se registran sueltos: `TIPOS_DIRECTOS` del dominio. */
export const TIPOS_DIRECTOS = ['COMPRA', 'MERMA', 'AJUSTE'] as const;
export type TipoDirecto = (typeof TIPOS_DIRECTOS)[number];

export const SIN_ARTICULO = '';

/**
 * El valor de un `<select>` como tipo, comprobado contra la lista.
 *
 * **SIN `as`**: un `<select>` devuelve `string`, y afirmar que es uno de los tres
 * sin mirarlo es exactamente la clase de mentira al compilador que CLAUDE.md §3
 * prohíbe. Si llegara otra cosa —un `<option>` mal escrito—, cae en `COMPRA` y
 * la API rechaza lo que no cuadre.
 */
export function tipoDe(valor: string): TipoDirecto {
  return TIPOS_DIRECTOS.find((uno) => uno === valor) ?? 'COMPRA';
}

export interface Borrador {
  readonly tipo: TipoDirecto;
  readonly itemId: string;
  readonly cantidad: string;
  readonly articuloId: string;
  readonly total: string;
  readonly iva: string;
  readonly fecha: string;
  readonly nota: string;
}

export interface ArticuloDeCompra {
  readonly id: string;
  readonly itemId: string;
  readonly nombre: string;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
}

export interface CuerpoDeMovimiento {
  readonly locationId: string;
  readonly itemId: string;
  readonly tipo: string;
  readonly cantidad: string;
  readonly costoTotal: string | null;
  readonly purchaseArticleId: string | null;
  readonly ivaTarifa: string | null;
  readonly occurredAt: string;
  readonly note: string | null;
}

export function cuerpoDe(borrador: Borrador, locationId: string): CuerpoDeMovimiento {
  const esCompra = borrador.tipo === 'COMPRA';

  return {
    locationId,
    itemId: borrador.itemId,
    tipo: borrador.tipo,
    cantidad: conPuntoDecimal(borrador.cantidad),
    costoTotal: esCompra ? conPuntoDecimal(borrador.total) : null,
    purchaseArticleId: esCompra && borrador.articuloId !== SIN_ARTICULO ? borrador.articuloId : null,
    ivaTarifa: esCompra && borrador.iva.trim() !== '' ? fraccionDePorcentaje(borrador.iva) : null,
    occurredAt: instanteDelDia(borrador.fecha),
    note: textoOpcional(borrador.nota),
  };
}

/** Las presentaciones del insumo elegido: ofrecer las de otro sería ofrecer un 400. */
export function articulosDe(articulos: readonly ArticuloDeCompra[], itemId: string): readonly ArticuloDeCompra[] {
  return articulos.filter((articulo) => articulo.itemId === itemId);
}

/**
 * La presentación que viene elegida al cambiar de insumo: **la primera suya**, y
 * «sin presentación» solo si no tiene ninguna.
 *
 * **NO ES UNA COMODIDAD, ES LO QUE EVITA UN 400 EN EL CASO NORMAL.** Sin
 * presentación, la tarifa de IVA tiene que salir del grupo, y un grupo que no la
 * define hace que la compra se rechace —a propósito: nunca se asume un 15 %
 * (D-16.9)—. Quien compra vería un error sobre tarifas después de teclearlo todo.
 */
export function articuloPorDefecto(articulos: readonly ArticuloDeCompra[], itemId: string): string {
  return articulosDe(articulos, itemId)[0]?.id ?? SIN_ARTICULO;
}
