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
import type { DesenlaceVersionado } from '../../../../shared/application/concurrencia';
import type { GrafoDeItems } from '../../domain/ciclos';
import type { ResultadoDeLoteConLimite } from '../../../../shared/application/lote';
import type { BaseDeLinea, EstadoDeLinea, TipoDeProducto } from '../../domain/linea-de-receta';

// Se reexporta para que quien ya lo importaba de aqui no tenga que cambiar: el
// tipo es de dominio, pero este puerto sigue siendo su puerta natural.
export type { TipoDeProducto };

export const REPOSITORIO_DE_RECETAS = 'REPOSITORIO_DE_RECETAS';

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
  /**
   * El ítem que hace de empaque (SPEC §14, ADR-008). `null` = no lleva.
   *
   * Es un ítem y no una tabla propia: se compra, tiene artículo, tiene precio
   * con vigencia. `empaque_neto` es su `costo_neto_uso`, sin fórmula nueva.
   */
  readonly empaqueItemId: ItemId | null;
  /**
   * La versión del agregado producto (D-16.100, ADR-023): sube con el
   * empaque, con la configuración de cualquier ubicación y con los
   * componentes de combo. Toda escritura de esas tres exige la leída.
   */
  readonly version: number;
}

/**
 * Lo que cambia de un local a otro: si el producto se vende ahí, a qué precio y
 * cuántas porciones salen de su lote (SPEC §8).
 */
export interface ConfiguracionEnUbicacion {
  readonly activo: boolean;
  /** PVP CON IVA (R14). `null` = todavía sin precio fijado. */
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

/** La configuración vista desde el producto: en qué ubicaciones está. */
export interface ProductoEnUbicacion extends ConfiguracionEnUbicacion {
  readonly locationId: LocationId;
}

export interface LineaLeida {
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
  readonly orden: number;
}

/** La misma configuración vista desde la ubicación: qué productos tiene. */
export interface ProductoConUbicacion extends ConfiguracionEnUbicacion {
  readonly productId: ProductId;
}

export interface ComponenteDeCombo {
  readonly comboProductId: ProductId;
  readonly componentProductId: ProductId;
  readonly cantidad: string;
}

export interface RecetaLeida {
  readonly id: RecipeId;
  readonly locationId: LocationId;
  readonly estado: string;
  readonly validFrom: Date;
  readonly nota: string | null;
  readonly lineas: readonly LineaLeida[];
}

/** Una receta vigente con su destino dentro: es lo que devuelve la carga en lote. */
export interface RecetaVigenteLeida extends RecetaLeida {
  readonly destino: DestinoDeReceta;
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
  readonly testigo: TestigoDeReceta;
}

/**
 * Sobre qué versión se editó la receta (D-16.101).
 *
 * `comprobar` es lo del formulario: `basadaEn` es la última versión creada de
 * ese destino en esa ubicación cuando se abrió, o `null` si no había ninguna.
 * Si al guardar la última ya es otra, no se escribe.
 *
 * `sobrescribir` es lo de la propagación y su reversión: R11 ya exigió ver
 * antes qué se pierde, y sobrescribir es exactamente lo que se pidió. Pasa
 * igual por el mismo candado, para que un formulario abierto en ese local se
 * entere con un 409.
 */
export type TestigoDeReceta =
  | { readonly clase: 'comprobar'; readonly basadaEn: RecipeId | null }
  | { readonly clase: 'sobrescribir' };

export type ResultadoDeGuardadoDeReceta =
  | { readonly clase: 'guardada'; readonly id: RecipeId }
  | { readonly clase: 'conflicto_de_version' };

/** Un componente dentro del reemplazo de la lista de un combo. */
export interface ComponenteParaGuardar {
  readonly componentProductId: ProductId;
  readonly cantidad: string;
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
  | { readonly clase: 'nombre_en_uso' }
  /** El limite de productos del plan (D5), comprobado con candado al insertar. */
  | { readonly clase: 'limite'; readonly maximo: number };

/**
 * Un producto dentro de un LOTE, con su configuracion en la ubicacion pegada.
 *
 * Van juntos a proposito: crear el producto y no activarlo deja un catalogo que
 * no vende nada, y son dos escrituras que tienen que ocurrir o no ocurrir a la
 * vez. El empaque llega ya resuelto a id — es un ITEM (ADR-008 §12), y solo
 * `catalog` sabe traducir su nombre.
 */
export interface DatosDeProductoEnLote {
  readonly nombre: string;
  readonly tipo: TipoDeProducto;
  readonly categoria: string | null;
  readonly empaqueItemId: ItemId | null;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

/** Una receta dentro de un LOTE: destino ya resuelto y sus lineas. */
export interface RecetaEnLote {
  readonly destino: DestinoDeReceta;
  readonly lineas: readonly LineaParaGuardar[];
}

/**
 * Un componente de COMBO dentro de un LOTE.
 *
 * **P4 CREO LA TABLA Y NADIE LA HA ESCRITO NUNCA.** `componentesDeCombos` la
 * lee y el motor de costeo la usa, pero hasta P10 no habia ninguna ruta que
 * pusiera una fila dentro: un combo se podia crear y jamas componer, y costaba
 * cero. Esto es esa ruta.
 */
export interface ComponenteEnLote {
  readonly comboProductId: ProductId;
  readonly componentProductId: ProductId;
  readonly cantidad: string;
}

export interface RepositorioDeRecetas {
  crearProducto(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly tipo: TipoDeProducto;
    readonly categoria: string | null;
  }): Promise<ResultadoDeAltaDeProducto>;

  /**
   * Escribe TODO el lote o nada, en **una sola transaccion**: los productos, su
   * configuracion en la ubicacion y su empaque.
   */
  crearProductosEnLote(datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly productos: readonly DatosDeProductoEnLote[];
  }): Promise<ResultadoDeLoteConLimite>;

  listarProductos(companyId: CompanyId): Promise<readonly ProductoLeido[]>;

  buscarProducto(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
  }): Promise<ProductoLeido | null>;

  /**
   * Activación, PVP y rendimiento por lote de un producto en una ubicación.
   * Sube la versión del producto en la misma transacción, solo si sigue
   * siendo la esperada (D-16.100).
   */
  configurarEnUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly locationId: LocationId;
    readonly activo: boolean;
    readonly pvp: string | null;
    readonly rendimientoPorciones: string | null;
    readonly versionEsperada: number;
  }): Promise<DesenlaceVersionado>;

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

  /**
   * Crea la versión bajo un candado por (destino, ubicación). Con testigo
   * `comprobar`, solo si la última versión creada sigue siendo `basadaEn`.
   */
  guardarVersion(datos: DatosDeVersion): Promise<ResultadoDeGuardadoDeReceta>;

  /** La última versión CREADA —no la vigente— de ese destino en esa ubicación. */
  ultimaVersionDe(entrada: {
    readonly companyId: CompanyId;
    readonly destino: DestinoDeReceta;
    readonly locationId: LocationId;
  }): Promise<RecipeId | null>;

  /**
   * Recetas y componentes de combo, TODO o nada, en **una sola transaccion**.
   *
   * Las recetas se escriben una a una dentro de esa transaccion y no con un
   * `createMany`: cada version necesita su `id` para colgarle las lineas, y
   * `createMany` no devuelve ids. Lo que el criterio de aceptacion exige es
   * atomicidad, no una sola sentencia — y con 48 productos la diferencia de
   * tiempo no se nota.
   */
  guardarRecetasEnLote(datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly recetas: readonly RecetaEnLote[];
    readonly combos: readonly ComponenteEnLote[];
    readonly validFrom: Date;
    readonly createdBy: UserId;
  }): Promise<number>;

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

  /** Las propagaciones de un producto, la más reciente primero. */
  propagacionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly limite: number;
  }): Promise<readonly PropagacionLeida[]>;

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

  /** Fija o quita el ítem que hace de empaque, con la versión del producto. */
  asignarEmpaque(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly empaqueItemId: ItemId | null;
    readonly versionEsperada: number;
  }): Promise<DesenlaceVersionado>;

  /** Los componentes de UN combo. */
  componentesDe(entrada: {
    readonly companyId: CompanyId;
    readonly comboProductId: ProductId;
  }): Promise<readonly ComponenteDeCombo[]>;

  /**
   * Reemplaza la lista ENTERA de componentes de un combo —borra y escribe— y
   * sube la versión del combo, todo en una transacción y solo si la versión
   * sigue siendo la esperada (D-16.114).
   */
  reemplazarComponentes(entrada: {
    readonly companyId: CompanyId;
    readonly comboProductId: ProductId;
    readonly componentes: readonly ComponenteParaGuardar[];
    readonly versionEsperada: number;
  }): Promise<DesenlaceVersionado>;

  // --- Carga en lote, para costear una carta entera -------------------------
  //
  // LAS TRES EXISTEN POR EL PRESUPUESTO DE CLAUDE.md §5: 400 ms para 200
  // productos con 1.500 líneas. Pedir la receta de cada producto por separado
  // son 200 consultas antes de empezar a calcular.

  /**
   * TODAS las recetas vigentes de una ubicación a una fecha, de productos y de
   * subpreparaciones, con sus líneas.
   *
   * La versión `VOID` se descarta aquí igual que en `recetaVigente`: es la
   * respuesta «aquí no hay receta», y no una receta vacía —que costaría cero,
   * que es un número plausible y equivocado.
   */
  recetasVigentesDeUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly fecha: Date;
  }): Promise<readonly RecetaVigenteLeida[]>;

  /** Activación, PVP y rendimiento de TODOS los productos en una ubicación. */
  productosEnUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly ProductoConUbicacion[]>;

  /** Los componentes de todos los combos de la company. */
  componentesDeCombos(companyId: CompanyId): Promise<readonly ComponenteDeCombo[]>;
}
