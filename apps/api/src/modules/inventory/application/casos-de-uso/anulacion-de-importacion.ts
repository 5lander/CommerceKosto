/**
 * Deshacer, en el libro, lo que escribió una importación — D-16.200.
 *
 * **NO BORRA NI UNA FILA, Y ESO NO ES UNA LIMITACIÓN: ES R3.** Por cada
 * movimiento que trajo el archivo se escribe uno de signo contrario, igual que
 * la corrección de uno suelto, y las dos filas quedan a la vista. Lo que cambia
 * respecto de corregir de a una es el alcance —el lote entero— y la atomicidad:
 * **una sola transacción**, porque media importación deshecha deja un saldo que
 * no es ni el de antes ni el de después y nadie sabría cuál de los dos quería.
 *
 * **EL MES CERRADO SIGUE MANDANDO.** La fila contraria conserva la fecha de la
 * original (si no, el mes de la corrección no sería el del error), así que
 * anular una importación que cayó en un mes ya cerrado se detiene con su motivo
 * — no se abre un portillo por venir de un archivo. Para arreglarlo hay que
 * reabrir el mes, que es una decisión con dueño.
 *
 * **VOLVER A LANZARLA ES SEGURO.** Lo ya corregido se salta. Entre escribir las
 * filas contrarias y marcar la importación como `ANULADA` hay dos transacciones
 * que no se pueden juntar (lo explica el puerto de `imports`), y si se cae en
 * medio, el operador repite: se anula lo que faltaba y el estado queda puesto.
 */

import type { ImportJobId } from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { ItemDelLibroNoEncontradoError } from '../../domain/errores';
import type { MovimientoLeido } from '../ports/repositorio-de-inventario.port';
import {
  anulacionDe,
  exigirLibroEscribibleEnCada,
  registrarEvento,
  type DependenciasDeInventario,
} from './movimientos';

export interface DatosDeAnulacion {
  readonly importJobId: ImportJobId;
  /** Por qué se deshace. Viaja a la nota de cada fila contraria. */
  readonly note: string | null;
}

export class AnularMovimientosDeImportacion {
  public constructor(private readonly deps: DependenciasDeInventario) {}

  /**
   * @returns cuántas filas contrarias se escribieron. Cero significa que no
   *   quedaba nada por deshacer, no que algo fallara.
   * @throws {UbicacionFueraDeAlcanceError} @throws {PeriodoCerradoError}
   * @throws {ItemDelLibroNoEncontradoError}
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeAnulacion): Promise<number> {
    const traidos = await this.deps.repositorio.movimientosDeImportacion({
      companyId: sesion.companyId,
      importJobId: datos.importJobId,
    });

    const pendientes = traidos.filter((movimiento) => movimiento.corregidoPor === null);
    if (pendientes.length === 0) return 0;

    await exigirLibroEscribibleEnCada({
      deps: this.deps,
      sesion,
      escrituras: pendientes.map((m) => ({ locationId: m.locationId, ocurridoEn: m.occurredAt })),
    });

    const contrarios = await this.contrarios(sesion, pendientes, datos.note);

    const ids = await this.deps.repositorio.registrarVarios({
      companyId: sesion.companyId,
      userId: sesion.userId,
      movimientos: contrarios,
      // LAS FILAS CONTRARIAS NO LLEVAN LA IMPORTACIÓN. Si la llevaran, la
      // siguiente lectura de «lo que trajo este archivo» devolvería también lo
      // que lo deshizo, y una segunda anulación intentaría anular la primera.
      importJobId: null,
    });

    // UN EVENTO POR ANULACIÓN, NO UNO POR FILA — la misma razón que en P10:
    // quinientas correcciones seguidas esconden la acción en vez de contarla.
    await registrarEvento({
      deps: this.deps,
      sesion,
      eventType: 'inventory.import.voided',
      detail: { importJobId: datos.importJobId, filas: String(ids.length) },
    });

    return ids.length;
  }

  /**
   * La unidad de cada ítem sale de UNA lectura del catálogo, no de una por
   * fila: sin ella no se puede reconstruir la cantidad con su unidad, y un
   * archivo de quinientas compras toca pocos ítems distintos.
   *
   * @throws {ItemDelLibroNoEncontradoError}
   */
  private async contrarios(
    sesion: SesionActiva,
    pendientes: readonly MovimientoLeido[],
    note: string | null,
  ) {
    // `false` = TODOS, incluidos los archivados. Un insumo que se archivó
    // después de la importación sigue teniendo sus filas en el libro, y no
    // poder deshacerlas por eso sería castigar al que ordenó su catálogo.
    const items = await this.deps.listarItems.ejecutar(sesion, false);
    const unidadPorItem = new Map(items.map((item) => [item.id, item.unidadDeUso]));

    return pendientes.map((movimiento) => {
      const unidad = unidadPorItem.get(movimiento.itemId);
      if (unidad === undefined) throw new ItemDelLibroNoEncontradoError();
      return anulacionDe(movimiento, unidad, note);
    });
  }
}
