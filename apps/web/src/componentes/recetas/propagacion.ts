'use client';

/**
 * Propagar la receta de un producto desde la sucursal elegida a las demás — R11.
 *
 * **LA PREVISUALIZACIÓN NO ES UN PASO OPCIONAL** (R11, SPEC §9): propagar sobre
 * una sucursal que había ajustado su receta **borra ese trabajo**, y quien
 * propaga tiene que poder saberlo antes. Por eso la pantalla se monta sobre
 * `GET /recetas/propagacion/previsualizacion`, que marca cuáles son esas, y
 * ninguna sucursal con receta propia viene marcada de entrada.
 *
 * **EL ORIGEN ES LA SUCURSAL DEL SELECTOR.** Propagar es «que las demás usen la
 * de aquí», así que cambiar de sucursal cambia el origen, y eso se lee en el
 * encabezado: un origen equivocado es una receta equivocada en N locales.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import { useCarga, type Lectura } from '../../lib/useLectura';
import { contextoDelProducto } from './contexto';

export interface DestinoDePropagacion {
  readonly locationId: string;
  readonly nombre: string;
  /** `true` si esa sucursal ya tiene receta propia y la perdería. */
  readonly personalizada: boolean;
  readonly recetaActual: string | null;
}

interface Previsualizacion {
  readonly origen: string;
  readonly destinos: readonly DestinoDePropagacion[];
  readonly personalizadas: number;
}

export interface PropagacionLeida {
  readonly id: string;
  readonly propagadaEn: string;
  readonly revertidaEn: string | null;
  readonly destinos: readonly { readonly locationId: string }[];
}

export interface ParaPropagar {
  readonly nombre: string;
  readonly sucursal: string;
  readonly previsualizacion: Previsualizacion;
  readonly propagaciones: readonly PropagacionLeida[];
  readonly sucursales: ReadonlyMap<string, string>;
}

export function useParaPropagar(productId: string, sucursal: string | null): Lectura<ParaPropagar> {
  const leer = useMemo(() => {
    if (sucursal === null) return null;

    return async (): Promise<ParaPropagar> => {
      const [previsualizacion, propagaciones, contexto] = await Promise.all([
        llamar<Previsualizacion>({ ruta: `/recetas/propagacion/previsualizacion?productId=${productId}&origen=${sucursal}` }),
        llamar<readonly PropagacionLeida[]>({ ruta: `/recetas/propagacion?productId=${productId}` }),
        contextoDelProducto(productId, sucursal),
      ]);

      return {
        nombre: contexto.nombre,
        sucursal: contexto.sucursal,
        previsualizacion,
        propagaciones,
        sucursales: contexto.sucursales,
      };
    };
  }, [productId, sucursal]);

  return useCarga(leer);
}
