/**
 * Escritura EN LOTE de precios de referencia.
 *
 * **LOS NOMBRES SE RESUELVEN AQUÍ, NO EN EL REPOSITORIO, Y NO ES UN CAPRICHO.**
 * Un archivo trae «Tomate riñón», no un UUID. Traducirlo exige leer `item` y
 * `purchase_article`, y `pricing` no puede: la regla
 * `tablas-de-catalogo-solo-en-catalog` de `audit:forbidden` lo impide, porque
 * `catalog` es la fuente única de verdad (CLAUDE.md §2). Así que la traducción
 * pasa por los puertos que `catalog` publica —`ListarItems`, `ListarArticulos`—,
 * que es exactamente la razón de que existan.
 *
 * **DOS LECTURAS PARA TODO EL LOTE, NO DOS POR FILA.** Con 149 precios, la
 * versión ingenua son 298 consultas.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import {
  PRIMERA_POSICION,
  clavePorNombre,
  type ProblemaDelLote,
} from '../../../../shared/domain/lote/problemas';
import type { ItemId, PurchaseArticleId } from '../../../../shared/domain/identity/identificadores';
import type { ListarArticulos } from '../../../catalog/application/casos-de-uso/articulos';
import type { ListarItems } from '../../../catalog/application/casos-de-uso/items';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { LoteDePreciosInvalidoError } from '../../domain/errores';
import { ivaDeLaCompany } from './precios';
import { problemasDelLoteDePrecios, type PrecioDelLote } from '../../domain/lote';
import type {
  DatosDePrecioEnLote,
  RepositorioDePrecios,
} from '../ports/repositorio-de-precios.port';

export interface DependenciasDeLotesDePrecios {
  readonly repositorio: RepositorioDePrecios;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
  readonly listarItems: ListarItems;
  readonly listarArticulos: ListarArticulos;
}

export interface DatosDelLoteDePrecios {
  readonly precios: readonly PrecioDelLote[];
  readonly validFrom: Date;
  /**
   * Si el lote nace vigente. **Lo decide una persona**, y por eso llega como
   * dato y no como valor por defecto: R5 exige que alguien confirme, no que
   * alguien confirme de uno en uno. Ver `domain/lote.ts`.
   */
  readonly confirmar: boolean;
}

interface Catalogo {
  readonly items: ReadonlyMap<string, { readonly id: ItemId; readonly tipo: string }>;
  readonly articulos: ReadonlyMap<string, PurchaseArticleId>;
}

export class SugerirPreciosEnLote {
  public constructor(private readonly deps: DependenciasDeLotesDePrecios) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDelLoteDePrecios): Promise<number> {
    const problemas = problemasDelLoteDePrecios(datos.precios);
    if (problemas.length > 0) throw new LoteDePreciosInvalidoError(problemas);

    const catalogo = await this.leerCatalogo(sesion);
    // La tasa de la company es solo el valor POR DEFECTO: la de la factura
    // manda sobre ella. En Ecuador el alimento sin procesar es 0 % y el
    // detergente 15 %, así que una única tasa estaría mal para uno de los dos.
    const iva = await ivaDeLaCompany(this.deps.repositorio, sesion.companyId);
    const resueltos = resolver(datos.precios, catalogo, iva);

    const filas = await this.deps.repositorio.sugerirEnLote({
      companyId: sesion.companyId,
      precios: resueltos,
      validFrom: datos.validFrom,
      createdBy: sesion.userId,
      confirmar: datos.confirmar,
      ahora: this.deps.reloj.ahora(),
    });

    await this.deps.auditoria.record({
      eventType: 'pricing.reference_prices.bulk_suggested',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { filas, confirmados: datos.confirmar },
    });

    return filas;
  }

  private async leerCatalogo(sesion: SesionActiva): Promise<Catalogo> {
    const items = await this.deps.listarItems.ejecutar(sesion, false);
    const articulos = await this.deps.listarArticulos.ejecutar(sesion, null);

    return {
      items: new Map(items.map((i) => [clavePorNombre(i.nombre), { id: i.id, tipo: i.tipo }])),
      articulos: new Map(articulos.map((a) => [clavePorNombre(a.nombre), a.id])),
    };
  }
}

/**
 * Traduce nombres a ids y recoge TODOS los motivos por los que una fila no se
 * puede resolver, no el primero.
 *
 * @throws {LoteDePreciosInvalidoError}
 */
function resolver(
  precios: readonly PrecioDelLote[],
  catalogo: Catalogo,
  ivaPorDefecto: string,
): readonly DatosDePrecioEnLote[] {
  const problemas: ProblemaDelLote[] = [];
  const resueltos: DatosDePrecioEnLote[] = [];

  for (const [indice, precio] of precios.entries()) {
    const resuelto = resolverUno(precio, catalogo, ivaPorDefecto);
    if (typeof resuelto === 'string') {
      problemas.push({ posicion: indice + PRIMERA_POSICION, motivo: resuelto });
      continue;
    }
    resueltos.push(resuelto);
  }

  if (problemas.length > 0) throw new LoteDePreciosInvalidoError(problemas);
  return resueltos;
}

/**
 * El artículo resuelto, o el motivo por el que no se puede.
 *
 * **ES UNA UNIÓN ETIQUETADA Y NO `Id | string`, Y ESA ES LA LECCIÓN.** La
 * primera versión devolvía `PurchaseArticleId | null | string` y discriminaba
 * con `typeof x === 'string'`. Parece razonable hasta que se recuerda que
 * `PurchaseArticleId` **es un `string` marcado**: en tiempo de ejecución la
 * marca no existe, así que un artículo ENCONTRADO daba `typeof === 'string'` y
 * se trataba como mensaje de error.
 *
 * El síntoma fue exacto y absurdo: las diez filas de un archivo de precios
 * rechazadas, cada una con un UUID por «motivo». Lo destapó importar un catálogo
 * de verdad, no una revisión de código.
 *
 * La regla que queda: **`typeof` no discrimina cuando uno de los éxitos también
 * es una cadena.** Con tipos marcados eso pasa más de lo que parece.
 */
type ArticuloResuelto =
  | { readonly clase: 'ok'; readonly id: PurchaseArticleId | null }
  | { readonly clase: 'falta'; readonly motivo: string };

/** El precio resuelto, o el motivo por el que no se puede. */
function resolverUno(
  precio: PrecioDelLote,
  catalogo: Catalogo,
  ivaPorDefecto: string,
): DatosDePrecioEnLote | string {
  const item = catalogo.items.get(clavePorNombre(precio.item));
  if (item === undefined) return `No existe ningún ítem llamado «${precio.item.trim()}».`;

  const articulo = articuloDe(precio, catalogo);
  if (articulo.clase === 'falta') return articulo.motivo;

  const coherencia = motivoDeIncoherencia(item.tipo, articulo.id);
  if (coherencia !== null) return coherencia;

  return {
    itemId: item.id,
    purchaseArticleId: articulo.id,
    precio: precio.precio,
    ivaCompra: precio.ivaCompra ?? ivaPorDefecto,
    origen: precio.origen,
    nota: precio.nota,
  };
}

function articuloDe(precio: PrecioDelLote, catalogo: Catalogo): ArticuloResuelto {
  // Una preparación PRODUCIDA no se compra: su precio es el costo estándar por
  // unidad de uso y no lleva artículo (R10). Eso es un éxito, no una falta.
  if (precio.articulo === null) return { clase: 'ok', id: null };

  const id = catalogo.articulos.get(clavePorNombre(precio.articulo));
  if (id === undefined) {
    return {
      clase: 'falta',
      motivo: `No existe ningún artículo de compra llamado «${precio.articulo.trim()}».`,
    };
  }

  return { clase: 'ok', id };
}

/**
 * La misma coherencia que `SugerirPrecio` comprueba una a una, y por el mismo
 * motivo: un trigger de la base ya lo impide, y sin esta guarda saldría como
 * `INTERNAL_ERROR 500` en vez de decir qué fila arreglar (INC-012).
 */
function motivoDeIncoherencia(tipo: string, articulo: PurchaseArticleId | null): string | null {
  if (tipo === 'COMPRADO' && articulo === null) {
    return 'El precio de un ítem comprado necesita su artículo: un importe sin presentación no dice cuánto cuesta la unidad de uso.';
  }
  if (tipo === 'PRODUCIDO' && articulo !== null) {
    return 'Una preparación producida no se compra: su precio es el costo estándar por unidad de uso, sin artículo (R10).';
  }
  return null;
}
