/**
 * Qué es un ítem válido — SPEC §5.
 *
 * DELIBERADAMENTE REDUNDANTE CON LA BASE. Cada regla de aquí tiene su `CHECK`
 * en la migración, y eso es lo correcto: la base es la que garantiza, y esto es
 * lo que explica. La diferencia se nota cuando algo falla — un `23514` del
 * driver no le dice nada a quien está capturando un ítem; «el rendimiento es la
 * fracción que queda tras limpiar: no puede pasar de 1» sí.
 *
 * LA REGLA QUE MÁS IMPORTA ES LA DEL RENDIMIENTO, y no es evidente por qué.
 * `costo_neto_uso = costo_bruto_uso / rendimiento` (SPEC §12): dividir por él
 * **encarece** el ítem, porque es el costo de comprar producto que se pierde al
 * limpiarlo. Un rendimiento de 1.2 haría el ítem más barato que su precio de
 * compra —limpiar crearía materia— y el número saldría plausible en pantalla.
 * Por eso el techo es 1 y está en dos sitios.
 *
 * ES DOMINIO PURO.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';

export type TipoDeItem = 'COMPRADO' | 'PRODUCIDO';
export type ConfianzaDePrecio = 'FACTURA' | 'ESTIMADO';

export const LARGO_MAXIMO_DE_NOMBRE = 200;

const RENDIMIENTO_MAXIMO = Ratio.UNO;

export type ProblemaDeItem =
  | { readonly clase: 'nombre_vacio' }
  | { readonly clase: 'nombre_largo'; readonly maximo: number }
  | { readonly clase: 'rendimiento_fuera_de_rango' }
  | { readonly clase: 'stock_solo_en_producido' }
  | { readonly clase: 'producido_sin_decidir_stock' };

export interface DatosDeItem {
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly rendimiento: Ratio;
  /**
   * Solo para `PRODUCIDO`: si la preparación se produce en lote y aparece en
   * inventario, o si al vender se explota su receta (SPEC §5). El costeo es
   * idéntico en los dos casos; lo que cambia es el inventario, que llega en P6.
   */
  readonly llevaStock: boolean | null;
}

/** @returns `null` si el ítem es válido. */
export function problemaDeItem(datos: DatosDeItem): ProblemaDeItem | null {
  const nombre = datos.nombre.trim();

  if (nombre.length === 0) {
    return { clase: 'nombre_vacio' };
  }
  if (nombre.length > LARGO_MAXIMO_DE_NOMBRE) {
    return { clase: 'nombre_largo', maximo: LARGO_MAXIMO_DE_NOMBRE };
  }
  if (datos.rendimiento.isNegative() || datos.rendimiento.greaterThan(RENDIMIENTO_MAXIMO)) {
    return { clase: 'rendimiento_fuera_de_rango' };
  }
  if (datos.tipo === 'PRODUCIDO' && datos.llevaStock === null) {
    return { clase: 'producido_sin_decidir_stock' };
  }
  if (datos.tipo !== 'PRODUCIDO' && datos.llevaStock !== null) {
    return { clase: 'stock_solo_en_producido' };
  }

  return null;
}

const MENSAJES: Readonly<Record<ProblemaDeItem['clase'], string>> = {
  nombre_vacio: 'El ítem necesita un nombre.',
  nombre_largo: `El nombre no puede pasar de ${String(LARGO_MAXIMO_DE_NOMBRE)} caracteres.`,
  rendimiento_fuera_de_rango:
    'El rendimiento es la fracción que queda tras limpiar el producto: va entre 0 y 1. ' +
    'Un valor mayor que 1 haría el ítem más barato que su precio de compra.',
  stock_solo_en_producido: 'Solo una preparación decide si lleva stock; un ítem comprado siempre lo lleva.',
  producido_sin_decidir_stock:
    'Una preparación tiene que decir si se produce en lote —y aparece en inventario— o si al ' +
    'vender se explota su receta.',
};

export function mensajeDelProblemaDeItem(problema: ProblemaDeItem): string {
  return MENSAJES[problema.clase];
}
