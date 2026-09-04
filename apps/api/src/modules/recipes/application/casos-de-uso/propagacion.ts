/**
 * Propagación de recetas entre ubicaciones — R11, SPEC §9.
 *
 * **COPIA INDEPENDIENTE CON PROPAGACIÓN EXPLÍCITA, SIN VÍNCULO PERMANENTE.**
 * «Aplicar a todos» sobrescribe la receta completa en las demás ubicaciones, y
 * a partir de ahí cada una vuelve a ser suya. Es una decisión de producto, no
 * de implementación: un vínculo permanente convertiría cada ajuste local en una
 * excepción que alguien tiene que mantener, y la cocina de un local no es una
 * desviación de la del otro — es la suya.
 *
 * LO QUE R11 EXIGE, Y DÓNDE ESTÁ CADA COSA:
 *
 *   previsualización        `PrevisualizarPropagacion`, con cuántos locales,
 *                           cuáles están personalizados, y opción de destildar
 *   permiso de company      `recipe.propagate`, que `GERENTE_LOCAL` no tiene
 *   registro reversible     `recipe_propagation` + un destino por ubicación con
 *                           la receta que había ANTES
 *
 * **REVERTIR NO BORRA NADA.** Crea una versión nueva en cada ubicación con las
 * líneas de la que estaba vigente antes de propagar. Los costeos hechos entre
 * la propagación y la reversión siguen siendo consultables y correctos: usaron
 * la receta que de verdad estaba vigente entonces. Borrar la versión propagada
 * reescribiría la historia, que es exactamente lo que SPEC §9 prohíbe.
 *
 * Si una ubicación **no tenía** receta antes, revertir le deja una versión
 * `VOID`. Es distinto de una receta vacía: una receta vacía cuesta cero, que es
 * una respuesta plausible y equivocada.
 */

import type {
  LocationId,
  ProductId,
  RecipeId,
  RecipePropagationId,
} from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import {
  PropagacionNoEncontradaError,
  PropagacionYaRevertidaError,
  RecetaInvalidaError,
} from '../../domain/errores';
import type { DependenciasDeRecetas } from './recetas';
import type {
  DestinoDePropagacion as DestinoPropagacion,
  DestinoPropagado,
} from '../ports/repositorio-de-recetas.port';

export interface Previsualizacion {
  readonly origen: LocationId;
  readonly destinos: readonly DestinoPropagacion[];
  /** Cuántas perderían una receta propia. Es el número que hay que mirar. */
  readonly personalizadas: number;
}

export class PrevisualizarPropagacion {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /**
   * R11 EXIGE QUE ESTO SE VEA ANTES DE PROPAGAR, y la razón está en el número
   * `personalizadas`: propagar sobre una ubicación que había ajustado su receta
   * borra ese trabajo. Sin previsualización, quien propaga no puede saber que
   * lo está haciendo.
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly productId: ProductId; readonly origen: LocationId },
  ): Promise<Previsualizacion> {
    const destinos = await this.deps.repositorio.destinosDePropagacion({
      companyId: sesion.companyId,
      productId: entrada.productId,
      origen: entrada.origen,
    });

    return {
      origen: entrada.origen,
      destinos,
      personalizadas: destinos.filter((d) => d.personalizada).length,
    };
  }
}

export interface DatosDePropagacion {
  readonly productId: ProductId;
  readonly origen: LocationId;
  /** Las ubicaciones elegidas. R11: se pueden destildar. */
  readonly destinos: readonly LocationId[];
}

/**
 * Copiar las lineas de una receta en una version nueva.
 *
 * LO USAN PROPAGAR Y REVERTIR, y `audit:duplication` fue quien lo senalo: eran
 * el mismo bloque escrito dos veces. No es solo estilo — las dos operaciones
 * tienen que copiar EXACTAMENTE los mismos campos, y el dia que la linea gane
 * uno nuevo, dos copias significan que la reversion pierde ese campo y nadie lo
 * nota hasta que un costo historico sale distinto.
 */
async function copiarComoVersion(entrada: {
  readonly deps: DependenciasDeRecetas;
  readonly sesion: SesionActiva;
  readonly productId: ProductId;
  readonly locationId: LocationId;
  readonly desde: RecipeId | null;
  readonly ahora: Date;
  readonly nota: string;
}): Promise<RecipeId> {
  const { deps, sesion, productId, locationId, desde, ahora, nota } = entrada;

  const lineas =
    desde === null
      ? []
      : await deps.repositorio.lineasDe({ companyId: sesion.companyId, recipeId: desde });

  return deps.repositorio.guardarVersion({
    companyId: sesion.companyId,
    destino: { clase: 'producto', productId },
    locationId,
    lineas: lineas.map((l) => ({
      itemId: l.itemId,
      cantidad: l.cantidad,
      base: l.base,
      estado: l.estado,
    })),
    validFrom: ahora,
    createdBy: sesion.userId,
    nota,
    // Sin receta de origen, la version deja constancia de «aqui no hay
    // receta». Una receta vacia costaria cero, que es otra cosa.
    estado: desde === null ? 'VOID' : 'ACTIVE',
  });
}

/** Las dos comprobaciones baratas, antes de tocar la base. */
function exigirDestinosCoherentes(datos: DatosDePropagacion): void {
  if (datos.destinos.length === 0) {
    throw new RecetaInvalidaError('No se eligió ninguna ubicación de destino.');
  }
  if (datos.destinos.includes(datos.origen)) {
    throw new RecetaInvalidaError('El origen no puede ser también destino.');
  }
}

export class PropagarReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    datos: DatosDePropagacion,
  ): Promise<RecipePropagationId> {
    exigirDestinosCoherentes(datos);

    const ahora = this.deps.reloj.ahora();
    const origen = await this.recetaDeOrigen(sesion, datos, ahora);

    const disponibles = await this.deps.repositorio.destinosDePropagacion({
      companyId: sesion.companyId,
      productId: datos.productId,
      origen: datos.origen,
    });

    const creados = await this.crearVersiones({ sesion, datos, origen, disponibles, ahora });

    const propagacionId = await this.deps.repositorio.registrarPropagacion({
      companyId: sesion.companyId,
      productId: datos.productId,
      sourceRecipeId: origen.id,
      propagatedBy: sesion.userId,
      destinos: creados,
    });

    await this.deps.auditoria.record({
      eventType: 'recipe.propagated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: {
        propagacionId,
        productId: datos.productId,
        origen: datos.origen,
        ubicaciones: creados.length,
        // El numero que importa auditar: cuantas ubicaciones PERDIERON una
        // receta propia. R11 existe por esto.
        sobrescribieron: creados.filter((c) => c.anterior !== null).length,
      },
    });

    return propagacionId;
  }

  private async recetaDeOrigen(
    sesion: SesionActiva,
    datos: DatosDePropagacion,
    ahora: Date,
  ): Promise<{ readonly id: RecipeId }> {
    const origen = await this.deps.repositorio.recetaVigente({
      companyId: sesion.companyId,
      destino: { clase: 'producto', productId: datos.productId },
      locationId: datos.origen,
      fecha: ahora,
    });

    if (origen === null) {
      throw new RecetaInvalidaError('La ubicación de origen no tiene receta vigente que propagar.');
    }

    return origen;
  }

  private async crearVersiones(entrada: {
    readonly sesion: SesionActiva;
    readonly datos: DatosDePropagacion;
    readonly origen: { readonly id: RecipeId };
    readonly disponibles: readonly DestinoPropagacion[];
    readonly ahora: Date;
  }): Promise<readonly DestinoPropagado[]> {
    const { sesion, datos, origen, disponibles, ahora } = entrada;

    const creados: DestinoPropagado[] = [];

    for (const locationId of datos.destinos) {
      const destino = disponibles.find((d) => d.locationId === locationId);
      if (destino === undefined) {
        throw new RecetaInvalidaError('Una de las ubicaciones elegidas no tiene el producto activo.');
      }

      const creada = await copiarComoVersion({
        deps: this.deps,
        sesion,
        productId: datos.productId,
        locationId,
        desde: origen.id,
        ahora,
        nota: `Propagada desde ${datos.origen}`,
      });

      creados.push({ locationId, anterior: destino.recetaActual, creada });
    }

    return creados;
  }
}

export class RevertirPropagacion {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(sesion: SesionActiva, propagacionId: RecipePropagationId): Promise<void> {
    const propagacion = await this.deps.repositorio.buscarPropagacion({
      companyId: sesion.companyId,
      propagacionId,
    });
    if (propagacion === null) {
      throw new PropagacionNoEncontradaError();
    }
    if (propagacion.revertidaEn !== null) {
      throw new PropagacionYaRevertidaError();
    }

    const ahora = this.deps.reloj.ahora();

    for (const destino of propagacion.destinos) {
      await this.restaurar({ sesion, propagacion, destino, ahora });
    }

    const marcada = await this.deps.repositorio.marcarRevertida({
      companyId: sesion.companyId,
      propagacionId,
      userId: sesion.userId,
      ahora,
    });
    if (!marcada) {
      // Dos reversiones a la vez: gana una. La condición está en el `WHERE`.
      throw new PropagacionYaRevertidaError();
    }

    await this.deps.auditoria.record({
      eventType: 'recipe.propagation_reverted',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { propagacionId, ubicaciones: propagacion.destinos.length },
    });
  }

  /**
   * Restaura UNA ubicación creando una versión nueva con las líneas de la que
   * estaba vigente antes. Si no había ninguna, deja una versión `VOID`.
   */
  private async restaurar(entrada: {
    readonly sesion: SesionActiva;
    readonly propagacion: { readonly productId: ProductId };
    readonly destino: { readonly locationId: LocationId; readonly anterior: RecipeId | null };
    readonly ahora: Date;
  }): Promise<void> {
    await copiarComoVersion({
      deps: this.deps,
      sesion: entrada.sesion,
      productId: entrada.propagacion.productId,
      locationId: entrada.destino.locationId,
      desde: entrada.destino.anterior,
      ahora: entrada.ahora,
      nota: 'Reversión de propagación',
    });
  }
}
