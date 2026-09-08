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
import type {
  ResultadoDeLote,
  ResultadoDeLoteConLimite,
} from '../../../shared/application/lote';
import {
  clavePorNombre,
  nombresQueChocan,
  nombresUnicos,
} from '../../../shared/domain/lote/problemas';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import {
  excedeElLimite,
  limitesBloqueados,
} from '../../../shared/infrastructure/persistence/limites-del-plan';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  ArticuloLeido,
  DatosDeArticuloEnLote,
  DatosDeItemEnLote,
  DatosParaActualizarItem,
  DatosParaCrearArticulo,
  DatosParaCrearItem,
  GrupoLeido,
  ItemLeido,
  RepositorioDeCatalogo,
  ResultadoDeAlta,
  ResultadoDeAltaDeItem,
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

  public async crearItem(datos: DatosParaCrearItem): Promise<ResultadoDeAltaDeItem> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      // EL LIMITE DEL PLAN, DENTRO DE LA MISMA TRANSACCION QUE INSERTA (D5).
      // Contar fuera seria un TOCTOU; ver `limites-del-plan.ts`.
      const maximo = excedeElLimite({
        actuales: await tx.item.count({ where: { companyId: datos.companyId } }),
        nuevos: 1,
        maximo: (await limitesBloqueados(tx, datos.companyId)).items,
      });
      if (maximo !== null) return { clase: 'limite', maximo };

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

  /**
   * TODO EL LOTE O NADA — un solo `run()`, una sola transaccion.
   *
   * EL ORDEN IMPORTA Y NO ES ARBITRARIO:
   *
   *   1. leer los nombres que ya existen y devolverlos SIN escribir nada
   *   2. asegurar los grupos que faltan
   *   3. `createMany` de los items, en UNA sentencia
   *
   * El paso 1 existe para poder decir QUE nombres chocan. Dejar que el indice
   * unico lo descubra daria un `P2002` que solo nombra la restriccion, y quien
   * migra doscientos items necesita la lista, no el codigo de error.
   *
   * Sigue habiendo `catch` de duplicado como respaldo: entre la lectura y la
   * escritura cabe otra transaccion. Con RLS y `FORCE`, todo esto ocurre dentro
   * del tenant fijado por `run`.
   */
  public async crearItemsEnLote(datos: {
    readonly companyId: CompanyId;
    readonly items: readonly DatosDeItemEnLote[];
  }): Promise<ResultadoDeLoteConLimite> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      // El lote entero contra el limite, antes de mirar los nombres: importar
      // trescientos items sobre un limite de quinientos con cuatrocientos ya
      // dentro no puede escribir los cien primeros.
      const maximo = excedeElLimite({
        actuales: await tx.item.count({ where: { companyId: datos.companyId } }),
        nuevos: datos.items.length,
        maximo: (await limitesBloqueados(tx, datos.companyId)).items,
      });
      if (maximo !== null) return { clase: 'limite', maximo };

      const existentes = await tx.item.findMany({
        where: { companyId: datos.companyId },
        select: { name: true },
      });
      const chocan = nombresQueChocan(
        datos.items.map((i) => i.nombre),
        existentes.map((f) => f.name),
      );
      if (chocan.length > 0) return { clase: 'nombres_en_uso', nombres: chocan };

      const grupos = await asegurarGrupos(tx, datos.companyId, datos.items);

      await tx.item.createMany({
        data: datos.items.map((item) => ({
          companyId: datos.companyId,
          name: item.nombre.trim(),
          type: item.tipo,
          unitOfUse: item.unidadDeUso,
          yield: item.rendimiento,
          groupId: item.grupo === null ? null : (grupos.get(clavePorNombre(item.grupo)) ?? null),
          status: ESTADO_ACTIVO,
          priceConfidence: item.confianzaDePrecio,
          keepsStock: item.llevaStock,
        })),
      });

      return { clase: 'escrito', filas: datos.items.length };
    });
  }

  /**
   * TODO EL LOTE O NADA. Ver `crearItemsEnLote`.
   *
   * Los articulos apuntan a su item POR NOMBRE, que es lo que trae un archivo.
   * Un nombre que no exista es un problema del lote y se devuelve como choque
   * invertido: `nombres_en_uso` lleva aqui los items que FALTAN, y el caso de
   * uso lo traduce. Es el unico sitio donde la union significa dos cosas, y por
   * eso el caso de uso no la reenvia tal cual.
   */
  public async crearArticulosEnLote(datos: {
    readonly companyId: CompanyId;
    readonly articulos: readonly DatosDeArticuloEnLote[];
  }): Promise<ResultadoDeLote> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const items = await tx.item.findMany({
        where: { companyId: datos.companyId },
        select: { id: true, name: true },
      });
      const porNombre = new Map(items.map((f) => [clavePorNombre(f.name), f.id]));

      const faltan = datos.articulos
        .map((a) => a.item)
        .filter((nombre) => !porNombre.has(clavePorNombre(nombre)));
      if (faltan.length > 0) return { clase: 'nombres_en_uso', nombres: nombresUnicos(faltan) };

      await tx.purchaseArticle.createMany({
        data: datos.articulos.map((articulo) => ({
          companyId: datos.companyId,
          itemId: porNombre.get(clavePorNombre(articulo.item)) ?? '',
          name: articulo.nombre.trim(),
          brand: articulo.marca,
          supplier: articulo.proveedor,
          presentationAmount: articulo.presentacion,
          presentationUnit: articulo.unidadDePresentacion,
          conversionFactor: articulo.factorDeConversion,
          status: ESTADO_ACTIVO,
        })),
      });

      return { clase: 'escrito', filas: datos.articulos.length };
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


/**
 * Crea los grupos que el lote menciona y no existen, y devuelve el mapa
 * completo de nombre normalizado a id.
 *
 * `skipDuplicates` evita tener que restar conjuntos con cuidado: se piden
 * todos, la base ignora los que ya estan. Despues se relee, porque
 * `createMany` no devuelve ids.
 */
async function asegurarGrupos(
  tx: ClienteDeTransaccion,
  companyId: CompanyId,
  items: readonly DatosDeItemEnLote[],
): Promise<ReadonlyMap<string, string>> {
  const nombres = nombresUnicos(items.flatMap((item) => (item.grupo === null ? [] : [item.grupo])));
  if (nombres.length === 0) return new Map();

  await tx.itemGroup.createMany({
    data: nombres.map((name) => ({ companyId, name })),
    skipDuplicates: true,
  });

  const filas = await tx.itemGroup.findMany({
    where: { companyId },
    select: { id: true, name: true },
  });

  return new Map(filas.map((f) => [clavePorNombre(f.name), f.id]));
}
