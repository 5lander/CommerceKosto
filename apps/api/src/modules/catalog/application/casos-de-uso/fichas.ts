/**
 * Las dos fichas del catálogo: un ítem y un artículo de compra, cada uno con lo
 * que hace falta para pintar su pantalla de una sola llamada.
 *
 * **LA PERTENENCIA VA EN LA CONSULTA, NO EN UN `if` POSTERIOR** (CLAUDE.md
 * §4.4). Las cuatro lecturas que usan estas dos fichas llevan `companyId` en su
 * WHERE, así que un identificador de otra company no devuelve una fila que
 * luego haya que descartar: no devuelve nada. La diferencia importa porque un
 * `if` se puede olvidar al añadir la quinta lectura y un WHERE no.
 *
 * **Y UN RECURSO AJENO ES 404, NUNCA 403.** «No existe» y «existe y no es tuyo»
 * tienen que ser indistinguibles: la segunda respuesta convertiría el endpoint
 * en un oráculo para averiguar qué ítems tiene otro restaurante.
 *
 * **NADA DE ESTO ES CONFIDENCIAL FRENTE A `BODEGA`** (CLAUDE.md §4.3). Lo que
 * esa lista protege son las líneas de receta y todo lo que permite despejarlas
 * —consumo teórico, stock teórico, costo de plato—; un ítem con su unidad y su
 * rendimiento, y un artículo con su presentación, no son ninguna de las dos
 * cosas, y `BODEGA` ya los lee en las listas desde P2 porque los necesita para
 * contar inventario. Estas fichas no añaden ni un campo nuevo: componen lo que
 * ya se publicaba por separado.
 */

import { itemGroupId, type ItemId, type PurchaseArticleId } from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { ArticuloNoEncontradoError, ItemNoEncontradoError } from '../../domain/errores';
import type {
  ArticuloLeido,
  GrupoLeido,
  ItemLeido,
  RepositorioDeCatalogo,
} from '../ports/repositorio-de-catalogo.port';

export interface DependenciasDeFichas {
  readonly repositorio: RepositorioDeCatalogo;
}

/**
 * El ítem, su grupo entero y sus artículos.
 *
 * `grupoId` sigue estando además de `grupo`, y es a propósito: así la ficha es
 * un SUPERCONJUNTO de la fila de la lista y el cliente puede usar el mismo tipo
 * para las dos. El `grupo` trae el nombre —que la lista no tiene— y su
 * `ivaTarifa`, que es la que heredan las compras sin artículo (D-16.9) y por
 * tanto la que explica de dónde sale el IVA de este ítem.
 */
export interface FichaDeItem extends ItemLeido {
  readonly grupo: GrupoLeido | null;
  readonly articulos: readonly ArticuloLeido[];
}

/** El artículo y el ítem al que pertenece, que es lo que la pantalla titula. */
export interface FichaDeArticulo extends ArticuloLeido {
  readonly item: ItemLeido;
}

export class LeerFichaDeItem {
  public constructor(private readonly deps: DependenciasDeFichas) {}

  /** @throws {ItemNoEncontradoError} también si el ítem es de otra company. */
  public async ejecutar(sesion: SesionActiva, id: ItemId): Promise<FichaDeItem> {
    const { companyId } = sesion;

    const item = await this.deps.repositorio.buscarItem({ companyId, itemId: id });
    if (item === null) throw new ItemNoEncontradoError();

    // En paralelo: son dos lecturas independientes y la ficha necesita las dos.
    const [grupo, articulos] = await Promise.all([
      item.grupoId === null
        ? null
        : this.deps.repositorio.buscarGrupo({ companyId, grupoId: itemGroupId(item.grupoId) }),
      this.deps.repositorio.listarArticulos({ companyId, itemId: id }),
    ]);

    return { ...item, grupo, articulos };
  }
}

export class LeerFichaDeArticulo {
  public constructor(private readonly deps: DependenciasDeFichas) {}

  /** @throws {ArticuloNoEncontradoError} @throws {ItemNoEncontradoError} */
  public async ejecutar(sesion: SesionActiva, id: PurchaseArticleId): Promise<FichaDeArticulo> {
    const { companyId } = sesion;

    const articulo = await this.deps.repositorio.buscarArticulo({ companyId, articuloId: id });
    if (articulo === null) throw new ArticuloNoEncontradoError();

    // La clave foránea garantiza que el ítem existe; el `null` es la carrera
    // con un archivado, y se dice como lo que es en vez de reventar al leer.
    const item = await this.deps.repositorio.buscarItem({ companyId, itemId: articulo.itemId });
    if (item === null) throw new ItemNoEncontradoError();

    return { ...articulo, item };
  }
}
