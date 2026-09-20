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
 *
 * **LA TARIFA DE IVA DE CADA COMPRA: FILA > GRUPO DEL ÍTEM** (D-16.44). El
 * archivo nunca trae artículo, así que el escalón del medio no existe aquí.
 * Sin tarifa, la fila se rechaza con su número, como un ítem desconocido:
 * «nunca 0.15» vale también para el importador. Los grupos y el ajuste de la
 * company se leen UNA vez para todo el lote.
 */

import type {
  ImportJobId,
  ItemId,
  LocationId,
} from '../../../../shared/domain/identity/identificadores';
import { elegirTarifa } from '../../../../shared/domain/iva/precedencia';
import { exigirTarifaValida } from '../../../../shared/domain/iva/tarifa';
import {
  PRIMERA_POSICION,
  clavePorNombre,
  type ProblemaDelLote,
} from '../../../../shared/domain/lote/problemas';
import { Quantity } from '../../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../../shared/domain/unidad/unidad-de-uso';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { desglosarCompra, type CompraDesglosada } from '../../domain/compra';
import { MovimientoDeLoteInvalidoError } from '../../domain/errores';
import {
  motivoDelMovimiento,
  problemasDelLoteDeMovimientos,
  type MovimientoDelLote,
} from '../../domain/lote';
import { conSignoDelTipo } from '../../domain/movimiento';
import type { MovimientoParaGuardar } from '../ports/repositorio-de-inventario.port';
import { exigirLibroEscribibleEnCada, type DependenciasDeInventario } from './movimientos';

/** Lo que el lote necesita de cada ítem, resuelto por nombre. */
interface ItemDelLote {
  readonly id: ItemId;
  readonly unidadDeUso: string;
  /** La tarifa del grupo del ítem; `null` si no tiene grupo o el grupo no define. */
  readonly ivaTarifaDelGrupo: string | null;
}

/** Lo que se lee UNA vez para todo el lote. */
interface ContextoDelLote {
  readonly locationId: LocationId;
  readonly items: ReadonlyMap<string, ItemDelLote>;
  readonly ivaRecuperable: boolean;
}

export class RegistrarMovimientosEnLote {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  public async ejecutar(
    sesion: SesionActiva,
    entrada: {
      readonly locationId: LocationId;
      readonly movimientos: readonly MovimientoDelLote[];
      /** De qué importación viene el lote (D-16.200). Es lo que la hace reversible. */
      readonly importJobId: ImportJobId;
    },
  ): Promise<number> {
    const problemas = problemasDelLoteDeMovimientos(entrada.movimientos);
    if (problemas.length > 0) throw new MovimientoDeLoteInvalidoError(problemas);

    await exigirLibroEscribibleEnCada({
      deps: this.deps,
      sesion,
      escrituras: entrada.movimientos.map((m) => ({
        locationId: entrada.locationId,
        ocurridoEn: m.occurredAt,
      })),
    });

    const contexto = await this.leerContexto(sesion, entrada.locationId);
    const preparados = preparar(entrada.movimientos, contexto);

    const ids = await this.deps.repositorio.registrarVarios({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimientos: preparados,
      importJobId: entrada.importJobId,
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

  /** Tres lecturas para todo el lote —ítems, grupos, ajuste—, no tres por fila. */
  private async leerContexto(sesion: SesionActiva, locationId: LocationId): Promise<ContextoDelLote> {
    const [items, grupos, ajustes] = await Promise.all([
      this.deps.listarItems.ejecutar(sesion, false),
      this.deps.listarGrupos.ejecutar(sesion),
      this.deps.leerAjustes.ejecutar(sesion),
    ]);
    const tarifaDeGrupo = new Map<string, string | null>(grupos.map((g) => [g.id, g.ivaTarifa]));

    return {
      locationId,
      ivaRecuperable: ajustes.ivaCompraRecuperable,
      items: new Map(
        items.map((i) => [
          clavePorNombre(i.nombre),
          {
            id: i.id,
            unidadDeUso: i.unidadDeUso,
            ivaTarifaDelGrupo: i.grupoId === null ? null : (tarifaDeGrupo.get(i.grupoId) ?? null),
          },
        ]),
      ),
    };
  }
}

/**
 * Traduce el lote entero y recoge TODOS los motivos por los que no se puede.
 *
 * @throws {MovimientoDeLoteInvalidoError}
 */
function preparar(
  movimientos: readonly MovimientoDelLote[],
  contexto: ContextoDelLote,
): readonly MovimientoParaGuardar[] {
  const problemas: ProblemaDelLote[] = [];
  const preparados: MovimientoParaGuardar[] = [];

  for (const [indice, movimiento] of movimientos.entries()) {
    const preparado = prepararUno(movimiento, contexto);
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
  contexto: ContextoDelLote,
): MovimientoParaGuardar | string {
  const motivo = motivoDelMovimiento(movimiento);
  if (motivo !== null) return motivo;

  const item = contexto.items.get(clavePorNombre(movimiento.item));
  if (item === undefined) return `No existe ningún ítem llamado «${movimiento.item.trim()}».`;

  const cantidad = conSignoDelTipo(
    movimiento.tipo,
    Quantity.of(movimiento.cantidad, unidadDeUso(item.unidadDeUso)),
  );
  const compra = compraDelLote(movimiento, item, contexto.ivaRecuperable);
  if (typeof compra === 'string') return compra;

  return {
    locationId: contexto.locationId,
    itemId: item.id,
    tipo: movimiento.tipo,
    cantidad: cantidad.toStorageString(),
    costoTotal: compra === null ? movimiento.costoTotal : compra.costoTotal,
    desglose: compra === null ? null : compra.desglose,
    purchaseArticleId: null,
    reversesMovementId: null,
    occurredAt: movimiento.occurredAt,
    note: movimiento.note,
  };
}

/**
 * El desglose de una COMPRA del lote, `null` si la fila no es compra, o el
 * motivo por el que no se puede. `motivoDelMovimiento` ya garantizó el importe.
 */
function compraDelLote(
  movimiento: MovimientoDelLote,
  item: ItemDelLote,
  ivaRecuperable: boolean,
): CompraDesglosada | string | null {
  if (movimiento.tipo !== 'COMPRA' || movimiento.costoTotal === null) return null;

  const tarifa = elegirTarifa({
    cuerpo: movimiento.ivaTarifa,
    articulo: null,
    grupo: item.ivaTarifaDelGrupo,
  });
  if (tarifa === null) {
    return `Falta la tarifa de IVA de esta compra: ponla en la columna «iva» del archivo o en el grupo de «${movimiento.item.trim()}». Nunca se asume una.`;
  }

  return desglosarCompra({
    bruto: movimiento.costoTotal,
    tarifa: exigirTarifaValida(tarifa),
    recuperable: ivaRecuperable,
  });
}

