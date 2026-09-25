'use client';

/**
 * La ficha de un producto, leída una vez para toda la página.
 *
 * **LA `version` ES DEL AGREGADO** (ADR-023): sube con la configuración de
 * cualquier sucursal, con el empaque y con los componentes. Cada escritura de la
 * ficha manda la que se leyó; si otra llegó antes, 409 `CONFLICTO_DE_VERSION` y
 * se vuelve a leer —aunque la otra fuera en otra sucursal (D-16.20)—.
 *
 * **LOS INSUMOS SE LEEN AQUÍ UNA VEZ**: el selector de empaque los lista y el
 * desglose del costo pone la unidad a cada cantidad. Con los archivados, porque
 * una receta vieja puede llevar uno.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import type { Sucursal } from '../../lib/sesion';
import { useCarga, type Lectura } from '../../lib/useLectura';

export interface FichaDeProducto {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: 'SIMPLE' | 'COMBO';
  readonly categoria: string | null;
  readonly estado: 'ACTIVE' | 'INACTIVE';
  readonly empaqueItemId: string | null;
  readonly version: number;
}

export interface Configuracion {
  readonly locationId: string;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

export interface InsumoDelCatalogo {
  readonly id: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly estado: 'ACTIVE' | 'INACTIVE';
}

export interface ProductoLeido {
  readonly ficha: FichaDeProducto;
  readonly configuraciones: readonly Configuracion[];
  readonly sucursales: ReadonlyMap<string, string>;
  readonly insumos: readonly InsumoDelCatalogo[];
}

export function useProducto(id: string): Lectura<ProductoLeido> {
  const leer = useMemo(
    () => async (): Promise<ProductoLeido> => {
      const [ficha, configuraciones, sucursales, insumos] = await Promise.all([
        llamar<FichaDeProducto>({ ruta: `/productos/${id}` }),
        llamar<readonly Configuracion[]>({ ruta: `/productos/${id}/ubicaciones` }),
        llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
        llamar<readonly InsumoDelCatalogo[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
      ]);
      return { ficha, configuraciones, sucursales: new Map(sucursales.map((s) => [s.id, s.nombre])), insumos };
    },
    [id],
  );
  return useCarga(leer);
}
