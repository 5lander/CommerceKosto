'use client';

/**
 * El libro de una sucursal — `GET /inventario/movimientos`.
 *
 * **EL LIBRO ES APPEND-ONLY (R3) Y ESTA PANTALLA LO ENSEÑA COMO TAL**: no hay
 * editar ni borrar una fila. Un error se arregla con un movimiento de signo
 * contrario, y las dos filas se quedan; por eso `corrigeA` y `corregidoPor` se
 * pintan como estado y no se esconden.
 *
 * **POR CURSOR, NUNCA POR PÁGINA NUMERADA** (CLAUDE.md §5): «Ver más» pide la
 * siguiente con el `siguiente` que devolvió la anterior.
 *
 * **LOS FILTROS VIAJAN A LA API, NO SE APLICAN AQUÍ.** Filtrar en el navegador
 * sobre una página de cincuenta filas daría un resultado que parece el libro
 * filtrado y es solo la primera página filtrada.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import { useCarga, type Lectura } from '../../lib/useLectura';

/** Los siete del catálogo `inventory_movement_type` (P16-C). */
export const TIPOS_DE_MOVIMIENTO = [
  'COMPRA',
  'TRANSFERENCIA_ENTRADA',
  'TRANSFERENCIA_SALIDA',
  'PRODUCCION',
  'MERMA',
  'AJUSTE',
  'CONSUMO_POR_VENTA',
] as const;

export interface MovimientoLeido {
  readonly id: string;
  readonly itemId: string;
  readonly tipo: string;
  readonly cantidad: string;
  readonly costoTotal: string | null;
  readonly occurredAt: string;
  readonly desglose: string;
  readonly corrigeA: string | null;
  readonly corregidoPor: string | null;
  readonly note: string | null;
}

export interface PaginaDelLibro {
  readonly movimientos: readonly MovimientoLeido[];
  readonly siguiente: string | null;
}

export interface InsumoDelLibro {
  readonly id: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
}

export interface Filtros {
  readonly itemId: string;
  readonly tipo: string;
  readonly desde: string;
  readonly hasta: string;
}

export const SIN_FILTRO = '';

export interface LibroLeido {
  readonly pagina: PaginaDelLibro;
  readonly insumos: ReadonlyMap<string, InsumoDelLibro>;
}

/** La consulta de la API: solo lo que el usuario llenó, y las fechas al mediodía UTC (D-16.4). */
export function consultaDelLibro(sucursal: string, filtros: Filtros): string {
  const partes = [`locationId=${sucursal}`];
  if (filtros.itemId !== SIN_FILTRO) partes.push(`itemId=${filtros.itemId}`);
  if (filtros.tipo !== SIN_FILTRO) partes.push(`tipo=${filtros.tipo}`);
  if (filtros.desde !== SIN_FILTRO) partes.push(`desde=${filtros.desde}T12:00:00.000Z`);
  if (filtros.hasta !== SIN_FILTRO) partes.push(`hasta=${filtros.hasta}T12:00:00.000Z`);
  return partes.join('&');
}

export function useLibro(sucursal: string | null, filtros: Filtros): Lectura<LibroLeido> {
  const consulta = sucursal === null ? null : consultaDelLibro(sucursal, filtros);

  const leer = useMemo(() => {
    if (consulta === null) return null;

    return async (): Promise<LibroLeido> => {
      const [pagina, insumos] = await Promise.all([
        llamar<PaginaDelLibro>({ ruta: `/inventario/movimientos?${consulta}` }),
        llamar<readonly InsumoDelLibro[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
      ]);

      return { pagina, insumos: new Map(insumos.map((insumo) => [insumo.id, insumo])) };
    };
  }, [consulta]);

  return useCarga(leer);
}
