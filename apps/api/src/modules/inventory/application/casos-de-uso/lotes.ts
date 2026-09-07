/**
 * Escritura EN LOTE del libro de inventario.
 *
 * **ES EL ÚNICO DE LOS CUATRO QUE NO NECESITÓ TOCAR SU REPOSITORIO.**
 * `registrarVarios` ya existía desde P6 y ya abre un solo `run()`: el libro
 * nació sabiendo que una transferencia son dos filas que ocurren juntas o no
 * ocurren, y de ahí sale gratis que 500 compras también lo hagan.
 *
 * **EL SIGNO LO SIGUE PONIENDO EL DOMINIO**, fila a fila, con `conSignoDelTipo`
 * (ADR-009). Un lote no es excusa para escribir la cantidad a pelo: sin signo el
 * saldo deja de ser una suma.
 *
 * **LA HORA NO ES UN DETALLE.** Un archivo trae `2026-03-01`, sin hora, y quien
 * lo escriba a medianoche UTC estará metiendo en febrero un movimiento de marzo:
 * las cinco primeras horas UTC de cada día 1 son del mes anterior en Ecuador. Es
 * INC-013, y el que la convierte es quien llama a este caso de uso — aquí lo que
 * llega ya es un instante.
 */

import type { ItemId, LocationId } from '../../../../shared/domain/identity/identificadores';
import {
  PRIMERA_POSICION,
  clavePorNombre,
  type ProblemaDelLote,
} from '../../../../shared/domain/lote/problemas';
import { Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { MovimientoDeLoteInvalidoError } from '../../domain/errores';
import {
  motivoDelMovimiento,
  problemasDelLoteDeMovimientos,
  type MovimientoDelLote,
} from '../../domain/lote';
import { conSignoDelTipo } from '../../domain/movimiento';
import type { MovimientoParaGuardar } from '../ports/repositorio-de-inventario.port';
import { exigirLibroEscribible, type DependenciasDeInventario } from './movimientos';

export class RegistrarMovimientosEnLote {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly movimientos: readonly MovimientoDelLote[];
    },
  ): Promise<number> {
    const problemas = problemasDelLoteDeMovimientos(entrada.movimientos);
    if (problemas.length > 0) throw new MovimientoDeLoteInvalidoError(problemas);

    await this.exigirLibroEscribibleParaTodos(sesion, entrada);

    const items = await this.itemsPorNombre(sesion);
    const preparados = preparar(entrada.movimientos, entrada.locationId, items);

    const ids = await this.deps.repositorio.registrarVarios({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimientos: preparados,
    });

    await this.deps.auditoria.record({
      eventType: 'inventory.movements.bulk_recorded',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { filas: ids.length, locationId: entrada.locationId },
    });

    return ids.length;
  }

  /**
   * La guarda de las cinco escrituras del libro, aplicada a **cada fecha
   * distinta** del lote y no solo a la primera.
   *
   * Un archivo puede traer marzo y abril mezclados, y si marzo está cerrado hay
   * que pararlo antes de escribir nada. Se agrupan las fechas para no consultar
   * el período 500 veces: lo que importa es el mes, no la fila.
   */
  private async exigirLibroEscribibleParaTodos(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly movimientos: readonly MovimientoDelLote[];
    },
  ): Promise<void> {
    const fechas = new Map(entrada.movimientos.map((m) => [claveDeMes(m.occurredAt), m.occurredAt]));

    for (const ocurridoEn of fechas.values()) {
      await exigirLibroEscribible({
        deps: this.deps,
        sesion,
        locationId: entrada.locationId,
        ocurridoEn,
      });
    }
  }

  private async itemsPorNombre(
    sesion: SesionActiva,
  ): Promise<ReadonlyMap<string, { readonly id: ItemId; readonly unidadDeUso: string }>> {
    const items = await this.deps.listarItems.ejecutar(sesion, false);
    return new Map(
      items.map((i) => [clavePorNombre(i.nombre), { id: i.id, unidadDeUso: i.unidadDeUso }]),
    );
  }
}

/** El mes al que pertenece un instante, para no repetir la consulta de período. */
function claveDeMes(fecha: Date): string {
  return `${String(fecha.getUTCFullYear())}-${String(fecha.getUTCMonth())}`;
}

/**
 * Traduce el lote entero y recoge TODOS los motivos por los que no se puede.
 *
 * @throws {MovimientoDeLoteInvalidoError}
 */
function preparar(
  movimientos: readonly MovimientoDelLote[],
  locationId: LocationId,
  items: ReadonlyMap<string, { readonly id: ItemId; readonly unidadDeUso: string }>,
): readonly MovimientoParaGuardar[] {
  const problemas: ProblemaDelLote[] = [];
  const preparados: MovimientoParaGuardar[] = [];

  for (const [indice, movimiento] of movimientos.entries()) {
    const preparado = prepararUno(movimiento, locationId, items);
    if (typeof preparado === 'string') {
      problemas.push({ posicion: indice + PRIMERA_POSICION, motivo: preparado });
      continue;
    }
    preparados.push(preparado);
  }

  if (problemas.length > 0) throw new MovimientoDeLoteInvalidoError(problemas);
  return preparados;
}

function prepararUno(
  movimiento: MovimientoDelLote,
  locationId: LocationId,
  items: ReadonlyMap<string, { readonly id: ItemId; readonly unidadDeUso: string }>,
): MovimientoParaGuardar | string {
  const motivo = motivoDelMovimiento(movimiento);
  if (motivo !== null) return motivo;

  const item = items.get(clavePorNombre(movimiento.item));
  if (item === undefined) return `No existe ningún ítem llamado «${movimiento.item.trim()}».`;

  const cantidad = conSignoDelTipo(
    movimiento.tipo,
    Quantity.of(movimiento.cantidad, unidadDeUso(item.unidadDeUso)),
  );

  return {
    locationId,
    itemId: item.id,
    tipo: movimiento.tipo,
    cantidad: cantidad.toStorageString(),
    costoTotal: movimiento.costoTotal,
    purchaseArticleId: null,
    reversesMovementId: null,
    occurredAt: movimiento.occurredAt,
    note: movimiento.note,
  };
}

