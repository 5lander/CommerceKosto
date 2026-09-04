/**
 * El puerto de recetas, sobre PostgreSQL.
 *
 * `guardarVersion` CREA UNA FILA NUEVA Y SUS LÍNEAS EN UNA TRANSACCIÓN. Nunca
 * toca una versión existente: un trigger impide el `UPDATE` sobre `recipe`, así
 * que ni siquiera hay forma de equivocarse. La versión anterior queda
 * consultable y los costeos históricos no se recalculan (SPEC §9).
 *
 * «LA ÚLTIMA VERSIÓN POR ÍTEM» SE RESUELVE EN JAVASCRIPT, no con `DISTINCT ON`,
 * y es una decisión con número detrás: son decenas de subpreparaciones por
 * ubicación, no miles. Una consulta ordenada y un `Map` son más fáciles de leer
 * que un `DISTINCT ON` en SQL crudo, y el coste es el mismo a esta escala. Si
 * algún día fueran miles, el sitio donde cambiarlo está señalado.
 */

import { Injectable } from '@nestjs/common';

import {
  itemId as aItemId,
  locationId as aLocationId,
  productId as aProductId,
  recipeId as aRecipeId,
  recipePropagationId as aPropagationId,
  type CompanyId,
  type ItemId,
  type LocationId,
  type ProductId,
  type RecipeId,
  type RecipePropagationId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type { GrafoDeItems } from '../domain/ciclos';
import type { BaseDeLinea, EstadoDeLinea } from '../domain/linea-de-receta';
import type {
  DatosDePropagacionRegistrada,
  DatosDeVersion,
  DestinoDePropagacion,
  DestinoDeReceta,
  LineaLeida,
  ProductoEnUbicacion,
  ProductoLeido,
  PropagacionLeida,
  RecetaLeida,
  RepositorioDeRecetas,
  ResultadoDeAltaDeProducto,
  TipoDeProducto,
} from '../application/ports/repositorio-de-recetas.port';

const ACTIVA = 'ACTIVE';
const CODIGO_DE_DUPLICADO = 'P2002';

interface Decimal {
  toFixed: () => string;
}

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === CODIGO_DE_DUPLICADO;
}

/** El filtro que distingue una receta de producto de una de subpreparación. */
function porDestino(destino: DestinoDeReceta): { productId: string } | { itemId: string } {
  return destino.clase === 'producto' ? { productId: destino.productId } : { itemId: destino.itemId };
}

const CAMPOS_DE_RECETA = {
  id: true,
  locationId: true,
  status: true,
  validFrom: true,
  note: true,
  lineas: {
    select: { itemId: true, cantidad: true, base: true, estado: true, orden: true },
    orderBy: { orden: 'asc' },
  },
} as const;

@Injectable()
export class PrismaRecetasRepositorio implements RepositorioDeRecetas {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async crearProducto(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly tipo: TipoDeProducto;
    readonly categoria: string | null;
  }): Promise<ResultadoDeAltaDeProducto> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      try {
        const fila = await tx.product.create({
          data: {
            companyId: entrada.companyId,
            name: entrada.nombre,
            type: entrada.tipo,
            category: entrada.categoria,
            status: ACTIVA,
          },
          select: { id: true },
        });
        return { clase: 'creado', id: aProductId(fila.id) };
      } catch (error) {
        if (esDuplicado(error)) {
          return { clase: 'nombre_en_uso' };
        }
        throw error;
      }
    });
  }

  public async listarProductos(companyId: CompanyId): Promise<readonly ProductoLeido[]> {
    return this.transaccion.run(companyId, async (tx) => {
      const filas = await tx.product.findMany({
        where: { companyId },
        select: { id: true, name: true, type: true, category: true, status: true },
        orderBy: { name: 'asc' },
      });

      return filas.map(comoProducto);
    });
  }

  public async buscarProducto(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
  }): Promise<ProductoLeido | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.product.findFirst({
        where: { id: entrada.productId, companyId: entrada.companyId },
        select: { id: true, name: true, type: true, category: true, status: true },
      });

      return fila === null ? null : comoProducto(fila);
    });
  }

  public async configurarEnUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly locationId: LocationId;
    readonly activo: boolean;
    readonly pvp: string | null;
    readonly rendimientoPorciones: string | null;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.productLocation.upsert({
        where: {
          productId_locationId: { productId: entrada.productId, locationId: entrada.locationId },
        },
        create: {
          companyId: entrada.companyId,
          productId: entrada.productId,
          locationId: entrada.locationId,
          activo: entrada.activo,
          pvp: entrada.pvp,
          rendimientoPorciones: entrada.rendimientoPorciones,
        },
        update: {
          activo: entrada.activo,
          pvp: entrada.pvp,
          rendimientoPorciones: entrada.rendimientoPorciones,
        },
      });
    });
  }

  public async ubicacionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
  }): Promise<readonly ProductoEnUbicacion[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.productLocation.findMany({
        where: { companyId: entrada.companyId, productId: entrada.productId },
        select: { locationId: true, activo: true, pvp: true, rendimientoPorciones: true },
      });

      return filas.map((f) => ({
        locationId: aLocationId(f.locationId),
        activo: f.activo,
        pvp: f.pvp === null ? null : f.pvp.toFixed(),
        rendimientoPorciones: f.rendimientoPorciones === null ? null : f.rendimientoPorciones.toFixed(),
      }));
    });
  }

  public async grafoDeItems(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<GrafoDeItems> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.recipe.findMany({
        where: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          itemId: { not: null },
          status: ACTIVA,
        },
        select: { itemId: true, validFrom: true, createdAt: true, lineas: { select: { itemId: true } } },
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      // La primera de cada ítem es la más reciente: la consulta ya viene
      // ordenada. Aquí es donde se resolvería con `DISTINCT ON` si algún día
      // fueran miles de subpreparaciones.
      const grafo = new Map<ItemId, readonly ItemId[]>();
      for (const fila of filas) {
        if (fila.itemId === null) {
          continue;
        }
        const clave = aItemId(fila.itemId);
        if (!grafo.has(clave)) {
          grafo.set(
            clave,
            fila.lineas.map((l) => aItemId(l.itemId)),
          );
        }
      }

      return grafo;
    });
  }

  public async guardarVersion(datos: DatosDeVersion): Promise<RecipeId> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const receta = await tx.recipe.create({
        data: {
          companyId: datos.companyId,
          locationId: datos.locationId,
          ...porDestino(datos.destino),
          status: datos.estado,
          validFrom: datos.validFrom,
          createdBy: datos.createdBy,
          note: datos.nota,
        },
        select: { id: true },
      });

      if (datos.lineas.length > 0) {
        await tx.recipeLine.createMany({
          data: datos.lineas.map((linea, orden) => ({
            companyId: datos.companyId,
            recipeId: receta.id,
            itemId: linea.itemId,
            cantidad: linea.cantidad,
            base: linea.base,
            estado: linea.estado,
            orden,
          })),
        });
      }

      return aRecipeId(receta.id);
    });
  }

  public async recetaVigente(entrada: {
    readonly companyId: CompanyId;
    readonly destino: DestinoDeReceta;
    readonly locationId: LocationId;
    readonly fecha: Date;
  }): Promise<RecetaLeida | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.recipe.findFirst({
        where: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          ...porDestino(entrada.destino),
          validFrom: { lte: entrada.fecha },
        },
        select: CAMPOS_DE_RECETA,
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      // Una versión `VOID` es la respuesta «aquí no hay receta», y gana igual
      // que cualquier otra si es la más reciente: es lo que hace que revertir
      // una propagación sobre una ubicación que no tenía receta la devuelva a
      // no tenerla.
      if (fila?.status !== ACTIVA) {
        return null;
      }

      return comoReceta(fila);
    });
  }

  public async versionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly destino: DestinoDeReceta;
    readonly locationId: LocationId;
  }): Promise<readonly RecetaLeida[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.recipe.findMany({
        where: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          ...porDestino(entrada.destino),
        },
        select: CAMPOS_DE_RECETA,
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      return filas.map(comoReceta);
    });
  }

  public async destinosDePropagacion(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly origen: LocationId;
  }): Promise<readonly DestinoDePropagacion[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const ubicaciones = await tx.productLocation.findMany({
        where: {
          companyId: entrada.companyId,
          productId: entrada.productId,
          activo: true,
          locationId: { not: entrada.origen },
        },
        select: { locationId: true, location: { select: { name: true } } },
      });

      const actual = await this.recetasActuales(tx, {
        companyId: entrada.companyId,
        productId: entrada.productId,
        ubicaciones: ubicaciones.map((u) => u.locationId),
      });

      return ubicaciones.map((u) => {
        const suya = actual.get(u.locationId);
        return {
          locationId: aLocationId(u.locationId),
          nombre: u.location.name,
          // «Personalizada» es «tiene una receta propia que se perderia». Una
          // version VOID no cuenta: ahi no hay nada que perder.
          personalizada: suya?.status === ACTIVA,
          recetaActual: suya === undefined ? null : aRecipeId(suya.id),
        };
      });
    });
  }

  /** La version mas reciente de cada ubicacion, en una sola consulta. */
  private async recetasActuales(
    tx: ClienteDeTransaccion,
    entrada: {
      readonly companyId: CompanyId;
      readonly productId: ProductId;
      readonly ubicaciones: readonly string[];
    },
  ): Promise<Map<string, { id: string; status: string }>> {
    const recetas = await tx.recipe.findMany({
      where: {
        companyId: entrada.companyId,
        productId: entrada.productId,
        locationId: { in: [...entrada.ubicaciones] },
      },
      select: { id: true, locationId: true, status: true },
      orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
    });

    const actual = new Map<string, { id: string; status: string }>();
    for (const receta of recetas) {
      if (!actual.has(receta.locationId)) {
        actual.set(receta.locationId, { id: receta.id, status: receta.status });
      }
    }

    return actual;
  }

  public async registrarPropagacion(
    entrada: DatosDePropagacionRegistrada,
  ): Promise<RecipePropagationId> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const propagacion = await tx.recipePropagation.create({
        data: {
          companyId: entrada.companyId,
          productId: entrada.productId,
          sourceRecipeId: entrada.sourceRecipeId,
          propagatedBy: entrada.propagatedBy,
        },
        select: { id: true },
      });

      await tx.recipePropagationTarget.createMany({
        data: entrada.destinos.map((d) => ({
          propagationId: propagacion.id,
          locationId: d.locationId,
          previousRecipeId: d.anterior,
          createdRecipeId: d.creada,
        })),
      });

      return aPropagationId(propagacion.id);
    });
  }

  public async buscarPropagacion(entrada: {
    readonly companyId: CompanyId;
    readonly propagacionId: RecipePropagationId;
  }): Promise<PropagacionLeida | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.recipePropagation.findFirst({
        where: { id: entrada.propagacionId, companyId: entrada.companyId },
        select: {
          id: true,
          productId: true,
          propagatedAt: true,
          revertedAt: true,
          destinos: {
            select: { locationId: true, previousRecipeId: true, createdRecipeId: true },
          },
        },
      });

      if (fila === null) {
        return null;
      }

      return {
        id: aPropagationId(fila.id),
        productId: aProductId(fila.productId),
        propagadaEn: fila.propagatedAt,
        revertidaEn: fila.revertedAt,
        destinos: fila.destinos.map((d) => ({
          locationId: aLocationId(d.locationId),
          anterior: d.previousRecipeId === null ? null : aRecipeId(d.previousRecipeId),
          creada: aRecipeId(d.createdRecipeId),
        })),
      };
    });
  }

  public async marcarRevertida(entrada: {
    readonly companyId: CompanyId;
    readonly propagacionId: RecipePropagationId;
    readonly userId: UserId;
    readonly ahora: Date;
  }): Promise<boolean> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      // `revertedAt: null` en el WHERE cierra la carrera entre dos reversiones
      // simultáneas: gana una y la otra ve `count = 0`.
      const resultado = await tx.recipePropagation.updateMany({
        where: { id: entrada.propagacionId, companyId: entrada.companyId, revertedAt: null },
        data: { revertedAt: entrada.ahora, revertedBy: entrada.userId },
      });

      return resultado.count > 0;
    });
  }

  public async lineasDe(entrada: {
    readonly companyId: CompanyId;
    readonly recipeId: RecipeId;
  }): Promise<readonly LineaLeida[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.recipeLine.findMany({
        where: { companyId: entrada.companyId, recipeId: entrada.recipeId },
        select: { itemId: true, cantidad: true, base: true, estado: true, orden: true },
        orderBy: { orden: 'asc' },
      });

      return filas.map(comoLinea);
    });
  }
}

function comoProducto(fila: {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
}): ProductoLeido {
  return {
    id: aProductId(fila.id),
    nombre: fila.name,
    tipo: fila.type,
    categoria: fila.category,
    estado: fila.status,
  };
}

function comoLinea(fila: {
  itemId: string;
  cantidad: Decimal;
  base: string;
  estado: string;
  orden: number;
}): LineaLeida {
  return {
    itemId: aItemId(fila.itemId),
    cantidad: fila.cantidad.toFixed(),
    base: fila.base as BaseDeLinea,
    estado: fila.estado as EstadoDeLinea,
    orden: fila.orden,
  };
}

function comoReceta(fila: {
  id: string;
  locationId: string;
  status: string;
  validFrom: Date;
  note: string | null;
  lineas: readonly { itemId: string; cantidad: Decimal; base: string; estado: string; orden: number }[];
}): RecetaLeida {
  return {
    id: aRecipeId(fila.id),
    locationId: aLocationId(fila.locationId),
    estado: fila.status,
    validFrom: fila.validFrom,
    nota: fila.note,
    lineas: fila.lineas.map(comoLinea),
  };
}
