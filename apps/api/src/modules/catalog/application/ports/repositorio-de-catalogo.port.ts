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

  crearArticulo(datos: DatosParaCrearArticulo): Promise<ResultadoDeAlta<PurchaseArticleId>>;

  listarArticulos(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId | null;
  }): Promise<readonly ArticuloLeido[]>;
}
