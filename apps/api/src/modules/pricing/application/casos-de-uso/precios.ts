/**
 * Precios de referencia — SPEC §6, R5.
 *
 * **NINGÚN PRECIO SE MOVIÓ SOLO.** Sugerir y confirmar son dos operaciones,
 * dos permisos y dos personas posibles: `GERENTE_LOCAL` sugiere porque ve las
 * compras de su local y es quien primero nota que un precio subió; confirmar es
 * de quien responde por el margen.
 *
 * NO EXISTE «ACTUALIZAR UN PRECIO». Un precio nuevo es una fila nueva con otra
 * vigencia, y de ahí sale E8 —cambiar el precio de hoy no altera el costo del
 * mes pasado— sin escribir nada más. Un trigger en la base impide reescribir el
 * importe de una fila existente, porque el `GRANT UPDATE` que hace falta para
 * confirmar no sabe distinguir «cambiar el estado» de «cambiar el importe».
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  ItemId,
  PurchaseArticleId,
  ReferencePriceId,
} from '../../../../shared/domain/identity/identificadores';
import { Money, Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { LeerItem, ListarItems } from '../../../catalog/application/casos-de-uso/items';
import type { ListarArticulos } from '../../../catalog/application/casos-de-uso/articulos';
import { costoDelItem, type CostoDelItem } from '../../domain/cadena-de-costo';
import {
  ConflictoDePrecioError,
  ItemSinPrecioError,
  PrecioNoEncontradoError,
} from '../../domain/errores';
import { precioVigenteA } from '../../domain/vigencia';
import type {
  DecisionSobrePrecio,
  OrigenDePrecio,
  PrecioLeido,
  RepositorioDePrecios,
} from '../ports/repositorio-de-precios.port';

export interface DependenciasDePrecios {
  readonly repositorio: RepositorioDePrecios;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
  /**
   * EL CATALOGO SE LEE POR SU PUERTO, NUNCA POR SUS TABLAS.
   *
   * CLAUDE.md §2: «los demas modulos referencian por ID y leen a traves de sus
   * puertos». `pricing` necesita dos cosas del catalogo —el rendimiento del
   * item y el factor de conversion de su articulo, los dos factores de la
   * cadena de SPEC §12— y las pide asi. La regla
   * `tablas-de-catalogo-solo-en-catalog` de `audit:forbidden` lo hace cumplir:
   * el primer intento de este paquete leia `tx.item` a mano y el check lo
   * paro.
   */
  readonly leerItem: LeerItem;
  readonly listarArticulos: ListarArticulos;
  /**
   * El catalogo ENTERO de items, para costear una carta sin un N+1. Lo usa
   * `CostosDeItems`; `CostoDeItem` sigue leyendo de uno en uno porque resuelve
   * uno solo.
   */
  readonly listarItems: ListarItems;
}

export interface DatosDeSugerencia {
  readonly itemId: ItemId;
  readonly purchaseArticleId: PurchaseArticleId | null;
  readonly precio: string;
  readonly ivaCompra: string | null;
  readonly origen: OrigenDePrecio;
  readonly validFrom: Date;
  readonly nota: string | null;
}

export class SugerirPrecio {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDeSugerencia): Promise<ReferencePriceId> {
    // Los decimales se parsean AQUÍ. Si la cadena no es un decimal exacto,
    // `Money` y `Ratio` lanzan en el borde y no seis capas más abajo con un
    // valor ya redondeado.
    Money.fromDecimalString(datos.precio);

    await this.exigirArticuloCoherente(sesion, datos);

    const ivaCompra = datos.ivaCompra ?? (await this.ivaPorDefecto(sesion));
    Ratio.fromDecimalString(ivaCompra);

    const id = await this.deps.repositorio.sugerir({
      companyId: sesion.companyId,
      itemId: datos.itemId,
      purchaseArticleId: datos.purchaseArticleId,
      precio: datos.precio,
      ivaCompra,
      origen: datos.origen,
      validFrom: datos.validFrom,
      createdBy: sesion.userId,
      nota: datos.nota,
    });

    await this.deps.auditoria.record({
      eventType: 'pricing.reference_price.suggested',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { precioId: id, itemId: datos.itemId, origen: datos.origen },
    });

    return id;
  }

  /**
   * Un precio sin presentación no significa nada: «2.30» solo es un dato junto
   * a «el saco de 2 kg». Y una preparación PRODUCIDA no se compra: su precio es
   * el costo estándar por unidad de uso (R10), y no lleva artículo.
   *
   * **UN TRIGGER YA LO IMPIDE EN LA BASE.** Esto lo EXPLICA: un `P0001` del
   * driver sale por el filtro como INTERNAL_ERROR 500 —un fallo del servidor—
   * cuando lo que hay es un formulario mal llenado. Lo destapó la prueba de
   * integración de P5.
   */
  private async exigirArticuloCoherente(
    sesion: SesionActiva,
    datos: DatosDeSugerencia,
  ): Promise<void> {
    const item = await this.deps.leerItem.ejecutar(sesion, datos.itemId);
    if (item === null) {
      throw new PrecioNoEncontradoError();
    }

    if (item.tipo === 'COMPRADO' && datos.purchaseArticleId === null) {
      throw new ItemSinPrecioError(
        'El precio de un ítem comprado necesita su artículo: un importe sin presentación no dice cuánto cuesta la unidad de uso.',
      );
    }
    if (item.tipo === 'PRODUCIDO' && datos.purchaseArticleId !== null) {
      throw new ItemSinPrecioError(
        'Una preparación producida no se compra: su precio es el costo estándar por unidad de uso, sin artículo (R10).',
      );
    }
  }

  /**
   * La tasa de la company es solo el VALOR POR DEFECTO. La que manda es la de
   * la factura, que llega por `datos.ivaCompra`: en Ecuador el alimento sin
   * procesar es 0 % y el detergente 15 %, y una única tasa por company estaría
   * equivocada para uno de los dos.
   */
  private async ivaPorDefecto(sesion: SesionActiva): Promise<string> {
    const ajustes = await this.deps.repositorio.ajustes(sesion.companyId);
    if (ajustes === null) {
      throw new ItemSinPrecioError('La company no tiene parámetros de costeo configurados.');
    }
    return ajustes.ivaCompra;
  }
}

export class ResolverPrecio {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  /** @throws {PrecioNoEncontradoError} · {@link ConflictoDePrecioError} */
  public async ejecutar(
    sesion: SesionActiva,
    precioId: ReferencePriceId,
    decision: DecisionSobrePrecio,
  ): Promise<void> {
    const resultado = await this.deps.repositorio.resolver({
      companyId: sesion.companyId,
      precioId,
      userId: sesion.userId,
      ahora: this.deps.reloj.ahora(),
      decision,
    });

    if (resultado === 'no_encontrado') {
      throw new PrecioNoEncontradoError();
    }
    if (resultado === 'ya_resuelto') {
      // Dos administradores que confirman a la vez: gana uno y el otro se
      // entera. La alternativa —responder 204 a los dos— dejaría a alguien
      // creyendo que confirmó lo que en realidad rechazó el otro.
      throw new ConflictoDePrecioError('Ese precio ya fue confirmado o rechazado.');
    }

    await this.deps.auditoria.record({
      eventType:
        decision === 'CONFIRMED'
          ? 'pricing.reference_price.confirmed'
          : 'pricing.reference_price.rejected',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { precioId },
    });
  }
}

export class HistorialDePrecios {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  public async ejecutar(sesion: SesionActiva, itemId: ItemId): Promise<readonly PrecioLeido[]> {
    return this.deps.repositorio.historial({ companyId: sesion.companyId, itemId });
  }
}

export interface CostoVigente {
  readonly precioId: ReferencePriceId;
  readonly vigenteDesde: Date;
  readonly precioNeto: string;
  readonly costoBrutoDeUso: string;
  readonly costoNetoDeUso: string;
  readonly sobrecostoDeMerma: string;
}

export class CostoDeItem {
  public constructor(private readonly deps: DependenciasDePrecios) {}

  /**
   * El costo por unidad de uso a una fecha, con la cadena de SPEC §12 entera.
   *
   * `fecha` es un PARAMETRO y no `ahora`: es lo que permite preguntar cuanto
   * costaba el mes pasado y obtener el precio que estaba vigente entonces, no
   * el de ahora. Es el criterio E8, expuesto.
   */
  public async ejecutar(sesion: SesionActiva, itemId: ItemId, fecha: Date): Promise<CostoVigente> {
    const item = await this.deps.leerItem.ejecutar(sesion, itemId);
    if (item === null) {
      throw new PrecioNoEncontradoError();
    }

    const precios = await this.deps.repositorio.historial({ companyId: sesion.companyId, itemId });
    const vigente = precioVigenteA(precios, fecha);
    if (vigente === null) {
      throw new ItemSinPrecioError('Ese item no tiene ningun precio confirmado a esa fecha.');
    }

    const ajustes = await this.deps.repositorio.ajustes(sesion.companyId);
    if (ajustes === null) {
      throw new ItemSinPrecioError('La company no tiene parametros de costeo configurados.');
    }

    const costo = costoDelItem({
      precioDeCompra: Money.fromDatabase(vigente.precio),
      ivaCompra: Ratio.fromDecimalString(vigente.ivaCompra),
      ivaRecuperable: ajustes.ivaCompraRecuperable,
      factorDeConversion: await this.factorDe(sesion, vigente),
      rendimiento: Ratio.fromDecimalString(item.rendimiento),
    });

    return presentar(vigente, costo);
  }

  /**
   * Una preparacion PRODUCIDA no tiene articulo: su precio YA esta expresado
   * por unidad de uso (costo estandar, R10), asi que el factor es 1 y no divide
   * nada. Es lo que hace que el plato no cambie de costo segun cuanto se
   * produjo ese dia.
   */
  private async factorDe(sesion: SesionActiva, vigente: PrecioLeido): Promise<Ratio> {
    if (vigente.purchaseArticleId === null) {
      return Ratio.UNO;
    }

    const articulos = await this.deps.listarArticulos.ejecutar(sesion, vigente.itemId);
    const suyo = articulos.find((a) => a.id === vigente.purchaseArticleId);
    if (suyo === undefined) {
      throw new ItemSinPrecioError('El articulo de ese precio ya no esta en el catalogo.');
    }

    return Ratio.fromDecimalString(suyo.factorDeConversion);
  }
}

function presentar(vigente: PrecioLeido, costo: CostoDelItem): CostoVigente {
  return {
    precioId: vigente.id,
    vigenteDesde: vigente.validFrom,
    precioNeto: costo.precioNeto.toStorageString(),
    costoBrutoDeUso: costo.costoBrutoDeUso.toStorageString(),
    costoNetoDeUso: costo.costoNetoDeUso.toStorageString(),
    sobrecostoDeMerma: costo.sobrecostoDeMerma.toStorageString(),
  };
}
