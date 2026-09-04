/**
 * Lo que `recipes` necesita de la persistencia.
 *
 * `guardarVersion` NO ES «actualizar una receta». Crea una **versión nueva** con
 * su vigencia, y la anterior queda consultable: los costeos históricos no se
 * recalculan (SPEC §9). Un trigger impide `UPDATE` sobre `recipe`, así que ni
 * siquiera hay una forma de equivocarse.
 *
 * `grafoDeItems` DEVUELVE EL GRAFO ENTERO de subpreparaciones de la ubicación,
 * y eso es deliberado. La validación de ciclos es dominio puro y necesita el
 * grafo delante; pedirlo nodo a nodo sería un N+1 dentro de un recorrido en
 * profundidad, y el presupuesto de 150 ms para guardar una receta (CLAUDE.md
 * §5) no lo aguanta. Son decenas de subpreparaciones por ubicación, no miles.
 */

import type {
  CompanyId,
  ItemId,
  LocationId,
  ProductId,
  RecipeId,
  RecipePropagationId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { GrafoDeItems } from '../../domain/ciclos';
import type { BaseDeLinea, EstadoDeLinea } from '../../domain/linea-de-receta';

export const REPOSITORIO_DE_RECETAS = 'REPOSITORIO_DE_RECETAS';

export type TipoDeProducto = 'SIMPLE' | 'COMBO';

/**
 * El destino de una receta: un producto de venta o una subpreparación.
 *
 * ES UNA UNIÓN Y NO DOS CAMPOS ANULABLES. Con dos campos cabría una receta sin
 * destino y una con dos, y las dos son estados que nadie sabe interpretar. La
 * base lo sostiene con un `CHECK`; el tipo lo sostiene aquí.
 */
export type DestinoDeReceta =
  | { readonly clase: 'producto'; readonly productId: ProductId }
  | { readonly clase: 'item'; readonly itemId: ItemId };

export interface ProductoLeido {
  readonly id: ProductId;
  readonly nombre: string;
  readonly tipo: string;
  readonly categoria: string | null;
  readonly estado: string;
}

export interface ProductoEnUbicacion {
  readonly locationId: LocationId;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

export interface LineaLeida {
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
  readonly orden: number;
}

export interface RecetaLeida {
  readonly id: RecipeId;
  readonly locationId: LocationId;
  readonly estado: string;
  readonly validFrom: Date;
  readonly nota: string | null;
  readonly lineas: readonly LineaLeida[];
}

export interface LineaParaGuardar {
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
}

export interface DatosDeVersion {
  readonly companyId: CompanyId;
  readonly destino: DestinoDeReceta;
  readonly locationId: LocationId;
  readonly lineas: readonly LineaParaGuardar[];
  readonly validFrom: Date;
  readonly createdBy: UserId;
  readonly nota: string | null;
  /** `VOID` deja constancia de «aquí no hay receta» sin borrar nada. */
  readonly estado: 'ACTIVE' | 'VOID';
}

/** Qué le pasaría a cada ubicación si se propagara. R11 exige mostrarlo antes. */
export interface DestinoDePropagacion {
  readonly locationId: LocationId;
  readonly nombre: string;
  /** `true` si esa ubicación ya tiene una receta propia que se perdería. */
  readonly personalizada: boolean;
  readonly recetaActual: RecipeId | null;
}

export interface PropagacionLeida {
  readonly id: RecipePropagationId;
  readonly productId: ProductId;
  readonly propagadaEn: Date;
  readonly revertidaEn: Date | null;
  readonly destinos: readonly DestinoPropagado[];
}

/** Lo que le pasó a UNA ubicación en una propagación. */
export interface DestinoPropagado {
  readonly locationId: LocationId;
  readonly anterior: RecipeId | null;
  readonly creada: RecipeId;
}

export interface DatosDePropagacionRegistrada {
  readonly companyId: CompanyId;
  readonly productId: ProductId;
  readonly sourceRecipeId: RecipeId;
  readonly propagatedBy: UserId;
  readonly destinos: readonly DestinoPropagado[];
}

export type ResultadoDeAltaDeProducto =
  | { readonly clase: 'creado'; readonly id: ProductId }
  | { readonly clase: 'nombre_en_uso' };

export interface RepositorioDeRecetas {
  crearProducto(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly tipo: TipoDeProducto;
    readonly categoria: string | null;
  }): Promise<ResultadoDeAltaDeProducto>;

  listarProductos(companyId: CompanyId): Promise<readonly ProductoLeido[]>;

  buscarProducto(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
  }): Promise<ProductoLeido | null>;

  /** Activación, PVP y rendimiento por lote de un producto en una ubicación. */
  configurarEnUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly locationId: LocationId;
    readonly activo: boolean;
    readonly pvp: string | null;
    readonly rendimientoPorciones: string | null;
  }): Promise<void>;

  ubicacionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
  }): Promise<readonly ProductoEnUbicacion[]>;

  /**
   * El grafo de subpreparaciones de una ubicación, para validar ciclos sin
   * volver a la base por cada nodo.
   */
  grafoDeItems(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<GrafoDeItems>;

  guardarVersion(datos: DatosDeVersion): Promise<RecipeId>;

  /** La versión vigente a una fecha, o `null` si no hay ninguna activa. */
  recetaVigente(entrada: {
    readonly companyId: CompanyId;
    readonly destino: DestinoDeReceta;
    readonly locationId: LocationId;
    readonly fecha: Date;
  }): Promise<RecetaLeida | null>;

  versionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly destino: DestinoDeReceta;
    readonly locationId: LocationId;
  }): Promise<readonly RecetaLeida[]>;

  /** Las ubicaciones donde el producto está activo, con su receta actual. */
  destinosDePropagacion(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly origen: LocationId;
  }): Promise<readonly DestinoDePropagacion[]>;

  registrarPropagacion(entrada: DatosDePropagacionRegistrada): Promise<RecipePropagationId>;

  buscarPropagacion(entrada: {
    readonly companyId: CompanyId;
    readonly propagacionId: RecipePropagationId;
  }): Promise<PropagacionLeida | null>;

  /** Marca la propagación como revertida. Falla si ya lo estaba. */
  marcarRevertida(entrada: {
    readonly companyId: CompanyId;
    readonly propagacionId: RecipePropagationId;
    readonly userId: UserId;
    readonly ahora: Date;
  }): Promise<boolean>;

  lineasDe(entrada: {
    readonly companyId: CompanyId;
    readonly recipeId: RecipeId;
  }): Promise<readonly LineaLeida[]>;
}
