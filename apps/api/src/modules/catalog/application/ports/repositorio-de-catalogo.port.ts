/**
 * Lo que el catálogo necesita de la persistencia.
 *
 * `catalog` ES LA FUENTE ÚNICA DE VERDAD (CLAUDE.md §2): ningún otro módulo
 * crea, edita ni borra ítems, artículos ni unidades. Este puerto es la
 * superficie completa de escritura del catálogo en todo el sistema, y una regla
 * de `dependency-cruiser` impide que otro módulo importe la implementación.
 *
 * LOS RESULTADOS SON UNIONES, NO EXCEPCIONES, donde el «fallo» es una respuesta
 * legítima. Un nombre repetido no es un error del programa: es algo que pasa
 * todos los días al capturar un catálogo. Modelarlo en el tipo obliga a
 * tratarlo; un `throw` se olvida.
 */

import type {
  CompanyId,
  ItemGroupId,
  ItemId,
  PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import type { ResultadoDeLote } from '../../../../shared/application/lote';
import type { UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { UnidadDelCatalogo } from '../../domain/conversion';
import type { ConfianzaDePrecio, TipoDeItem } from '../../domain/item';

export const REPOSITORIO_DE_CATALOGO = 'REPOSITORIO_DE_CATALOGO';

export type EstadoDeCatalogo = 'ACTIVE' | 'INACTIVE';

export interface ItemLeido {
  readonly id: ItemId;
  readonly nombre: string;
  readonly tipo: string;
  readonly unidadDeUso: string;
  /** Decimal exacto como cadena: nunca sale de la base como `number`. */
  readonly rendimiento: string;
  readonly grupoId: string | null;
  readonly estado: string;
  readonly confianzaDePrecio: string;
  readonly llevaStock: boolean | null;
}

export interface ArticuloLeido {
  readonly id: PurchaseArticleId;
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
  readonly factorDeConversion: string;
  readonly estado: string;
}

export interface GrupoLeido {
  readonly id: ItemGroupId;
  readonly nombre: string;
}

export type ResultadoDeAlta<T> =
  | { readonly clase: 'creado'; readonly id: T }
  | { readonly clase: 'nombre_en_uso' };

export interface DatosParaCrearItem {
  readonly companyId: CompanyId;
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly unidadDeUso: UnidadDeUso;
  readonly rendimiento: string;
  readonly grupoId: ItemGroupId | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly llevaStock: boolean | null;
}

export interface DatosParaActualizarItem {
  readonly companyId: CompanyId;
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly rendimiento: string;
  readonly grupoId: ItemGroupId | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly estado: EstadoDeCatalogo;
  /** El interruptor de stock de una preparación (P6). `null` en un COMPRADO. */
  readonly llevaStock: boolean | null;
}

export interface DatosParaCrearArticulo {
  readonly companyId: CompanyId;
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: UnidadDeUso;
  /** Ya calculado por el dominio: aquí solo se guarda. */
  readonly factorDeConversion: string;
}

/**
 * Un ítem dentro de un LOTE. El grupo llega por NOMBRE, no por id: quien migra
 * un catálogo tiene la columna «Grupo» escrita, no una clave que aún no existe.
 * El repositorio crea los que falten dentro de la misma transacción.
 */
export interface DatosDeItemEnLote {
  readonly nombre: string;
  readonly tipo: TipoDeItem;
  readonly unidadDeUso: UnidadDeUso;
  readonly rendimiento: string;
  readonly grupo: string | null;
  readonly confianzaDePrecio: ConfianzaDePrecio;
  readonly llevaStock: boolean | null;
}

/** Un artículo dentro de un LOTE. El ítem llega por NOMBRE, por lo mismo. */
export interface DatosDeArticuloEnLote {
  readonly item: string;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: UnidadDeUso;
  readonly factorDeConversion: string;
}

export interface RepositorioDeCatalogo {
  /**
   * El catálogo GLOBAL de unidades. Sin tenant: un kilogramo pesa lo mismo en
   * todas las companies.
   */
  unidades(): Promise<readonly UnidadDelCatalogo[]>;

  crearGrupo(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
  }): Promise<ResultadoDeAlta<ItemGroupId>>;

  listarGrupos(companyId: CompanyId): Promise<readonly GrupoLeido[]>;

  crearItem(datos: DatosParaCrearItem): Promise<ResultadoDeAlta<ItemId>>;

  /** @returns `false` si el ítem no existe en esa company. */
  actualizarItem(datos: DatosParaActualizarItem): Promise<boolean>;

  listarItems(entrada: {
    readonly companyId: CompanyId;
    readonly soloActivos: boolean;
  }): Promise<readonly ItemLeido[]>;

  /** `null` si no existe en esa company. */
  buscarItem(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId;
  }): Promise<ItemLeido | null>;

  /**
   * Escribe TODO el lote o no escribe nada, en **una sola transacción**.
   *
   * Es la razón de que este método exista en vez de un bucle sobre `crearItem`:
   * cada método de este repositorio abre su propia transacción, así que un
   * bucle de doscientas altas son doscientas transacciones y la fila 150 mala
   * dejaría escritas las 149 buenas.
   *
   * Crea también los grupos que falten, dentro de esa misma transacción.
   */
  crearItemsEnLote(datos: {
    readonly companyId: CompanyId;
    readonly items: readonly DatosDeItemEnLote[];
  }): Promise<ResultadoDeLote>;

  crearArticulo(datos: DatosParaCrearArticulo): Promise<ResultadoDeAlta<PurchaseArticleId>>;

  /** Todo el lote o nada, en una sola transacción. Ver `crearItemsEnLote`. */
  crearArticulosEnLote(datos: {
    readonly companyId: CompanyId;
    readonly articulos: readonly DatosDeArticuloEnLote[];
  }): Promise<ResultadoDeLote>;

  listarArticulos(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId | null;
  }): Promise<readonly ArticuloLeido[]>;
}
