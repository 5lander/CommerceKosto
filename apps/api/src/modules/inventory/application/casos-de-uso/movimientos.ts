/**
 * Los movimientos que un usuario registra directamente, y la corrección.
 *
 * **AQUÍ NO SE DECIDE NINGÚN SIGNO.** Lo pone `conSignoDelTipo`, en el dominio,
 * y por eso quien captura escribe siempre magnitudes positivas: «2,5 kg de
 * merma», no «−2,5 kg». Este archivo trae datos y escribe filas.
 *
 * **LO QUE NO DEVUELVE ES TAN IMPORTANTE COMO LO QUE DEVUELVE.** Ninguna de
 * estas operaciones responde con el saldo resultante, y no es un descuido:
 * `BODEGA` puede registrar compras y mermas, y `saldo = inicial + compras −
 * consumo`. Quien conoce el inicial y las compras y además ve el saldo, despeja
 * el consumo — que dividido entre las unidades vendidas **es** la cantidad de
 * la receta (CLAUDE.md §4.3). Una respuesta que dijera «nuevo saldo: 12,4 kg»
 * filtraría exactamente lo mismo que un endpoint de lectura.
 *
 * **UNA COMPRA SE NETEA AQUÍ, Y NUNCA CON UNA TARIFA SUPUESTA** (D-16.9). El
 * bodeguero teclea el total de la factura; la tarifa sale de cuerpo > artículo
 * > grupo por el puerto de `catalog`, la recuperabilidad del ajuste de la
 * company por el de `pricing`, y el dominio construye los cuatro importes
 * (D-16.10). Sin tarifa, 400 con el mensaje que dice dónde ponerla.
 */

import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  ItemId,
  LocationId,
  MovementId,
  PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import { TarifaDeIvaDesconocidaError } from '../../../../shared/domain/iva/errores';
import { elegirTarifa } from '../../../../shared/domain/iva/precedencia';
import { exigirTarifaValida } from '../../../../shared/domain/iva/tarifa';
import { Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { LeerItem, ListarGrupos, ListarItems } from '../../../catalog/application/casos-de-uso/items';
import type { TarifasDeIva } from '../../../catalog/application/casos-de-uso/tarifas-de-iva';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import type { ExigirPeriodoAbierto } from '../../../periods/application/casos-de-uso/periodos';
import type { LeerAjustes } from '../../../pricing/application/casos-de-uso/ajustes';
import { desglosarCompra, type CompraDesglosada } from '../../domain/compra';
import { corregir } from '../../domain/correccion';
import {
  CompraSinImporteError,
  ItemDelLibroNoEncontradoError,
  MovimientoNoEncontradoError,
  MovimientoYaCorregidoError,
} from '../../domain/errores';
import { conSignoDelTipo, exigirFechaPasada, TIPOS_DIRECTOS } from '../../domain/movimiento';
import type {
  ConsultaDelLibro,
  MovimientoLeido,
  MovimientoParaGuardar,
  PaginaDelLibro,
  RepositorioDeInventario,
  SaldoLeido,
} from '../ports/repositorio-de-inventario.port';

export interface DependenciasDeInventario {
  readonly repositorio: RepositorioDeInventario;
  readonly leerItem: LeerItem;
  readonly listarItems: ListarItems;
  /** Los dos escalones de abajo de la tarifa de IVA: artículo y grupo (D-16.9). */
  readonly tarifasDeIva: TarifasDeIva;
  /** El lote resuelve el grupo de cada fila con UNA lectura, no una por fila. */
  readonly listarGrupos: ListarGrupos;
  /** La recuperabilidad del IVA es de la company (R13): se lee por el puerto de `pricing`. */
  readonly leerAjustes: LeerAjustes;
  /** La guarda del mes cerrado (D6). La llaman las CINCO escrituras. */
  readonly periodos: ExigirPeriodoAbierto;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

/**
 * Las tres comprobaciones que hace TODA escritura del libro, en un solo sitio.
 *
 * Estaban repetidas en las cinco, y la del período iba a ser la sexta línea
 * copiada. Reunirlas tiene un efecto que va más allá de no duplicar: `grep
 * exigirLibroEscribible` da **la lista completa** de formas de escribir en el
 * libro, y una escritura que no aparezca ahí salta a la vista en la revisión.
 *
 * El orden es el que produce el mejor mensaje: primero si puedes escribir en
 * esa ubicación, luego si la fecha es registrable, y por último si ese mes
 * sigue abierto. Al usuario que se equivoca de local no se le habla de meses.
 *
 * **NO ES LA GARANTÍA DEL PERÍODO CERRADO.** Esa es el trigger
 * `inventory_movement_respeta_periodo_cerrado`, que cubre toda fila que entre
 * aunque alguien escriba una sexta escritura y no llame a esto.
 */
export async function exigirLibroEscribible(entrada: {
  readonly deps: DependenciasDeInventario;
  readonly sesion: SesionActiva;
  readonly locationId: LocationId;
  readonly ocurridoEn: Date;
}): Promise<void> {
  exigirUbicacionEnAlcance(entrada.sesion, entrada.locationId);
  exigirFechaPasada(entrada.ocurridoEn, entrada.deps.reloj.ahora());
  await entrada.deps.periodos.ejecutar(entrada.sesion, {
    locationId: entrada.locationId,
    ocurridoEn: entrada.ocurridoEn,
  });
}

/** Dónde y cuándo quiere escribir una fila: lo que la guarda necesita saber. */
export interface EscrituraDelLibro {
  readonly locationId: LocationId;
  readonly ocurridoEn: Date;
}

/**
 * La misma guarda aplicada a un conjunto de escrituras, **una vez por mes y
 * ubicación distintos** y no una por fila.
 *
 * Un archivo puede traer marzo y abril mezclados, y si marzo está cerrado hay
 * que pararlo antes de escribir nada; consultar el período 500 veces para
 * averiguarlo sería pagar 500 veces por la misma respuesta. Lo que importa es
 * el mes, no la fila.
 */
export async function exigirLibroEscribibleEnCada(entrada: {
  readonly deps: DependenciasDeInventario;
  readonly sesion: SesionActiva;
  readonly escrituras: readonly EscrituraDelLibro[];
}): Promise<void> {
  const unicas = new Map(
    entrada.escrituras.map((e) => [`${e.locationId}|${claveDeMes(e.ocurridoEn)}`, e]),
  );

  for (const escritura of unicas.values()) {
    await exigirLibroEscribible({
      deps: entrada.deps,
      sesion: entrada.sesion,
      locationId: escritura.locationId,
      ocurridoEn: escritura.ocurridoEn,
    });
  }
}

/** El mes al que pertenece un instante, para no repetir la consulta de período. */
function claveDeMes(fecha: Date): string {
  return `${String(fecha.getUTCFullYear())}-${String(fecha.getUTCMonth())}`;
}

/** El saldo con lo que el catálogo aporta: cómo se llama y en qué se mide. */
export interface SaldoConNombre extends SaldoLeido {
  readonly nombre: string;
  readonly unidadDeUso: string;
}

/** Un tipo que un usuario puede registrar por sí solo (`COMPRA`, `MERMA`, `AJUSTE`). */
export type TipoDirecto = (typeof TIPOS_DIRECTOS)[number];

export interface DatosDeMovimiento {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly tipo: TipoDirecto;
  /** Magnitud, tal como se captura. En `AJUSTE` puede venir negativa. */
  readonly cantidad: string;
  /** En `COMPRA`, el total de la factura CON IVA: se netea aquí (D-16.9). */
  readonly costoTotal: string | null;
  readonly purchaseArticleId: PurchaseArticleId | null;
  /** Solo en `COMPRA`: la tarifa de la factura, que manda sobre artículo y grupo. */
  readonly ivaTarifa: string | null;
  readonly occurredAt: Date;
  readonly note: string | null;
}

export class RegistrarMovimiento {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {ItemDelLibroNoEncontradoError}
   * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
   * @throws {FechaFuturaError} @throws {TarifaDeIvaDesconocidaError}
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeMovimiento): Promise<MovementId> {
    await exigirLibroEscribible({
      deps: this.deps,
      sesion,
      locationId: datos.locationId,
      ocurridoEn: datos.occurredAt,
    });

    const item = await exigirItem(this.deps, sesion, datos.itemId);
    const cantidad = conSignoDelTipo(
      datos.tipo,
      Quantity.of(datos.cantidad, unidadDeUso(item.unidadDeUso)),
    );
    const compra = datos.tipo === 'COMPRA' ? await this.desglosar(sesion, datos) : null;

    const id = await this.deps.repositorio.registrarUno({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimiento: filaDe(datos, cantidad, compra),
    });

    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.movement.recorded',
      detail: {
        movementId: id,
        tipo: datos.tipo,
        locationId: datos.locationId,
        itemId: datos.itemId,
      },
    });

    return id;
  }

  /**
   * Los cuatro importes de una COMPRA (D-16.10): tarifa por precedencia
   * cuerpo > artículo > grupo, recuperabilidad de la company, neto del dominio.
   *
   * @throws {TarifaDeIvaDesconocidaError} @throws {CompraSinImporteError}
   */
  private async desglosar(sesion: SesionActiva, datos: DatosDeMovimiento): Promise<CompraDesglosada> {
    if (datos.costoTotal === null) throw new CompraSinImporteError();

    const [catalogo, ajustes] = await Promise.all([
      this.deps.tarifasDeIva.ejecutar(sesion, {
        itemId: datos.itemId,
        purchaseArticleId: datos.purchaseArticleId,
      }),
      this.deps.leerAjustes.ejecutar(sesion),
    ]);

    const tarifa = elegirTarifa({ cuerpo: datos.ivaTarifa, ...catalogo });
    if (tarifa === null) throw new TarifaDeIvaDesconocidaError();

    return desglosarCompra({
      bruto: datos.costoTotal,
      tarifa: exigirTarifaValida(tarifa),
      recuperable: ajustes.ivaCompraRecuperable,
    });
  }
}

/**
 * R3 — corregir es INSERTAR una fila que anula, nunca editar la original.
 *
 * Las dos comprobaciones que evitan un 500 (INC-012): que no esté ya corregido
 * —lo pararía el índice único de `reverses_movement_id` con un `23505`— y que
 * el original no sea a su vez una corrección, que `corregir()` rechaza.
 */
export class CorregirMovimiento {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * @throws {MovimientoNoEncontradoError} @throws {MovimientoYaCorregidoError}
   * @throws {CorreccionDeCorreccionError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: { readonly movementId: MovementId; readonly note: string | null },
  ): Promise<MovementId> {
    const original = await this.deps.repositorio.buscarMovimiento({
      companyId: sesion.companyId,
      movementId: datos.movementId,
    });
    if (original === null) throw new MovimientoNoEncontradoError();

    // La corrección conserva la fecha del original (R3), así que corregir
    // dentro de un mes cerrado también se detiene aquí. Es lo que «cerrado es
    // de solo lectura» significa: para arreglarlo hay que reabrirlo.
    await exigirLibroEscribible({
      deps: this.deps,
      sesion,
      locationId: original.locationId,
      ocurridoEn: original.occurredAt,
    });
    if (original.corregidoPor !== null) throw new MovimientoYaCorregidoError();

    const item = await exigirItem(this.deps, sesion, original.itemId);
    const id = await this.deps.repositorio.registrarUno({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimiento: anulacionDe(original, item.unidadDeUso, datos.note),
    });

    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.correction.recorded',
      detail: { movementId: id, corrige: original.id, tipo: original.tipo },
    });

    return id;
  }
}

/**
 * El saldo por ítem de una ubicación — la proyección del libro (R3).
 *
 * **EXIGE `inventory.read`, QUE `BODEGA` NO TIENE.** Ver la cabecera de este
 * archivo: el saldo permite despejar la receta.
 */
export class ConsultarSaldos {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * DOS CONSULTAS FIJAS, no una por ítem: el agregado del libro y el catálogo
   * entero por su puerto. Es lo que exige CLAUDE.md §2 —`inventory` no toca las
   * tablas de `catalog`— y lo que sostiene el presupuesto de §5.
   *
   * @throws {UbicacionFueraDeAlcanceError}
   */
  public async ejecutar(
    sesion: SesionActiva,
    entrada: { readonly locationId: LocationId },
  ): Promise<readonly SaldoConNombre[]> {
    exigirUbicacionEnAlcance(sesion, entrada.locationId);

    const [saldos, items] = await Promise.all([
      this.deps.repositorio.saldos({
        companyId: sesion.companyId,
        locationId: entrada.locationId,
        hasta: null,
      }),
      this.deps.listarItems.ejecutar(sesion, false),
    ]);

    const porId = new Map(items.map((item) => [item.id, item]));

    return saldos
      .map((saldo) => conNombre(saldo, porId))
      .filter((saldo): saldo is SaldoConNombre => saldo !== null)
      .sort((izquierda, derecha) => izquierda.nombre.localeCompare(derecha.nombre));
  }
}

/**
 * Un movimiento del libro por su id — la pantalla de corrección (P16-C, D-16.125).
 *
 * LA PERTENENCIA A LA COMPANY la pone el `WHERE` del repositorio: uno de otra
 * company es el mismo 404 que uno inventado. LA DE LA UBICACIÓN, el alcance: un
 * gerente que pide un movimiento de otro local recibe 403, como en el resto de
 * las lecturas por ubicación (CLAUDE.md §4.4).
 */
export class ConsultarMovimiento {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /** @throws {MovimientoNoEncontradoError} @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(sesion: SesionActiva, movementId: MovementId): Promise<MovimientoLeido> {
    const movimiento = await this.deps.repositorio.buscarMovimiento({ companyId: sesion.companyId, movementId });
    if (movimiento === null) throw new MovimientoNoEncontradoError();

    exigirUbicacionEnAlcance(sesion, movimiento.locationId);
    return movimiento;
  }
}

export class ListarMovimientos {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /** @throws {UbicacionFueraDeAlcanceError} */
  public async ejecutar(
    sesion: SesionActiva,
    consulta: Omit<ConsultaDelLibro, 'companyId'>,
  ): Promise<PaginaDelLibro> {
    exigirUbicacionEnAlcance(sesion, consulta.locationId);
    return this.deps.repositorio.libro({ ...consulta, companyId: sesion.companyId });
  }
}

/**
 * Un saldo cuyo ítem ya no está en el catálogo se OMITE.
 *
 * No debería poder pasar —los ítems no se borran, se archivan (CLAUDE.md §5)— y
 * si pasara, mostrar un saldo sin nombre sería peor que no mostrarlo: nadie
 * podría saber de qué es.
 */
function conNombre(
  saldo: SaldoLeido,
  porId: ReadonlyMap<string, { readonly nombre: string; readonly unidadDeUso: string }>,
): SaldoConNombre | null {
  const item = porId.get(saldo.itemId);
  if (item === undefined) return null;
  return { ...saldo, nombre: item.nombre, unidadDeUso: item.unidadDeUso };
}

/** La fila de un movimiento directo; en una COMPRA, con el neto y el desglose. */
function filaDe(
  datos: DatosDeMovimiento,
  cantidad: Quantity,
  compra: CompraDesglosada | null,
): MovimientoParaGuardar {
  return {
    locationId: datos.locationId,
    itemId: datos.itemId,
    tipo: datos.tipo,
    cantidad: cantidad.toStorageString(),
    costoTotal: compra === null ? datos.costoTotal : compra.costoTotal,
    desglose: compra === null ? null : compra.desglose,
    purchaseArticleId: datos.purchaseArticleId,
    reversesMovementId: null,
    occurredAt: datos.occurredAt,
    note: datos.note,
  };
}

/**
 * La fila que anula a otra. La usan la corrección de una sola y la anulación de
 * una importación entera (D-16.200): **deshacer es siempre lo mismo**, cambie
 * el número de filas.
 *
 * EL IMPORTE VIAJA CON LA CANTIDAD, y no es un detalle: sin él,
 * `compras_del_mes` (SPEC §16) seguiría contando el dinero de una compra que se
 * anuló, aunque su cantidad ya se hubiera cancelado.
 *
 * Y EL DESGLOSE VIAJA ENTERO (D-16.41): la corrección de una compra con
 * desglose no queda «sin desglose», y así el CHECK de coherencia la admite y
 * Σ(bruto) del mes se cancela igual que Σ(neto).
 */
export function anulacionDe(
  original: MovimientoLeido,
  unidad: string,
  note: string | null,
): MovimientoParaGuardar {
  const anulacion = corregir({
    locationId: original.locationId,
    itemId: original.itemId,
    tipo: original.tipo,
    cantidad: Quantity.fromDatabase(original.cantidad, unidadDeUso(unidad)),
    ocurridoEn: original.occurredAt,
    corrigeA: original.corrigeA,
  });

  return {
    locationId: anulacion.locationId,
    itemId: anulacion.itemId,
    tipo: anulacion.tipo,
    cantidad: anulacion.cantidad.toStorageString(),
    costoTotal: original.costoTotal,
    desglose: original.desglose,
    // Y EL ARTÍCULO TAMBIÉN (INC-029): se devuelve la misma presentación que se
    // compró. Sin él, la devolución caía en otro grupo que la compra y la
    // comparativa por presentación no podía cuadrar ni restando.
    purchaseArticleId: original.purchaseArticleId,
    reversesMovementId: original.id,
    occurredAt: anulacion.ocurridoEn,
    note,
  };
}

/** @throws {ItemDelLibroNoEncontradoError} */
export async function exigirItem(
  deps: DependenciasDeInventario,
  sesion: SesionActiva,
  id: ItemId,
): Promise<{ readonly unidadDeUso: string }> {
  const item = await deps.leerItem.ejecutar(sesion, id);
  if (item === null) throw new ItemDelLibroNoEncontradoError();
  return item;
}

/** El evento de auditoría de una escritura del libro (SEGURIDAD.md §10). */
export interface EventoDelLibro {
  readonly deps: DependenciasDeInventario;
  readonly sesion: SesionActiva;
  readonly eventType: string;
  readonly detail: Readonly<Record<string, string>>;
}

export async function registrarEvento(evento: EventoDelLibro): Promise<void> {
  await registrarEventoDeUsuario({
    auditoria: evento.deps.auditoria,
    actorId: evento.sesion.userId,
    companyId: evento.sesion.companyId,
    eventType: evento.eventType,
    detail: evento.detail,
  });
}
