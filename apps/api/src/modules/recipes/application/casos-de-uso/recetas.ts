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

import type { DesenlaceVersionado } from '../../../../shared/application/concurrencia';
import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import { ConflictoDeVersionError } from '../../../../shared/domain/errors/conflicto-de-version';
import { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  ItemId,
  LocationId,
  ProductId,
  RecipeId,
} from '../../../../shared/domain/identity/identificadores';
import type { LeerItem } from '../../../catalog/application/casos-de-uso/items';
import { LimiteDelPlanError } from '../../../iam/domain/errores';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import { cicloAlGuardar, CicloEnRecetaError } from '../../domain/ciclos';
import { ProductoNoEncontradoError, RecetaInvalidaError } from '../../domain/errores';
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
    // El plan, no el permiso: 409, no 403 (ver `LimiteDelPlanError`).
    if (resultado.clase === 'limite') {
      throw new LimiteDelPlanError('productos', resultado.maximo);
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
  /** La del producto, leída por el formulario (D-16.100). */
  readonly version: number;
}

export class ConfigurarProductoEnUbicacion {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @returns la versión NUEVA del producto. */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeUbicacion): Promise<number> {
    exigirUbicacionEnAlcance(sesion, datos.locationId);

    const producto = await this.deps.repositorio.buscarProducto({
      companyId: sesion.companyId,
      productId: datos.productId,
    });
    if (producto === null) {
      throw new ProductoNoEncontradoError();
    }

    // La base ya lo impide con un CHECK; esto lo EXPLICA. Un `23514` del driver
    // sale por el filtro como INTERNAL_ERROR 500 —un fallo del servidor— cuando
    // lo que hay es un formulario a medio llenar. Lo destapó la prueba de
    // integración de P5, montando el borde 3 de CC-009.
    if (datos.activo && datos.pvp === null) {
      throw new RecetaInvalidaError(
        'Un producto activo necesita PVP: sin él se podría vender sin saber a cuánto, y su margen saldría indefinido.',
      );
    }
    exigirPositivos(datos);

    const desenlace = await this.deps.repositorio.configurarEnUbicacion({
      companyId: sesion.companyId,
      productId: datos.productId,
      locationId: datos.locationId,
      activo: datos.activo,
      pvp: datos.pvp,
      rendimientoPorciones: datos.rendimientoPorciones,
      versionEsperada: datos.version,
    });
    const version = versionEscrita(desenlace, 'producto');

    await registrarCambioDeProducto(this.deps, sesion, {
      productId: datos.productId,
      locationId: datos.locationId,
      activo: datos.activo,
      version,
    });

    return version;
  }
}

/**
 * PVP y rendimiento por lote, estrictamente positivos (D-16.110).
 *
 * **LA BASE YA LO IMPIDE** con `product_location_pvp_positivo` y
 * `product_location_rendimiento_positivo`, y el esquema del borde también desde
 * P16-B. Esto lo EXPLICA para quien llegue sin pasar por HTTP, y deja constancia
 * de por qué: hasta P16-B, `"0"` pasaba el esquema y salía como 500 (INC-012,
 * cuarta recurrencia). Un PVP cero no es un regalo: es un food cost dividido por
 * cero.
 */
function exigirPositivos(datos: DatosDeUbicacion): void {
  if (datos.pvp !== null && !Money.fromDecimalString(datos.pvp).isPositive()) {
    throw new RecetaInvalidaError('El PVP tiene que ser mayor que cero: un precio de cero no deja calcular el food cost.');
  }
  if (datos.rendimientoPorciones !== null && !Ratio.fromDecimalString(datos.rendimientoPorciones).isPositive()) {
    throw new RecetaInvalidaError('El rendimiento por lote tiene que ser mayor que cero: es entre cuánto se divide el costo del lote.');
  }
}

/**
 * El evento `product.updated` de las escrituras del agregado producto. Lo emiten
 * tres casos de uso —configuración por ubicación, empaque y componentes— y
 * `audit:duplication` lo encontró copiado.
 */
export async function registrarCambioDeProducto(
  deps: DependenciasDeRecetas,
  sesion: SesionActiva,
  detail: Readonly<Record<string, string | number | boolean>>,
): Promise<void> {
  await registrarEventoDeUsuario({
    auditoria: deps.auditoria,
    actorId: sesion.userId,
    companyId: sesion.companyId,
    eventType: 'product.updated',
    detail,
  });
}

/**
 * Del desenlace de una escritura versionada, la versión nueva o el error que toca.
 * Lo comparten las cuatro escrituras del agregado producto.
 */
export function versionEscrita(desenlace: DesenlaceVersionado, agregado: 'producto' | 'receta'): number {
  if (desenlace.clase === 'no_encontrado') throw new ProductoNoEncontradoError();
  if (desenlace.clase === 'conflicto_de_version') throw new ConflictoDeVersionError(agregado);
  return desenlace.version;
}

export interface DatosDeReceta {
  readonly destino: DestinoDeReceta;
  readonly locationId: LocationId;
  readonly lineas: readonly LineaParaGuardar[];
  readonly validFrom: Date;
  readonly nota: string | null;
  /**
   * La última versión que el formulario tenía delante, o `null` si no había
   * ninguna (D-16.101). Si otra ya se guardó encima, 409.
   */
  readonly basadaEn: RecipeId | null;
}

export class GuardarReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /** @throws {CicloEnRecetaError} · {@link RecetaInvalidaError} · {@link ConflictoDeVersionError} */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeReceta): Promise<RecipeId> {
    exigirUbicacionEnAlcance(sesion, datos.locationId);

    await this.exigirDestinoValido(sesion, datos.destino);
    await this.exigirLineasValidas(sesion, datos.lineas);
    await this.exigirSinCiclos(sesion, datos);

    const resultado = await this.deps.repositorio.guardarVersion({
      companyId: sesion.companyId,
      destino: datos.destino,
      locationId: datos.locationId,
      lineas: datos.lineas,
      validFrom: datos.validFrom,
      createdBy: sesion.userId,
      nota: datos.nota,
      estado: 'ACTIVE',
      testigo: { clase: 'comprobar', basadaEn: datos.basadaEn },
    });
    if (resultado.clase === 'conflicto_de_version') {
      throw new ConflictoDeVersionError('receta');
    }
    const { id } = resultado;

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

export interface RecetaParaEditar {
  readonly vigente: RecetaLeida | null;
  readonly ultimaVersionId: RecipeId | null;
}

export class LeerReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  /**
   * La versión vigente a una fecha —`fecha` es parámetro, no «ahora»— y la
   * última CREADA, que es la que el editor manda de vuelta como `basadaEn`.
   * No son la misma: una versión con vigencia futura es la última creada y
   * todavía no es la vigente.
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly destino: DestinoDeReceta; readonly locationId: LocationId; readonly fecha: Date },
  ): Promise<RecetaParaEditar> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const clave = { companyId: sesion.companyId, destino: entrada.destino, locationId: entrada.locationId };
    const [vigente, ultimaVersionId] = await Promise.all([
      this.deps.repositorio.recetaVigente({ ...clave, fecha: entrada.fecha }),
      this.deps.repositorio.ultimaVersionDe(clave),
    ]);

    return { vigente, ultimaVersionId };
  }
}

export interface VersionesDeReceta {
  /** Por vigencia, la más reciente primero: el orden en que se leen. */
  readonly versiones: readonly RecetaLeida[];
  readonly ultimaVersionId: RecipeId | null;
}

export class ListarVersionesDeReceta {
  public constructor(private readonly deps: DependenciasDeRecetas) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly destino: DestinoDeReceta; readonly locationId: LocationId },
  ): Promise<VersionesDeReceta> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const clave = { companyId: sesion.companyId, destino: entrada.destino, locationId: entrada.locationId };
    const [versiones, ultimaVersionId] = await Promise.all([
      this.deps.repositorio.versionesDe(clave),
      this.deps.repositorio.ultimaVersionDe(clave),
    ]);

    return { versiones, ultimaVersionId };
  }
}
