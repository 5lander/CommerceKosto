'use client';

/**
 * El historial de una receta: todas sus versiones en una sucursal — `GET /recetas/versiones`.
 *
 * **QUIÉN MANDA HOY LO DICE LA API, NO ESTA PANTALLA.** El historial llega
 * ordenado por vigencia y `GET /recetas` responde cuál es la vigente; aquí solo
 * se comparan identificadores. En ningún sitio se evalúa una fecha contra «hoy»:
 * esa es la regla de negocio de SPEC §9 y vive en el backend, donde además sabe
 * que una versión `VOID` gana igual que cualquier otra y deja al producto **sin**
 * receta. Un `vigenteId` nulo con versiones en la lista significa exactamente eso.
 *
 * **EL NOMBRE DEL PRODUCTO SE PIDE AUNQUE YA SE TENGA EN LA FICHA.** Es lo que
 * convierte el id de otra company en un «no encontrado» en su sitio: las
 * versiones de un producto ajeno son una lista vacía —RLS hace su trabajo en
 * silencio—, y una lista vacía no se distingue de un producto recién creado.
 * El 404 de `GET /productos/:id` sí.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import type { Sucursal } from '../../lib/sesion';
import { useCarga, type Lectura } from '../../lib/useLectura';
import type { InsumoParaReceta, LineaLeida } from './receta';

export interface VersionLeida {
  readonly id: string;
  /** `ACTIVE`, o `VOID` cuando la versión dice «aquí no hay receta». */
  readonly estado: string;
  readonly validFrom: string;
  readonly nota: string | null;
  readonly lineas: readonly LineaLeida[];
}

export interface HistorialDeReceta {
  readonly nombre: string;
  readonly sucursal: string;
  /** Por vigencia, la más reciente primero: el orden en que llegan de la API. */
  readonly versiones: readonly VersionLeida[];
  /** La que manda hoy **según la API**, o `null` si hoy no hay receta. */
  readonly vigenteId: string | null;
  /** La última creada, aunque su vigencia sea futura. */
  readonly ultimaVersionId: string | null;
  readonly insumos: ReadonlyMap<string, InsumoParaReceta>;
}

interface Versiones {
  readonly versiones: readonly VersionLeida[];
  readonly ultimaVersionId: string | null;
}

export function useVersionesDeReceta(productId: string, sucursal: string | null): Lectura<HistorialDeReceta> {
  const leer = useMemo(() => {
    if (sucursal === null) return null;
    const destino = `locationId=${sucursal}&productId=${productId}`;

    return async (): Promise<HistorialDeReceta> => {
      const [historial, hoy, insumos, producto, sucursales] = await Promise.all([
        llamar<Versiones>({ ruta: `/recetas/versiones?${destino}` }),
        llamar<{ readonly vigente: { readonly id: string } | null }>({ ruta: `/recetas?${destino}` }),
        llamar<readonly InsumoParaReceta[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
        llamar<{ readonly nombre: string }>({ ruta: `/productos/${productId}` }),
        llamar<readonly Sucursal[]>({ ruta: '/ubicaciones' }),
      ]);

      return {
        nombre: producto.nombre,
        sucursal: sucursales.find((una) => una.id === sucursal)?.nombre ?? '',
        versiones: historial.versiones,
        vigenteId: hoy.vigente?.id ?? null,
        ultimaVersionId: historial.ultimaVersionId,
        insumos: new Map(insumos.map((insumo) => [insumo.id, insumo])),
      };
    };
  }, [productId, sucursal]);

  return useCarga(leer);
}
