'use client';

/**
 * La receta de un destino —un producto con receta o una preparación— en una
 * sucursal, leída para editarla.
 *
 * **EL DESTINO ES UNA UNIÓN**, como en la API: `producto` o `item`, nunca los dos.
 *
 * **`ultimaVersionId` NO ES LA VIGENTE** (P16-B): es la última versión creada,
 * aunque tenga vigencia futura, y es lo que el guardado manda como `basadaEn`.
 * Si otra versión se creó entre medias —otro editor, una propagación—, 409.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import type { Sucursal } from '../../lib/sesion';
import { useCarga, type Lectura } from '../../lib/useLectura';

export type ClaseDeDestino = 'producto' | 'item';

export interface LineaLeida {
  readonly itemId: string;
  readonly cantidad: string;
  readonly base: 'AP' | 'EP';
  readonly estado: 'ACTIVA' | 'INACTIVA';
}

interface VersionDeReceta {
  readonly id: string;
  readonly validFrom: string;
  readonly lineas: readonly LineaLeida[];
}

export interface InsumoParaReceta {
  readonly id: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly estado: 'ACTIVE' | 'INACTIVE';
}

export interface ParaEditarReceta {
  readonly nombre: string;
  /** `SIMPLE`/`COMBO` de un producto, `COMPRADO`/`PRODUCIDO` de un insumo. */
  readonly tipo: string;
  readonly vigente: VersionDeReceta | null;
  readonly ultimaVersionId: string | null;
  readonly insumos: readonly InsumoParaReceta[];
  readonly sucursal: string;
}

/** Solo un producto con receta y una preparación la tienen: un combo y un insumo comprado, no. */
export function admiteReceta(clase: ClaseDeDestino, tipo: string): boolean {
  return clase === 'producto' ? tipo === 'SIMPLE' : tipo === 'PRODUCIDO';
}

export function destinoDe(clase: ClaseDeDestino, id: string) {
  return clase === 'producto' ? { clase, productId: id } : { clase, itemId: id };
}

export function useParaEditarReceta(clase: ClaseDeDestino, id: string, sucursal: string | null): Lectura<ParaEditarReceta> {
  const leer = useMemo(() => {
    if (sucursal === null) return null;
    const consulta = clase === 'producto' ? `productId=${id}` : `itemId=${id}`;
    const rutaDelDestino = clase === 'producto' ? `/productos/${id}` : `/catalogo/items/${id}`;

    return async (): Promise<ParaEditarReceta> => {
      const [receta, insumos, destino, sucursales] = await Promise.all([
        llamar<{ readonly vigente: VersionDeReceta | null; readonly ultimaVersionId: string | null }>({
          ruta: `/recetas?locationId=${sucursal}&${consulta}`,
        }),
        llamar<readonly InsumoParaReceta[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
        llamar<{ readonly nombre: string; readonly tipo: string }>({ ruta: rutaDelDestino }),
        llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
      ]);
      const nombreDeSucursal = sucursales.find((s) => s.id === sucursal)?.nombre ?? '';
      return { ...receta, insumos, nombre: destino.nombre, tipo: destino.tipo, sucursal: nombreDeSucursal };
    };
  }, [clase, id, sucursal]);
  return useCarga(leer);
}
