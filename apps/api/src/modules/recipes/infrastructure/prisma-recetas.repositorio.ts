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
import type { ResultadoDeLote } from '../../../shared/application/lote';
import { clavePorNombre, nombresQueChocan } from '../../../shared/domain/lote/problemas';
import type {
  ComponenteDeCombo,
  ComponenteEnLote,
  ConfiguracionEnUbicacion,
  DatosDeProductoEnLote,
  DatosDePropagacionRegistrada,
  DatosDeVersion,
  DestinoDePropagacion,
  DestinoDeReceta,
  LineaLeida,
  ProductoConUbicacion,
  ProductoEnUbicacion,
  ProductoLeido,
  PropagacionLeida,
  RecetaEnLote,
  RecetaLeida,
  RecetaVigenteLeida,
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

const CAMPOS_DE_CONFIGURACION = {
  activo: true,
  pvp: true,
  rendimientoPorciones: true,
} as const;

const CAMPOS_DE_PRODUCTO = {
  id: true,
  name: true,
  type: true,
  category: true,
  status: true,
  packagingItemId: true,
} as const;

/** Lo que devuelve un `select: CAMPOS_DE_RECETA`. */
/** Lo que devuelve un `select` de las columnas de una linea. */
interface FilaDeLinea {
  itemId: string;
  cantidad: Decimal;
  base: string;
  estado: string;
  orden: number;
}

interface FilaDeReceta {
  id: string;
  locationId: string;
  status: string;
  validFrom: Date;
  note: string | null;
  lineas: readonly FilaDeLinea[];
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

  /**
   * TODO EL LOTE O NADA — un solo `run()`.
   *
   * Tres escrituras que tienen que ocurrir juntas: el producto, su empaque y su
   * configuracion en la ubicacion. `createMany` no devuelve ids, asi que los
   * productos se releen por nombre despues de crearlos —el indice unico
   * `(company_id, name)` lo hace determinista— y con esos ids se escribe el
   * resto.
   */
  public async crearProductosEnLote(datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly productos: readonly DatosDeProductoEnLote[];
  }): Promise<ResultadoDeLote> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const existentes = await tx.product.findMany({
        where: { companyId: datos.companyId },
        select: { name: true },
      });
      const chocan = nombresQueChocan(
        datos.productos.map((p) => p.nombre),
        existentes.map((f) => f.name),
      );
      if (chocan.length > 0) return { clase: 'nombres_en_uso', nombres: chocan };

      await tx.product.createMany({
        data: datos.productos.map((producto) => ({
          companyId: datos.companyId,
          name: producto.nombre.trim(),
          type: producto.tipo,
          category: producto.categoria,
          packagingItemId: producto.empaqueItemId,
          status: ACTIVA,
        })),
      });

      await activarEnUbicacion(tx, datos);

      return { clase: 'escrito', filas: datos.productos.length };
    });
  }

  /**
   * TODO EL LOTE O NADA — recetas y componentes de combo en la misma
   * transaccion.
   *
   * Los componentes van con `createMany`; las recetas, una a una, porque cada
   * version necesita su `id` para colgarle las lineas.
   */
  public async guardarRecetasEnLote(datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly recetas: readonly RecetaEnLote[];
    readonly combos: readonly ComponenteEnLote[];
    readonly validFrom: Date;
    readonly createdBy: UserId;
  }): Promise<number> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      for (const receta of datos.recetas) {
        await escribirVersion(tx, datos, receta);
      }

      if (datos.combos.length > 0) {
        await tx.comboComponent.createMany({
          data: datos.combos.map((componente) => ({
            companyId: datos.companyId,
            comboProductId: componente.comboProductId,
            componentProductId: componente.componentProductId,
            cantidad: componente.cantidad,
          })),
        });
      }

      return datos.recetas.length + datos.combos.length;
    });
  }

  public async listarProductos(companyId: CompanyId): Promise<readonly ProductoLeido[]> {
    return this.transaccion.run(companyId, async (tx) => {
      const filas = await tx.product.findMany({
        where: { companyId },
        select: CAMPOS_DE_PRODUCTO,
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
        select: CAMPOS_DE_PRODUCTO,
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
        select: { locationId: true, ...CAMPOS_DE_CONFIGURACION },
      });

      return filas.map((f) => ({ locationId: aLocationId(f.locationId), ...comoConfiguracion(f) }));
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

  public async asignarEmpaque(entrada: {
    readonly companyId: CompanyId;
    readonly productId: ProductId;
    readonly empaqueItemId: ItemId | null;
  }): Promise<boolean> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      // `updateMany` y no `update`: bajo RLS, `update` con `RETURNING` exige la
      // politica de SELECT y ademas lanza si no encuentra la fila. Aqui «no
      // existe» es una respuesta, no una excepcion (INC-010).
      const resultado = await tx.product.updateMany({
        where: { id: entrada.productId, companyId: entrada.companyId },
        data: { packagingItemId: entrada.empaqueItemId },
      });

      return resultado.count > 0;
    });
  }

  public async recetasVigentesDeUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly fecha: Date;
  }): Promise<readonly RecetaVigenteLeida[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.recipe.findMany({
        where: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          validFrom: { lte: entrada.fecha },
        },
        select: { ...CAMPOS_DE_RECETA, productId: true, itemId: true },
        // El orden ES la seleccion: la primera fila de cada destino es la
        // vigente. Lo sirve el indice `recipe_por_ubicacion_y_vigencia` de P5.
        orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
      });

      return vigentesPorDestino(filas);
    });
  }

  public async productosEnUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly ProductoConUbicacion[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.productLocation.findMany({
        where: { companyId: entrada.companyId, locationId: entrada.locationId },
        select: { productId: true, ...CAMPOS_DE_CONFIGURACION },
      });

      return filas.map((f) => ({ productId: aProductId(f.productId), ...comoConfiguracion(f) }));
    });
  }

  public async componentesDeCombos(
    companyId: CompanyId,
  ): Promise<readonly ComponenteDeCombo[]> {
    return this.transaccion.run(companyId, async (tx) => {
      const filas = await tx.comboComponent.findMany({
        where: { companyId },
        select: { comboProductId: true, componentProductId: true, cantidad: true },
      });

      return filas.map((f) => ({
        comboProductId: aProductId(f.comboProductId),
        componentProductId: aProductId(f.componentProductId),
        cantidad: f.cantidad.toFixed(),
      }));
    });
  }
}

/**
 * De todas las versiones ordenadas por vigencia, la primera de cada destino.
 *
 * UNA VERSION `VOID` GANA IGUAL QUE CUALQUIER OTRA si es la mas reciente, y
 * entonces ese destino NO aparece en el resultado. Es la respuesta «aqui no hay
 * receta», que es distinta de una receta vacia: una receta vacia cuesta cero, y
 * cero es un numero plausible y equivocado.
 */
function vigentesPorDestino(
  filas: readonly (FilaDeReceta & { productId: string | null; itemId: string | null })[],
): readonly RecetaVigenteLeida[] {
  const vistos = new Set<string>();
  const vigentes: RecetaVigenteLeida[] = [];

  for (const fila of filas) {
    const destino = destinoDe(fila);
    if (destino === null) {
      continue;
    }

    const clave = destino.clase === 'producto' ? `p:${destino.productId}` : `i:${destino.itemId}`;
    if (vistos.has(clave)) {
      continue;
    }
    vistos.add(clave);

    if (fila.status === ACTIVA) {
      vigentes.push({ ...comoReceta(fila), destino });
    }
  }

  return vigentes;
}

function destinoDe(fila: {
  productId: string | null;
  itemId: string | null;
}): DestinoDeReceta | null {
  if (fila.productId !== null) {
    return { clase: 'producto', productId: aProductId(fila.productId) };
  }
  if (fila.itemId !== null) {
    return { clase: 'item', itemId: aItemId(fila.itemId) };
  }
  // Un `CHECK` de la migracion lo hace imposible. Si llegara, se salta en vez
  // de reventar el costeo entero de la carta.
  return null;
}


/**
 * La configuracion de un producto en una ubicacion, sin decir de cual de los
 * dos lados se mira.
 *
 * `ubicacionesDe` la ve desde el producto y `productosEnUbicacion` desde la
 * ubicacion; el resto es identico, y `audit:duplication` lo marco. La forma
 * tiene un nombre en el puerto —`ConfiguracionEnUbicacion`— y aqui una sola
 * traduccion.
 */
function comoConfiguracion(fila: {
  activo: boolean;
  pvp: Decimal | null;
  rendimientoPorciones: Decimal | null;
}): ConfiguracionEnUbicacion {
  return {
    activo: fila.activo,
    pvp: fila.pvp === null ? null : fila.pvp.toFixed(),
    rendimientoPorciones:
      fila.rendimientoPorciones === null ? null : fila.rendimientoPorciones.toFixed(),
  };
}

function comoProducto(fila: {
  id: string;
  name: string;
  type: string;
  category: string | null;
  status: string;
  packagingItemId: string | null;
}): ProductoLeido {
  return {
    id: aProductId(fila.id),
    nombre: fila.name,
    tipo: fila.type,
    categoria: fila.category,
    estado: fila.status,
    empaqueItemId: fila.packagingItemId === null ? null : aItemId(fila.packagingItemId),
  };
}

function comoLinea(fila: FilaDeLinea): LineaLeida {
  return {
    itemId: aItemId(fila.itemId),
    cantidad: fila.cantidad.toFixed(),
    base: fila.base as BaseDeLinea,
    estado: fila.estado as EstadoDeLinea,
    orden: fila.orden,
  };
}

function comoReceta(fila: FilaDeReceta): RecetaLeida {
  return {
    id: aRecipeId(fila.id),
    locationId: aLocationId(fila.locationId),
    estado: fila.status,
    validFrom: fila.validFrom,
    nota: fila.note,
    lineas: fila.lineas.map(comoLinea),
  };
}

/**
 * Una version de receta con sus lineas, dentro de una transaccion que ya esta
 * abierta. Es el cuerpo de `guardarVersion` sin el `run()`, para que el lote
 * pueda escribir cuarenta y ocho dentro de una sola.
 */
async function escribirVersion(
  tx: ClienteDeTransaccion,
  datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly validFrom: Date;
    readonly createdBy: UserId;
  },
  receta: RecetaEnLote,
): Promise<void> {
  const fila = await tx.recipe.create({
    data: {
      companyId: datos.companyId,
      locationId: datos.locationId,
      ...porDestino(receta.destino),
      status: ACTIVA,
      validFrom: datos.validFrom,
      createdBy: datos.createdBy,
      note: null,
    },
    select: { id: true },
  });

  if (receta.lineas.length === 0) return;

  await tx.recipeLine.createMany({
    data: receta.lineas.map((linea, orden) => ({
      companyId: datos.companyId,
      recipeId: fila.id,
      itemId: linea.itemId,
      cantidad: linea.cantidad,
      base: linea.base,
      estado: linea.estado,
      orden,
    })),
  });
}

/**
 * La configuracion de cada producto en la ubicacion, dentro de la transaccion
 * que acaba de crearlos.
 *
 * Los ids se releen por nombre porque `createMany` no los devuelve, y el indice
 * unico `(company_id, name)` hace que esa relectura sea determinista.
 */
async function activarEnUbicacion(
  tx: ClienteDeTransaccion,
  datos: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly productos: readonly DatosDeProductoEnLote[];
  },
): Promise<void> {
  const creados = await tx.product.findMany({
    where: { companyId: datos.companyId },
    select: { id: true, name: true },
  });
  const porNombre = new Map(creados.map((f) => [clavePorNombre(f.name), f.id]));

  await tx.productLocation.createMany({
    data: datos.productos.map((producto) => ({
      companyId: datos.companyId,
      productId: porNombre.get(clavePorNombre(producto.nombre)) ?? '',
      locationId: datos.locationId,
      activo: producto.activo,
      pvp: producto.pvp,
      rendimientoPorciones: producto.rendimientoPorciones,
    })),
  });
}
