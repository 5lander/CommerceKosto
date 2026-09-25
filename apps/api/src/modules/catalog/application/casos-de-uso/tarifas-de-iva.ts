/**
 * Las dos tarifas de IVA que el catálogo sabe de una compra — D-16.9.
 *
 * **ES EL PUERTO POR EL QUE `inventory` Y `pricing` LEEN LA TARIFA.** Ninguno
 * de los dos puede consultar `purchase_article` ni `item_group`: `catalog` es
 * la fuente única de verdad (CLAUDE.md §2) y la regla
 * `tablas-de-catalogo-solo-en-catalog` de `audit:forbidden` lo hace cumplir.
 * Lo que devuelve son los dos escalones de abajo de la precedencia
 * cuerpo > artículo > grupo; el de arriba lo conoce quien llama, y elegir es
 * de `shared/domain/iva/precedencia.ts`.
 *
 * **VALIDA QUE EL ARTÍCULO SEA DEL ÍTEM.** La clave foránea compuesta
 * `(purchase_article_id, item_id)` del libro ya lo impide en la base; sin esta
 * comprobación, un artículo de otro ítem saldría como `INTERNAL_ERROR 500` en
 * vez de decir qué está mal (INC-012). Y el artículo se busca por company,
 * así que uno ajeno es «no existe» y no «pertenece a otro» (CLAUDE.md §4.4).
 */

import {
  itemGroupId,
  type ItemId,
  type PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import {
  ArticuloNoEncontradoError,
  EntradaDeCatalogoInvalidaError,
  ItemNoEncontradoError,
} from '../../domain/errores';
import type { RepositorioDeCatalogo } from '../ports/repositorio-de-catalogo.port';

export interface DependenciasDeTarifas {
  readonly repositorio: RepositorioDeCatalogo;
}

export interface TarifasDelCatalogo {
  /** La del artículo, o `null` si la compra no trae artículo. */
  readonly articulo: string | null;
  /** La del grupo del ítem, o `null` si el ítem no tiene grupo o el grupo no define. */
  readonly grupo: string | null;
}

export class TarifasDeIva {
  public constructor(private readonly deps: DependenciasDeTarifas) {}

  /**
   * @throws {ItemNoEncontradoError} @throws {ArticuloNoEncontradoError}
   * @throws {EntradaDeCatalogoInvalidaError} el artículo es de otro ítem
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly itemId: ItemId; readonly purchaseArticleId: PurchaseArticleId | null },
  ): Promise<TarifasDelCatalogo> {
    const item = await this.deps.repositorio.buscarItem({
      companyId: sesion.companyId,
      itemId: entrada.itemId,
    });
    if (item === null) throw new ItemNoEncontradoError();

    const [articulo, grupo] = await Promise.all([
      this.tarifaDelArticulo(sesion, entrada),
      this.tarifaDelGrupo(sesion, item.grupoId),
    ]);

    return { articulo, grupo };
  }

  private async tarifaDelArticulo(
    sesion: SesionActiva,
    entrada: { readonly itemId: ItemId; readonly purchaseArticleId: PurchaseArticleId | null },
  ): Promise<string | null> {
    if (entrada.purchaseArticleId === null) return null;

    const articulo = await this.deps.repositorio.buscarArticulo({
      companyId: sesion.companyId,
      articuloId: entrada.purchaseArticleId,
    });
    if (articulo === null) throw new ArticuloNoEncontradoError();
    if (articulo.itemId !== entrada.itemId) {
      throw new EntradaDeCatalogoInvalidaError(
        'Ese artículo de compra pertenece a otro ítem: una compra se registra con un artículo del mismo ítem.',
      );
    }

    return articulo.ivaTarifa;
  }

  private async tarifaDelGrupo(sesion: SesionActiva, grupoId: string | null): Promise<string | null> {
    if (grupoId === null) return null;

    const grupo = await this.deps.repositorio.buscarGrupo({
      companyId: sesion.companyId,
      grupoId: itemGroupId(grupoId),
    });
    return grupo?.ivaTarifa ?? null;
  }
}

