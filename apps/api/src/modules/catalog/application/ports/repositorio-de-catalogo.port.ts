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

import type { DesenlaceVersionado } from '../../../../shared/application/concurrencia';
import type {
  CompanyId,
  ItemGroupId,
  ItemId,
  PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import type {
  ResultadoDeLote,
  ResultadoDeLoteConLimite,
} from '../../../../shared/application/lote';
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
  /**
   * La versión del ítem (D-16.100, ADR-023). La devuelve toda lectura porque
   * es lo que el formulario manda de vuelta al guardar: si otra persona
   * escribió entre medias, la escritura sale con 409 en vez de pisarla.
   */
  readonly version: number;
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
  /** Fracción, como cadena. La tarifa de IVA de ESTE artículo (D-16.9). */
  readonly ivaTarifa: string;
  readonly estado: string;
}

export interface GrupoLeido {
  readonly id: ItemGroupId;
  readonly nombre: string;
  /** `null` = «el grupo no define tarifa»: las compras sin artículo se rechazan. */
  readonly ivaTarifa: string | null;
}

/**
 * Una unidad del catálogo **tal como se publica**, que no es lo mismo que la
 * `UnidadDelCatalogo` del dominio.
 *
 * Esta lleva el `nombre` legible («kilogramo») y NO lleva `factorABase`; la del
 * dominio es justo al revés. No es duplicación: son dos lecturas con dos
 * propósitos. El factor es un `Ratio` que sirve para multiplicar y no significa
 * nada en una pantalla —y serializarlo tal cual expondría el interior del tipo
 * decimal, que es lo que ADR-003 prohíbe—; el nombre no entra en ningún
 * cálculo, y meterlo en el tipo del dominio sería presentación dentro de la
 * única parte del módulo que corre con la base apagada.
 */
export interface UnidadLeida {
  readonly codigo: string;
  readonly nombre: string;
  readonly dimension: string;
}

export type ResultadoDeAlta<T> =
  | { readonly clase: 'creado'; readonly id: T }
  | { readonly clase: 'nombre_en_uso' };

/**
 * El resultado de un cambio. `nombre_en_uso` existe porque renombrar choca con
 * el índice único igual que crear, y un `P2002` a mitad de un `PUT` sería un
 * 500 que no dice qué nombre sobra (INC-012).
 */
export type ResultadoDeCambio = 'actualizado' | 'no_encontrado' | 'nombre_en_uso';

/**
 * El desenlace del lote de ARTÍCULOS, que tiene dos choques distintos.
 *
 * `nombres_en_uso` significa aquí, heredado, «estos ítems NO existen»: los
 * artículos apuntan a su ítem por nombre y un archivo puede nombrar uno que
 * nadie ha creado. `articulos_en_uso` es el otro, y es el que faltaba: los
 * nombres de ARTÍCULO que ya están en la company. Reimportar el mismo archivo
 * chocaba con `purchase_article_company_id_name_key` y salía como **500**.
 *
 * Se añade aquí y no como variante de `ResultadoDeLote`, que es compartido por
 * cuatro módulos: los otros tres tendrían que tratar un caso que en ellos no
 * puede ocurrir, y una rama muerta que el compilador exige se lee como si
 * pudiera pasar.
 */
export type ResultadoDeLoteDeArticulos =
  | ResultadoDeLote
  | { readonly clase: 'articulos_en_uso'; readonly nombres: readonly string[] };

/**
 * El alta de un ITEM, que ademas puede toparse con el limite del plan (D5).
 *
 * Grupos y articulos no llevan limite y por eso no comparten este tipo: una
 * variante que nunca ocurre obliga a escribir una rama muerta que se lee como
 * si pudiera ocurrir.
 */
export type ResultadoDeAltaDeItem =
  | ResultadoDeAlta<ItemId>
  | { readonly clase: 'limite'; readonly maximo: number };

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
  /** La versión que el formulario leyó. Solo se escribe si sigue siendo esa. */
  readonly versionEsperada: number;
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
  /** Ya validada por el dominio como fracción. */
  readonly ivaTarifa: string;
}

/**
 * Lo editable de un artículo. La presentación, su unidad y el factor NO: son
 * lo que convierte cada compra histórica a unidades de uso, y cambiarlos
 * reescribiría el costo de meses ya cerrados. Para eso se crea otro artículo.
 */
export interface DatosParaActualizarArticulo {
  readonly companyId: CompanyId;
  readonly articuloId: PurchaseArticleId;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly ivaTarifa: string;
  readonly estado: EstadoDeCatalogo;
}

export interface DatosParaActualizarGrupo {
  readonly companyId: CompanyId;
  readonly grupoId: ItemGroupId;
  readonly nombre: string;
  readonly ivaTarifa: string | null;
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
  /** Ya resuelta por el caso de uso: fila > grupo del ítem (D-16.44). */
  readonly ivaTarifa: string;
}

export interface RepositorioDeCatalogo {
  /**
   * El catálogo GLOBAL de unidades. Sin tenant: un kilogramo pesa lo mismo en
   * todas las companies.
   */
  unidades(): Promise<readonly UnidadDelCatalogo[]>;

  /**
   * El mismo catálogo, en la forma que se publica: código, nombre y dimensión.
   * Ver `UnidadLeida` para por qué son dos lecturas y no una.
   */
  listarUnidades(): Promise<readonly UnidadLeida[]>;

  crearGrupo(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly ivaTarifa: string | null;
  }): Promise<ResultadoDeAlta<ItemGroupId>>;

  listarGrupos(companyId: CompanyId): Promise<readonly GrupoLeido[]>;

  /** `null` si no existe en esa company. */
  buscarGrupo(entrada: {
    readonly companyId: CompanyId;
    readonly grupoId: ItemGroupId;
  }): Promise<GrupoLeido | null>;

  actualizarGrupo(datos: DatosParaActualizarGrupo): Promise<ResultadoDeCambio>;

  crearItem(datos: DatosParaCrearItem): Promise<ResultadoDeAltaDeItem>;

  /**
   * `no_encontrado` si el ítem no existe en esa company; `nombre_en_uso` si el
   * nombre nuevo ya lo tiene otro ítem. Devolvía un `boolean` y el choque de
   * nombres salía como **500** del índice único (P16-A2). Y desde P16-B,
   * `conflicto_de_version` si otra escritura llegó antes (D-16.100).
   */
  actualizarItem(
    datos: DatosParaActualizarItem,
  ): Promise<DesenlaceVersionado | { readonly clase: 'nombre_en_uso' }>;

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
  }): Promise<ResultadoDeLoteConLimite>;

  crearArticulo(datos: DatosParaCrearArticulo): Promise<ResultadoDeAlta<PurchaseArticleId>>;

  /** Todo el lote o nada, en una sola transacción. Ver `crearItemsEnLote`. */
  crearArticulosEnLote(datos: {
    readonly companyId: CompanyId;
    readonly articulos: readonly DatosDeArticuloEnLote[];
  }): Promise<ResultadoDeLoteDeArticulos>;

  listarArticulos(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId | null;
  }): Promise<readonly ArticuloLeido[]>;

  /** `null` si no existe en esa company. */
  buscarArticulo(entrada: {
    readonly companyId: CompanyId;
    readonly articuloId: PurchaseArticleId;
  }): Promise<ArticuloLeido | null>;

  actualizarArticulo(datos: DatosParaActualizarArticulo): Promise<ResultadoDeCambio>;
}
