'use client';

/**
 * La ficha de un insumo, leída una vez y usada por la ficha y por su edición.
 *
 * **EL PRECIO SOLO SE PIDE CON `pricing.read`**, como en el listado: la ficha de
 * un insumo la puede abrir `BODEGA`, y el historial de precios no es suyo.
 *
 * **«SIN PRECIO CONFIRMADO» NO ES UN ERROR** (`GET /precios/costo/:itemId` responde
 * 404 con `RECURSO_NO_ENCONTRADO`): es un insumo al que todavía hay que ponerle
 * precio, y la ficha lo dice como estado.
 */

import { useMemo } from 'react';

import { codigoDe, llamar } from '../../lib/api';
import { useCarga, type Lectura } from '../../lib/useLectura';

export interface Articulo {
  readonly id: string;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
  readonly factorDeConversion: string;
  readonly ivaTarifa: string;
  readonly estado: 'ACTIVE' | 'INACTIVE';
}

export interface FichaDeItem {
  readonly id: string;
  readonly nombre: string;
  readonly tipo: 'COMPRADO' | 'PRODUCIDO';
  readonly unidadDeUso: string;
  readonly rendimiento: string;
  readonly grupoId: string | null;
  readonly estado: 'ACTIVE' | 'INACTIVE';
  readonly confianzaDePrecio: 'FACTURA' | 'ESTIMADO';
  readonly llevaStock: boolean | null;
  readonly version: number;
  readonly grupo: { readonly id: string; readonly nombre: string; readonly ivaTarifa: string | null } | null;
  readonly articulos: readonly Articulo[];
}

export interface PrecioDelHistorial {
  readonly id: string;
  readonly precio: string;
  readonly ivaCompra: string;
  readonly origen: string;
  readonly estado: 'SUGGESTED' | 'CONFIRMED' | 'REJECTED';
  readonly validFrom: string;
  readonly nota: string | null;
  readonly vigente: boolean;
}

export interface CostoDeUso {
  readonly vigenteDesde: string;
  readonly precioNeto: string;
  readonly costoBrutoDeUso: string;
  readonly costoNetoDeUso: string;
  readonly sobrecostoDeMerma: string;
}

export interface Precios {
  readonly historial: readonly PrecioDelHistorial[];
  /** `null` si todavía no hay ningún precio confirmado. */
  readonly costo: CostoDeUso | null;
}

export interface InsumoLeido {
  readonly ficha: FichaDeItem;
  /** `null` cuando la sesión no lee precios. */
  readonly precios: Precios | null;
}

/** El 404 con el que la API dice «este ítem no tiene precio confirmado a esa fecha». */
const SIN_PRECIO = 'RECURSO_NO_ENCONTRADO';

async function costoSiLoHay(id: string): Promise<CostoDeUso | null> {
  try {
    return await llamar<CostoDeUso>({ ruta: `/precios/costo/${id}` });
  } catch (fallo) {
    if (codigoDe(fallo) === SIN_PRECIO) return null;
    throw fallo;
  }
}

async function preciosDe(id: string): Promise<Precios> {
  const [historial, costo] = await Promise.all([
    llamar<readonly PrecioDelHistorial[]>({ ruta: `/precios?itemId=${id}` }),
    costoSiLoHay(id),
  ]);
  return { historial, costo };
}

export function useInsumo(id: string, conPrecios: boolean): Lectura<InsumoLeido> {
  const leer = useMemo(
    () => async (): Promise<InsumoLeido> => {
      const [ficha, precios] = await Promise.all([
        llamar<FichaDeItem>({ ruta: `/catalogo/items/${id}` }),
        conPrecios ? preciosDe(id) : Promise.resolve(null),
      ]);
      return { ficha, precios };
    },
    [id, conPrecios],
  );
  return useCarga(leer);
}

/** Lo editable de un ítem, tal como lo pide `PUT /catalogo/items/:id`. */
export interface CambioDeItem {
  readonly nombre: string;
  readonly rendimiento: string;
  readonly grupoId: string | null;
  readonly confianzaDePrecio: 'FACTURA' | 'ESTIMADO';
  readonly estado: 'ACTIVE' | 'INACTIVE';
  readonly llevaStock: boolean | null;
}

/**
 * `PUT` y no `PATCH`: el cuerpo lleva el estado completo de lo editable y la
 * `version` que se leyó. Si otra persona guardó antes, la API responde 409
 * `CONFLICTO_DE_VERSION` y conserva lo suyo (ADR-023).
 */
export function guardarItem(ficha: FichaDeItem, cambio: CambioDeItem): Promise<unknown> {
  return llamar({ ruta: `/catalogo/items/${ficha.id}`, metodo: 'PUT', cuerpo: { ...cambio, version: ficha.version } });
}

/** El estado editable actual de la ficha, para cambiar solo una parte. */
export function cambioDe(ficha: FichaDeItem): CambioDeItem {
  return {
    nombre: ficha.nombre,
    rendimiento: ficha.rendimiento,
    grupoId: ficha.grupoId,
    confianzaDePrecio: ficha.confianzaDePrecio,
    estado: ficha.estado,
    llevaStock: ficha.llevaStock,
  };
}
