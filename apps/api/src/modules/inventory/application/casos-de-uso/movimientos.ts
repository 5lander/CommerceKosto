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
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  ItemId,
  LocationId,
  MovementId,
  PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import { Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { LeerItem, ListarItems } from '../../../catalog/application/casos-de-uso/items';
import {
  exigirUbicacionEnAlcance,
  type SesionActiva,
} from '../../../iam/application/casos-de-uso/validar-sesion';
import type { ExigirPeriodoAbierto } from '../../../periods/application/casos-de-uso/periodos';
import { corregir } from '../../domain/correccion';
import {
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
  readonly costoTotal: string | null;
  readonly purchaseArticleId: PurchaseArticleId | null;
  readonly occurredAt: Date;
  readonly note: string | null;
}

export class RegistrarMovimiento {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * @throws {UbicacionFueraDeAlcanceError} @throws {ItemDelLibroNoEncontradoError}
   * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
   * @throws {FechaFuturaError}
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

    const id = await this.deps.repositorio.registrarUno({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimiento: {
        locationId: datos.locationId,
        itemId: datos.itemId,
        tipo: datos.tipo,
        cantidad: cantidad.toStorageString(),
        costoTotal: datos.costoTotal,
        purchaseArticleId: datos.purchaseArticleId,
        reversesMovementId: null,
        occurredAt: datos.occurredAt,
        note: datos.note,
      },
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

/**
 * La fila que anula a otra.
 *
 * EL IMPORTE VIAJA CON LA CANTIDAD, y no es un detalle: sin él,
 * `compras_del_mes` (SPEC §16) seguiría contando el dinero de una compra que se
 * anuló, aunque su cantidad ya se hubiera cancelado.
 */
function anulacionDe(
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
    purchaseArticleId: null,
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
  const { deps, sesion, eventType, detail } = evento;

  await deps.auditoria.record({
    eventType,
    outcome: 'success',
    actorType: 'USER',
    actorId: sesion.userId,
    companyId: sesion.companyId,
    ip: null,
    userAgent: null,
    detail,
  });
}
