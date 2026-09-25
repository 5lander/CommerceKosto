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
 * **EL NOMBRE DEL PRODUCTO SE PIDE AUNQUE YA SE TENGA EN LA FICHA**, y por qué
 * está en `contexto.ts`: es lo que convierte el id de otra company en un «no
 * encontrado» en su sitio.
 */

import { useMemo } from 'react';

import { llamar } from '../../lib/api';
import { useCarga, type Lectura } from '../../lib/useLectura';
import { contextoDelProducto } from './contexto';
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
      const [historial, hoy, insumos, contexto] = await Promise.all([
        llamar<Versiones>({ ruta: `/recetas/versiones?${destino}` }),
        llamar<{ readonly vigente: { readonly id: string } | null }>({ ruta: `/recetas?${destino}` }),
        llamar<readonly InsumoParaReceta[]>({ ruta: '/catalogo/items?incluirInactivos=true' }),
        contextoDelProducto(productId, sucursal),
      ]);

      return {
        nombre: contexto.nombre,
        sucursal: contexto.sucursal,
        versiones: historial.versiones,
        vigenteId: hoy.vigente?.id ?? null,
        ultimaVersionId: historial.ultimaVersionId,
        insumos: new Map(insumos.map((insumo) => [insumo.id, insumo])),
      };
    };
  }, [productId, sucursal]);

  return useCarga(leer);
}
