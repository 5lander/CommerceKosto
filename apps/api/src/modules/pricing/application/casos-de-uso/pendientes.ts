/**
 * La bandeja de precios pendientes de confirmar — R5, pantalla 9, D-16.108.
 *
 * **R5 SIN BANDEJA ES R5 EN EL PAPEL.** «Ningún precio se mueve solo» significa
 * que alguien tiene que confirmar cada sugerido; si para encontrarlos hay que
 * abrir ítem por ítem, los sugeridos se quedan sugeridos y el costo sigue con el
 * precio del año pasado.
 *
 * **CADA FILA LLEVA EL PRECIO VIGENTE DE SU ÍTEM**, para decidir «subió de 2,10
 * a 2,45» y no sobre un número suelto. Cuál está vigente lo decide
 * `precioVigenteA`, el mismo de siempre. Es por ítem y no por artículo: el costo
 * de uso sale del precio vigente del ítem, sea del artículo que sea.
 *
 * **LOS NOMBRES SE UNEN AQUÍ** (D-16.83): `pricing` no puede leer las tablas del
 * catálogo, y pedírselos por sus puertos son dos consultas fijas, no una por fila.
 * Cuatro consultas en total, cualquiera sea el tamaño de la bandeja.
 */

import type { ItemId, PurchaseArticleId, ReferencePriceId } from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { precioVigenteA } from '../../domain/vigencia';
import type { PrecioLeido } from '../ports/repositorio-de-precios.port';
import type { DependenciasDePrecios } from './precios';

export interface PrecioPendiente extends PrecioLeido {
  readonly itemNombre: string;
  /** `null` en una preparación: su precio es costo estándar, sin artículo (R10). */
  readonly articuloNombre: string | null;
  /** El precio confirmado que manda hoy para ese ítem, o `null` si todavía no hay ninguno. */
  readonly precioVigente: string | null;
}

export interface PaginaDePendientes {
  readonly pendientes: readonly PrecioPendiente[];
  /** El cursor de la página siguiente, o `null` si esta es la última. */
  readonly siguiente: ReferencePriceId | null;
}

export class PreciosPendientes {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly despuesDe: ReferencePriceId | null; readonly limite: number },
  ): Promise<PaginaDePendientes> {
    const ahora = this.deps.reloj.ahora();
    const [sugeridos, items, articulos, confirmados] = await Promise.all([
      this.deps.repositorio.sugeridos({ companyId: sesion.companyId, ...entrada }),
      this.deps.listarItems.ejecutar(sesion, false),
      this.deps.listarArticulos.ejecutar(sesion, null),
      this.deps.repositorio.confirmadosHasta({ companyId: sesion.companyId, hasta: ahora }),
    ]);

    const nombresDeItem = new Map<ItemId, string>(items.map((i) => [i.id, i.nombre]));
    const nombresDeArticulo = new Map<PurchaseArticleId, string>(articulos.map((a) => [a.id, a.nombre]));
    const vigentes = vigentesPorItem(confirmados, ahora);

    const ultimo = sugeridos.at(-1);
    return {
      pendientes: sugeridos.map((p) => ({
        ...p,
        itemNombre: nombresDeItem.get(p.itemId) ?? '',
        articuloNombre: p.purchaseArticleId === null ? null : (nombresDeArticulo.get(p.purchaseArticleId) ?? ''),
        precioVigente: vigentes.get(p.itemId) ?? null,
      })),
      siguiente: sugeridos.length === entrada.limite && ultimo !== undefined ? ultimo.id : null,
    };
  }
}

function vigentesPorItem(confirmados: readonly PrecioLeido[], ahora: Date): ReadonlyMap<ItemId, string> {
  const porItem = new Map<ItemId, PrecioLeido[]>();
  for (const precio of confirmados) {
    porItem.set(precio.itemId, [...(porItem.get(precio.itemId) ?? []), precio]);
  }

  const vigentes = new Map<ItemId, string>();
  for (const [itemId, precios] of porItem) {
    const vigente = precioVigenteA(precios, ahora);
    if (vigente !== null) vigentes.set(itemId, vigente.precio);
  }
  return vigentes;
}
