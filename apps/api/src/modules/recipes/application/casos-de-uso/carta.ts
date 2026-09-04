/**
 * La carta de una ubicación a una fecha, entera y en cuatro consultas.
 *
 * **EXISTE POR EL PRESUPUESTO DE CLAUDE.md §5**: costear 200 productos con
 * 1.500 líneas en menos de 400 ms. Pedir la receta de cada producto con
 * `LeerReceta` son 200 consultas antes de empezar a calcular, y ninguna
 * optimización posterior recupera eso.
 *
 * **NO DUPLICA NINGUNA REGLA.** Cuál es la versión vigente lo sigue decidiendo
 * el mismo criterio de P4 —la más reciente que ya empezó, y `VOID` significa
 * «aquí no hay receta»—, aplicado una vez en el repositorio sobre el conjunto
 * ordenado en lugar de una vez por consulta.
 *
 * **`fecha` ES PARÁMETRO, NO «AHORA»** (criterio E8): la carta de un mes
 * anterior trae las recetas que estaban vigentes entonces, no las de hoy.
 *
 * Devuelve mapas y no listas porque su único consumidor —el motor de costeo—
 * hace búsquedas por identificador, y armar el mapa allí sería armarlo dos
 * veces.
 */

import type {
  ItemId,
  LocationId,
  ProductId,
} from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { ProductoNoEncontradoError } from '../../domain/errores';
import type {
  ComponenteDeCombo,
  ConfiguracionEnUbicacion,
  ProductoLeido,
  RecetaLeida,
  RecetaVigenteLeida,
} from '../ports/repositorio-de-recetas.port';
import { exigirUbicacionEnAlcance } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { DependenciasDeRecetas } from './recetas';

export interface CartaDeUbicacion {
  readonly productos: readonly ProductoLeido[];
  /** Un producto sin fila aquí no está configurado en esta ubicación. */
  readonly enUbicacion: ReadonlyMap<ProductId, ConfiguracionEnUbicacion>;
  readonly recetasDeProducto: ReadonlyMap<ProductId, RecetaLeida>;
  /** Las recetas de las subpreparaciones: lo que alimenta la cascada. */
  readonly recetasDeItem: ReadonlyMap<ItemId, RecetaLeida>;
  readonly componentesDeCombo: ReadonlyMap<ProductId, readonly ComponenteDeCombo[]>;
}

export class LeerCarta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId; readonly fecha: Date },
  ): Promise<CartaDeUbicacion> {
    // La escalada horizontal de P1: RLS impide ver otra company, no impide que
    // un `GERENTE_LOCAL` pregunte por la ubicación de al lado.
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const { companyId } = sesion;
    const [productos, enUbicacion, recetas, componentes] = await Promise.all([
      this.deps.repositorio.listarProductos(companyId),
      this.deps.repositorio.productosEnUbicacion({ companyId, locationId: entrada.locationId }),
      this.deps.repositorio.recetasVigentesDeUbicacion({
        companyId,
        locationId: entrada.locationId,
        fecha: entrada.fecha,
      }),
      this.deps.repositorio.componentesDeCombos(companyId),
    ]);

    return {
      productos,
      enUbicacion: new Map(enUbicacion.map((p) => [p.productId, p])),
      ...separarPorDestino(recetas),
      componentesDeCombo: agruparPorCombo(componentes),
    };
  }
}

/**
 * Una receta de producto y una de subpreparación se leen de la misma tabla y se
 * usan en momentos distintos: la del ítem entra en la cascada, la del producto
 * en el costeo del plato. Se separan aquí, con un `switch` sobre la unión, que
 * es lo que hace que TypeScript estreche el destino sin aserciones.
 */
function separarPorDestino(recetas: readonly RecetaVigenteLeida[]): {
  readonly recetasDeProducto: ReadonlyMap<ProductId, RecetaLeida>;
  readonly recetasDeItem: ReadonlyMap<ItemId, RecetaLeida>;
} {
  const recetasDeProducto = new Map<ProductId, RecetaLeida>();
  const recetasDeItem = new Map<ItemId, RecetaLeida>();

  for (const receta of recetas) {
    if (receta.destino.clase === 'producto') {
      recetasDeProducto.set(receta.destino.productId, receta);
    } else {
      recetasDeItem.set(receta.destino.itemId, receta);
    }
  }

  return { recetasDeProducto, recetasDeItem };
}

function agruparPorCombo(
  componentes: readonly ComponenteDeCombo[],
): ReadonlyMap<ProductId, readonly ComponenteDeCombo[]> {
  const porCombo = new Map<ProductId, ComponenteDeCombo[]>();

  for (const componente of componentes) {
    const suyos = porCombo.get(componente.comboProductId) ?? [];
    suyos.push(componente);
    porCombo.set(componente.comboProductId, suyos);
  }

  return porCombo;
}

/**
 * Fija o quita el ítem que hace de empaque de un producto (SPEC §14, ADR-008).
 *
 * Es de nivel COMPANY, no de ubicación: el empaque vive en el maestro del
 * producto, igual que en `T4_EMPAQUES` del Excel. Un local que sirviera el
 * mismo plato en otro envase necesitaría un producto distinto, que es lo que ya
 * hace falta hoy para cambiarle el PVP de forma estructural.
 */
export class AsignarEmpaque {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {ProductoNoEncontradoError} */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly productId: ProductId; readonly empaqueItemId: ItemId | null },
  ): Promise<void> {
    if (entrada.empaqueItemId !== null) {
      const item = await this.deps.leerItem.ejecutar(sesion, entrada.empaqueItemId);
      if (item === null) {
        throw new ProductoNoEncontradoError();
      }
    }

    const asignado = await this.deps.repositorio.asignarEmpaque({
      companyId: sesion.companyId,
      productId: entrada.productId,
      empaqueItemId: entrada.empaqueItemId,
    });

    if (!asignado) {
      throw new ProductoNoEncontradoError();
    }

    await this.deps.auditoria.record({
      eventType: 'product.updated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { productId: entrada.productId, empaque: entrada.empaqueItemId ?? 'ninguno' },
    });
  }
}
