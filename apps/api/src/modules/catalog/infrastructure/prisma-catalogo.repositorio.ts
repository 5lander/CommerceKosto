/**
 * El puerto de catálogo, sobre PostgreSQL.
 *
 * TODO PASA POR `TenantTransaction.run()`, incluida la lectura del catálogo de
 * unidades — que no tiene tenant. Podría ir por `runWithoutTenant`, pero no hay
 * ninguna razón para hacerlo: quien lee unidades ya tiene sesión, y usar el
 * camino sin tenant sin necesitarlo gasta la excepción. Las excepciones que no
 * hacen falta son las que enseñan a usarlas.
 *
 * LOS DECIMALES SALEN COMO CADENA, nunca como `number`. `Decimal.toFixed()` de
 * Prisma devuelve la representación exacta; un `Number(...)` en el camino
 * convertiría `453.59237` en un binario aproximado y el error viajaría hasta el
 * costeo. `audit:forbidden` prohíbe esa coerción en `domain`, y aquí se respeta
 * la misma disciplina aunque la regla no llegue.
 */

import { Injectable } from '@nestjs/common';

import {
  itemGroupId as aGroupId,
  itemId as aItemId,
  purchaseArticleId as aArticleId,
  type CompanyId,
  type ItemGroupId,
  type ItemId,
  type PurchaseArticleId,
} from '../../../shared/domain/identity/identificadores';
import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  ArticuloLeido,
  DatosParaActualizarItem,
  DatosParaCrearArticulo,
  DatosParaCrearItem,
  GrupoLeido,
  ItemLeido,
  RepositorioDeCatalogo,
  ResultadoDeAlta,
} from '../application/ports/repositorio-de-catalogo.port';
import type { Dimension, UnidadDelCatalogo } from '../domain/conversion';

const ESTADO_ACTIVO = 'ACTIVE';

/** Violación de restricción única en Prisma. */
const CODIGO_DE_DUPLICADO = 'P2002';

const DIMENSIONES: ReadonlySet<string> = new Set(['MASA', 'VOLUMEN', 'CONTEO']);

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === CODIGO_DE_DUPLICADO;
}

/**
 * El `dimension` que llega de la base es `text` por el catálogo, y aquí se
 * estrecha a la unión del dominio. Si algún día apareciera una cuarta dimensión
 * en la tabla sin añadirla al tipo, esto lanza en vez de dejarla pasar como una
 * cadena cualquiera hasta la lógica de conversión.
 */
function comoDimension(valor: string): Dimension {
  if (!DIMENSIONES.has(valor)) {
    throw new Error(`Dimensión desconocida en el catálogo de unidades: "${valor}".`);
  }
  return valor as Dimension;
}

@Injectable()
export class PrismaCatalogoRepositorio implements RepositorioDeCatalogo {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async unidades(): Promise<readonly UnidadDelCatalogo[]> {
    return this.transaccion.runWithoutTenant(
      'catalogo GLOBAL de unidades: un kilogramo pesa lo mismo en todas las companies',
      async (tx) => {
        const filas = await tx.unit.findMany({
          select: { code: true, dimension: true, factorToBase: true },
          orderBy: { code: 'asc' },
        });

        return filas.map((f) => ({
          codigo: unidadDeUso(f.code),
          dimension: comoDimension(f.dimension),
          factorABase: Ratio.fromDecimalString(f.factorToBase.toFixed()),
        }));
      },
    );
  }

  public async crearGrupo(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
  }): Promise<ResultadoDeAlta<ItemGroupId>> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      try {
        const fila = await tx.itemGroup.create({
          data: { companyId: entrada.companyId, name: entrada.nombre },
          select: { id: true },
        });
        return { clase: 'creado', id: aGroupId(fila.id) };
      } catch (error) {
        if (esDuplicado(error)) {
          return { clase: 'nombre_en_uso' };
        }
        throw error;
      }
    });
  }

  public async listarGrupos(companyId: CompanyId): Promise<readonly GrupoLeido[]> {
    return this.transaccion.run(companyId, async (tx) => {
      const filas = await tx.itemGroup.findMany({
        where: { companyId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });

      return filas.map((f) => ({ id: aGroupId(f.id), nombre: f.name }));
    });
  }

  public async crearItem(datos: DatosParaCrearItem): Promise<ResultadoDeAlta<ItemId>> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      try {
        const fila = await tx.item.create({
          data: {
            companyId: datos.companyId,
            name: datos.nombre,
            type: datos.tipo,
            unitOfUse: datos.unidadDeUso,
            yield: datos.rendimiento,
            groupId: datos.grupoId,
            status: ESTADO_ACTIVO,
            priceConfidence: datos.confianzaDePrecio,
            keepsStock: datos.llevaStock,
          },
          select: { id: true },
        });
        return { clase: 'creado', id: aItemId(fila.id) };
      } catch (error) {
        if (esDuplicado(error)) {
          return { clase: 'nombre_en_uso' };
        }
        throw error;
      }
    });
  }

  public async actualizarItem(datos: DatosParaActualizarItem): Promise<boolean> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      // `updateMany` y no `update`: sin `RETURNING`, y con `company_id` repetido
      // en el WHERE. RLS ya lo filtra, pero una defensa que solo está en un
      // sitio se cae entera si ese sitio falla.
      const resultado = await tx.item.updateMany({
        where: { id: datos.itemId, companyId: datos.companyId },
        data: {
          name: datos.nombre,
          yield: datos.rendimiento,
          groupId: datos.grupoId,
          priceConfidence: datos.confianzaDePrecio,
          status: datos.estado,
          keepsStock: datos.llevaStock,
        },
      });

      return resultado.count > 0;
    });
  }

  public async listarItems(entrada: {
    readonly companyId: CompanyId;
    readonly soloActivos: boolean;
  }): Promise<readonly ItemLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.item.findMany({
        where: {
          companyId: entrada.companyId,
          ...(entrada.soloActivos ? { status: ESTADO_ACTIVO } : {}),
        },
        select: CAMPOS_DE_ITEM,
        orderBy: { name: 'asc' },
      });

      return filas.map(comoItemLeido);
    });
  }

  public async buscarItem(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId;
  }): Promise<ItemLeido | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.item.findFirst({
        where: { id: entrada.itemId, companyId: entrada.companyId },
        select: CAMPOS_DE_ITEM,
      });

      return fila === null ? null : comoItemLeido(fila);
    });
  }

  public async crearArticulo(
    datos: DatosParaCrearArticulo,
  ): Promise<ResultadoDeAlta<PurchaseArticleId>> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      try {
        const fila = await tx.purchaseArticle.create({
          data: {
            companyId: datos.companyId,
            itemId: datos.itemId,
            name: datos.nombre,
            brand: datos.marca,
            supplier: datos.proveedor,
            presentationAmount: datos.presentacion,
            presentationUnit: datos.unidadDePresentacion,
            conversionFactor: datos.factorDeConversion,
            status: ESTADO_ACTIVO,
          },
          select: { id: true },
        });
        return { clase: 'creado', id: aArticleId(fila.id) };
      } catch (error) {
        if (esDuplicado(error)) {
          return { clase: 'nombre_en_uso' };
        }
        throw error;
      }
    });
  }

  public async listarArticulos(entrada: {
    readonly companyId: CompanyId;
    readonly itemId: ItemId | null;
  }): Promise<readonly ArticuloLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.purchaseArticle.findMany({
        where: {
          companyId: entrada.companyId,
          ...(entrada.itemId === null ? {} : { itemId: entrada.itemId }),
        },
        select: {
          id: true,
          itemId: true,
          name: true,
          brand: true,
          supplier: true,
          presentationAmount: true,
          presentationUnit: true,
          conversionFactor: true,
          status: true,
        },
        orderBy: { name: 'asc' },
      });

      return filas.map((f) => ({
        id: aArticleId(f.id),
        itemId: aItemId(f.itemId),
        nombre: f.name,
        marca: f.brand,
        proveedor: f.supplier,
        presentacion: f.presentationAmount.toFixed(),
        unidadDePresentacion: f.presentationUnit,
        factorDeConversion: f.conversionFactor.toFixed(),
        estado: f.status,
      }));
    });
  }
}

const CAMPOS_DE_ITEM = {
  id: true,
  name: true,
  type: true,
  unitOfUse: true,
  yield: true,
  groupId: true,
  status: true,
  priceConfidence: true,
  keepsStock: true,
} as const;

function comoItemLeido(fila: {
  id: string;
  name: string;
  type: string;
  unitOfUse: string;
  yield: { toFixed: () => string };
  groupId: string | null;
  status: string;
  priceConfidence: string;
  keepsStock: boolean | null;
}): ItemLeido {
  return {
    id: aItemId(fila.id),
    nombre: fila.name,
    tipo: fila.type,
    unidadDeUso: fila.unitOfUse,
    rendimiento: fila.yield.toFixed(),
    grupoId: fila.groupId,
    estado: fila.status,
    confianzaDePrecio: fila.priceConfidence,
    llevaStock: fila.keepsStock,
  };
}
