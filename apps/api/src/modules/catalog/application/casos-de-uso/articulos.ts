/**
 * Artículos de compra — SPEC §5.
 *
 * **N artículos → 1 ítem.** Tres marcas de harina son tres artículos y un solo
 * ítem, y en las recetas aparece solo el ítem. Es la regla de producto que hace
 * que quien arma una receta no tenga que saber de marcas, y quien registra una
 * compra no tenga que saber de recetas.
 *
 * AQUÍ SE APLICA EL CRITERIO DE ACEPTACIÓN DE P2. El factor de conversión no se
 * captura: lo calcula `factorDeConversion` en el dominio, que deriva el número
 * cuando la presentación y la unidad de uso comparten dimensión y lo **exige**
 * cuando no. Una conversión inválida —kg → unidades sin factor— muere antes de
 * llegar a PostgreSQL.
 *
 * EL FACTOR SE GUARDA CALCULADO, y esa es una decisión con contrapartida. La
 * alternativa —recalcularlo en cada consulta— obligaría a leer el catálogo de
 * unidades dentro del motor de costeo de P5, que es dominio puro y no debe
 * consultar nada. Guardarlo hace el costeo autónomo; el precio es que si el
 * catálogo de unidades cambiara, los factores guardados quedarían atrás. No va
 * a cambiar: son constantes físicas, y la tabla es de solo lectura para la
 * aplicación.
 */

import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { ItemId, PurchaseArticleId } from '../../../../shared/domain/identity/identificadores';
import { exigirTarifaValida } from '../../../../shared/domain/iva/tarifa';
import { Quantity, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso, type UnidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import {
  ConversionInvalidaError,
  factorDeConversion,
  type UnidadDelCatalogo,
} from '../../domain/conversion';
import {
  ArticuloNoEncontradoError,
  ConflictoDeCatalogoError,
  EntradaDeCatalogoInvalidaError,
  ItemNoEncontradoError,
} from '../../domain/errores';
import type {
  ArticuloLeido,
  EstadoDeCatalogo,
  RepositorioDeCatalogo,
} from '../ports/repositorio-de-catalogo.port';

export interface DependenciasDeArticulos {
  readonly repositorio: RepositorioDeCatalogo;
  readonly auditoria: AuditLogPort;
}

export interface DatosDeAltaDeArticulo {
  readonly itemId: ItemId;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly presentacion: string;
  readonly unidadDePresentacion: string;
  /** Solo cuando la presentación y la unidad de uso no comparten dimensión. */
  readonly factorExplicito: string | null;
  /**
   * LA TARIFA DE IVA ES DEL ARTÍCULO (D-16.9) y es obligatoria: la factura del
   * saco de harina dice 0 % y la del detergente 15 %. Sin ella, ninguna compra
   * de este artículo se podría netear.
   */
  readonly ivaTarifa: string;
}

export class CrearArticulo {
  public constructor(private readonly deps: DependenciasDeArticulos) {}

  public async ejecutar(
    sesion: SesionActiva,
    datos: DatosDeAltaDeArticulo,
  ): Promise<PurchaseArticleId> {
    const factor = await this.factorPara(sesion, datos);
    const ivaTarifa = exigirTarifaValida(datos.ivaTarifa).toStorageString();

    const resultado = await this.deps.repositorio.crearArticulo({
      companyId: sesion.companyId,
      itemId: datos.itemId,
      nombre: datos.nombre.trim(),
      marca: datos.marca,
      proveedor: datos.proveedor,
      presentacion: datos.presentacion,
      unidadDePresentacion: unidadDeUso(datos.unidadDePresentacion),
      factorDeConversion: factor.toStorageString(),
      ivaTarifa,
    });

    if (resultado.clase === 'nombre_en_uso') throw new ArticuloRepetidoError();

    await this.deps.auditoria.record({
      eventType: 'catalog.article.created',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { articuloId: resultado.id, itemId: datos.itemId, factor: factor.toStorageString() },
    });

    return resultado.id;
  }

  /**
   * Resuelve el factor: lee el item, lee el catalogo de unidades y le pide al
   * dominio el numero. Va aparte porque es la unica parte con reglas dentro; lo
   * de arriba es guardar y auditar.
   */
  private async factorPara(sesion: SesionActiva, datos: DatosDeAltaDeArticulo): Promise<Ratio> {
    const item = await this.deps.repositorio.buscarItem({
      companyId: sesion.companyId,
      itemId: datos.itemId,
    });
    if (item === null) {
      throw new ItemNoEncontradoError();
    }

    const unidades = await this.deps.repositorio.unidades();
    const unidadDeCompra = exigirUnidad(unidades, unidadDeUso(datos.unidadDePresentacion));

    return calcular({
      presentacion: Quantity.of(datos.presentacion, unidadDeCompra.codigo),
      unidadDeCompra,
      unidadDeUso: exigirUnidad(unidades, unidadDeUso(item.unidadDeUso)),
      factorExplicito:
        datos.factorExplicito === null ? null : Ratio.fromDecimalString(datos.factorExplicito),
    });
  }
}

export interface DatosDeCambioDeArticulo {
  readonly articuloId: PurchaseArticleId;
  readonly nombre: string;
  readonly marca: string | null;
  readonly proveedor: string | null;
  readonly ivaTarifa: string;
  readonly estado: EstadoDeCatalogo;
}

/**
 * `PUT /catalogo/articulos/:id` — D-16.45. Existe en este paquete porque sin
 * él la semilla 0.15 de los artículos anteriores a P16-A1 no se podría
 * corregir, y «semilla, no verdad» sería una frase.
 *
 * LA PRESENTACIÓN, SU UNIDAD Y EL FACTOR NO SE CAMBIAN, y no es una omisión:
 * son lo que convierte cada compra histórica a unidades de uso. Cambiarlos
 * reescribiría el costo de meses ya cerrados sin tocar una sola fila del
 * libro. Si el saco pasa de 2 kg a 2,5 kg, es otro artículo.
 */
export class ActualizarArticulo {
  public constructor(private readonly deps: DependenciasDeArticulos) {}

  /** @throws {ArticuloNoEncontradoError} @throws {ConflictoDeCatalogoError} */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeCambioDeArticulo): Promise<void> {
    const ivaTarifa = exigirTarifaValida(datos.ivaTarifa).toStorageString();

    const resultado = await this.deps.repositorio.actualizarArticulo({
      companyId: sesion.companyId,
      articuloId: datos.articuloId,
      nombre: datos.nombre.trim(),
      marca: datos.marca,
      proveedor: datos.proveedor,
      ivaTarifa,
      estado: datos.estado,
    });

    if (resultado === 'no_encontrado') throw new ArticuloNoEncontradoError();
    if (resultado === 'nombre_en_uso') throw new ArticuloRepetidoError();

    await registrarEventoDeUsuario({
      auditoria: this.deps.auditoria,
      actorId: sesion.userId,
      companyId: sesion.companyId,
      eventType: 'catalog.article.updated',
      // La tarifa SÍ va al detalle: es el dato por el que este endpoint existe,
      // y saber quién la cambió y a qué es lo que una auditoría preguntará.
      detail: { articuloId: datos.articuloId, ivaTarifa, estado: datos.estado },
    });
  }
}

export class ListarArticulos {
  public constructor(private readonly deps: DependenciasDeArticulos) {}

  public async ejecutar(
    sesion: SesionActiva,
    itemId: ItemId | null,
  ): Promise<readonly ArticuloLeido[]> {
    return this.deps.repositorio.listarArticulos({ companyId: sesion.companyId, itemId });
  }
}

/** El mismo 409 para crear y para renombrar. */
class ArticuloRepetidoError extends ConflictoDeCatalogoError {
  public constructor() {
    super('Ya existe un artículo de compra con ese nombre.');
  }
}

/**
 * Traduce el error de dominio al error de aplicación.
 *
 * El de dominio no sabe de HTTP; el de aplicación tampoco, pero sí sabe que
 * esto lo pidió alguien y merece un 400 con el motivo dentro.
 */
function calcular(entrada: Parameters<typeof factorDeConversion>[0]): Ratio {
  try {
    return factorDeConversion(entrada);
  } catch (error) {
    if (error instanceof ConversionInvalidaError) {
      throw new EntradaDeCatalogoInvalidaError(error.message);
    }
    throw error;
  }
}

function exigirUnidad(
  catalogo: readonly UnidadDelCatalogo[],
  codigo: UnidadDeUso,
): UnidadDelCatalogo {
  const encontrada = catalogo.find((u) => u.codigo === codigo);
  if (encontrada === undefined) {
    throw new EntradaDeCatalogoInvalidaError(`La unidad "${codigo}" no está en el catálogo.`);
  }
  return encontrada;
}
