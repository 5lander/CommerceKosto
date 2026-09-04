/**
 * Productos y recetas — SPEC §8 y §9.
 *
 * **GUARDAR UNA RECETA VALIDA LOS CICLOS ANTES DE ESCRIBIR (R9).** No al
 * calcular: al guardar. Un ciclo detectado al calcular es un costo que no se
 * puede producir, y ocurre cuando alguien pide un reporte, lejos de quien lo
 * causó. Aquí el mensaje llega a quien acaba de escribir la línea, con el
 * camino del ciclo dentro.
 *
 * **NO EXISTE «EDITAR UNA RECETA».** Guardar crea una versión nueva con su
 * vigencia; la anterior queda consultable y los costeos históricos no se
 * recalculan (SPEC §9). Es la misma regla que los precios de P3, y un trigger
 * en la base impide el `UPDATE` que la rompería.
 *
 * **LOS ÍTEMS SE LEEN POR EL PUERTO DE `catalog`**, nunca por sus tablas
 * (CLAUDE.md §2). Aquí hace falta para dos cosas: comprobar que cada línea
 * apunta a un ítem que existe en la company, y saber si el destino es una
 * subpreparación —un ítem `PRODUCIDO`— que puede formar parte de un ciclo.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  ItemId,
  LocationId,
  ProductId,
  RecipeId,
} from '../../../../shared/domain/identity/identificadores';
import type { LeerItem } from '../../../catalog/application/casos-de-uso/items';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { cicloAlGuardar, CicloEnRecetaError } from '../../domain/ciclos';
import {
  ProductoNoEncontradoError,
  RecetaInvalidaError,
  UbicacionFueraDeAlcanceError,
} from '../../domain/errores';
import type {
  DestinoDeReceta,
  LineaParaGuardar,
  ProductoLeido,
  RecetaLeida,
  RepositorioDeRecetas,
  TipoDeProducto,
} from '../ports/repositorio-de-recetas.port';

export interface DependenciasDeRecetas {
  readonly repositorio: RepositorioDeRecetas;
  readonly leerItem: LeerItem;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

/**
 * Comprueba que la ubicación está en el alcance de quien pregunta.
 *
 * ES LA ESCALADA HORIZONTAL DE P1 APLICADA A RECETAS. RLS garantiza que no se
 * vean recetas de otra company; no sabe nada de que un `GERENTE_LOCAL` solo
 * puede tocar la suya. Esa mitad se decide aquí, con `sesion.alcance`, que es
 * una unión: o «company entera» o «esta lista».
 */
export function exigirUbicacionEnAlcance(sesion: SesionActiva, locationId: LocationId): void {
  if (sesion.alcance.clase === 'company') {
    return;
  }
  if (!sesion.alcance.ids.includes(locationId)) {
    throw new UbicacionFueraDeAlcanceError();
  }
}

export class CrearProducto {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    datos: { readonly nombre: string; readonly tipo: TipoDeProducto; readonly categoria: string | null },
  ): Promise<ProductId> {
    const resultado = await this.deps.repositorio.crearProducto({
      companyId: sesion.companyId,
      nombre: datos.nombre.trim(),
      tipo: datos.tipo,
      categoria: datos.categoria,
    });

    if (resultado.clase === 'nombre_en_uso') {
      throw new RecetaInvalidaError('Ya existe un producto con ese nombre.');
    }

    await this.deps.auditoria.record({
      eventType: 'product.created',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { productId: resultado.id, tipo: datos.tipo },
    });

    return resultado.id;
  }
}

export class ListarProductos {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(sesion: SesionActiva): Promise<readonly ProductoLeido[]> {
    return this.deps.repositorio.listarProductos(sesion.companyId);
  }
}

export interface DatosDeUbicacion {
  readonly productId: ProductId;
  readonly locationId: LocationId;
  readonly activo: boolean;
  readonly pvp: string | null;
  readonly rendimientoPorciones: string | null;
}

export class ConfigurarProductoEnUbicacion {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDeUbicacion): Promise<void> {
    exigirUbicacionEnAlcance(sesion, datos.locationId);

    const producto = await this.deps.repositorio.buscarProducto({
      companyId: sesion.companyId,
      productId: datos.productId,
    });
    if (producto === null) {
      throw new ProductoNoEncontradoError();
    }

    await this.deps.repositorio.configurarEnUbicacion({
      companyId: sesion.companyId,
      productId: datos.productId,
      locationId: datos.locationId,
      activo: datos.activo,
      pvp: datos.pvp,
      rendimientoPorciones: datos.rendimientoPorciones,
    });

    await this.deps.auditoria.record({
      eventType: 'product.updated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { productId: datos.productId, locationId: datos.locationId, activo: datos.activo },
    });
  }
}

export interface DatosDeReceta {
  readonly destino: DestinoDeReceta;
  readonly locationId: LocationId;
  readonly lineas: readonly LineaParaGuardar[];
  readonly validFrom: Date;
  readonly nota: string | null;
}

export class GuardarReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {CicloEnRecetaError} · {@link RecetaInvalidaError} */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeReceta): Promise<RecipeId> {
    exigirUbicacionEnAlcance(sesion, datos.locationId);

    await this.exigirDestinoValido(sesion, datos.destino);
    await this.exigirLineasValidas(sesion, datos.lineas);
    await this.exigirSinCiclos(sesion, datos);

    const id = await this.deps.repositorio.guardarVersion({
      companyId: sesion.companyId,
      destino: datos.destino,
      locationId: datos.locationId,
      lineas: datos.lineas,
      validFrom: datos.validFrom,
      createdBy: sesion.userId,
      nota: datos.nota,
      estado: 'ACTIVE',
    });

    await this.deps.auditoria.record({
      eventType: 'recipe.saved',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { recipeId: id, locationId: datos.locationId, lineas: datos.lineas.length },
    });

    return id;
  }

  private async exigirDestinoValido(sesion: SesionActiva, destino: DestinoDeReceta): Promise<void> {
    if (destino.clase === 'producto') {
      const producto = await this.deps.repositorio.buscarProducto({
        companyId: sesion.companyId,
        productId: destino.productId,
      });
      if (producto === null) {
        throw new ProductoNoEncontradoError();
      }
      if (producto.tipo === 'COMBO') {
        // Un combo no tiene receta de ítems: se compone de productos simples
        // (SPEC §8). Dejarle poner líneas sería contarle el costo dos veces.
        throw new RecetaInvalidaError(
          'Un combo no lleva receta de ítems: se compone de productos simples.',
        );
      }
      return;
    }

    const item = await this.deps.leerItem.ejecutar(sesion, destino.itemId);
    if (item === null) {
      throw new RecetaInvalidaError('Ese ítem no existe en tu company.');
    }
    if (item.tipo !== 'PRODUCIDO') {
      // Solo una preparación tiene receta. Un ítem comprado entra por compra.
      throw new RecetaInvalidaError('Solo una preparación producida puede tener receta propia.');
    }
  }

  private async exigirLineasValidas(
    sesion: SesionActiva,
    lineas: readonly LineaParaGuardar[],
  ): Promise<void> {
    const vistos = new Set<ItemId>();
    for (const linea of lineas) {
      if (vistos.has(linea.itemId)) {
        // La base lo impide con un índice único; aquí sale con un mensaje.
        throw new RecetaInvalidaError('Un ítem no puede aparecer dos veces en la misma receta.');
      }
      vistos.add(linea.itemId);

      const item = await this.deps.leerItem.ejecutar(sesion, linea.itemId);
      if (item === null) {
        throw new RecetaInvalidaError(`Una línea apunta a un ítem que no existe en tu company.`);
      }
    }
  }

  /**
   * R9. Solo aplica cuando el destino es un ÍTEM: un producto de venta no es
   * referenciable por ninguna línea, así que nunca puede formar parte de un
   * ciclo.
   */
  private async exigirSinCiclos(sesion: SesionActiva, datos: DatosDeReceta): Promise<void> {
    if (datos.destino.clase !== 'item') {
      return;
    }

    const grafo = await this.deps.repositorio.grafoDeItems({
      companyId: sesion.companyId,
      locationId: datos.locationId,
    });

    const ciclo = cicloAlGuardar({
      destino: datos.destino.itemId,
      referencias: datos.lineas.map((l) => l.itemId),
      grafo,
    });

    if (ciclo !== null) {
      throw new CicloEnRecetaError(ciclo);
    }
  }
}

export class LeerReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** La versión vigente a una fecha. `fecha` es parámetro, no «ahora». */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly destino: DestinoDeReceta; readonly locationId: LocationId; readonly fecha: Date },
  ): Promise<RecetaLeida | null> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    return this.deps.repositorio.recetaVigente({
      companyId: sesion.companyId,
      destino: entrada.destino,
      locationId: entrada.locationId,
      fecha: entrada.fecha,
    });
  }
}

export class ListarVersionesDeReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly destino: DestinoDeReceta; readonly locationId: LocationId },
  ): Promise<readonly RecetaLeida[]> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    return this.deps.repositorio.versionesDe({
      companyId: sesion.companyId,
      destino: entrada.destino,
      locationId: entrada.locationId,
    });
  }
}
