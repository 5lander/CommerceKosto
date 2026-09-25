/**
 * Deshacer una importación COMO IMPORTACIÓN — D-16.200.
 *
 * **POR QUÉ EXISTE.** Un archivo de movimientos mal armado —el mes cambiado, la
 * cantidad en la unidad que no era, el archivo de la otra sucursal— dejaba
 * cientos de filas en un libro que no se edita (R3). Deshacerlo era corregir
 * movimiento por movimiento desde la pantalla, sabiendo cuáles eran; y si
 * alguien se saltaba uno, el saldo quedaba mal para siempre sin que nada
 * avisara. Aquí se deshace el lote entero, o no se deshace nada.
 *
 * **ESTE CASO DE USO NO TOCA EL LIBRO.** Igual que importar, decide y delega:
 * las filas contrarias las escribe `inventory`, que es quien tiene las reglas
 * del libro —el mes cerrado, el signo, la atomicidad—. Lo que sí es suyo es el
 * estado de la importación y el orden de los dos pasos.
 *
 * **EL ORDEN IMPORTA Y ES ESTE: PRIMERO EL LIBRO, DESPUÉS EL ESTADO.** Al
 * revés, una caída en medio dejaría una importación marcada `ANULADA` cuyas
 * filas siguen sumando en el saldo, que es la mentira peor de las dos. Así, lo
 * que puede quedar es una importación `CONFIRMADA` sin efecto en el saldo —se
 * ve al mirar el libro— y volver a lanzar la anulación la termina.
 *
 * **SOLO SE ANULA LO QUE ESCRIBIÓ EN EL LIBRO.** Deshacer una importación de
 * ítems o de recetas no es «escribir la fila contraria»: es borrar catálogo del
 * que ya pueden colgar recetas, precios y movimientos. Eso no se hace en un
 * endpoint; se mira caso por caso. Por eso aquí solo entra `MOVIMIENTOS`, y el
 * resto recibe un 409 que lo dice.
 */

import type { ImportJobId } from '../../../../shared/domain/identity/identificadores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { AnularMovimientosDeImportacion } from '../../../inventory/application/casos-de-uso/anulacion-de-importacion';
import { ImportacionNoAnulableError, ImportacionNoEncontradaError } from '../../domain/errores';
import type {
  ImportacionParaAnular,
  RepositorioDeImportaciones,
} from '../ports/repositorio-de-importaciones.port';

/** El único tipo cuyo efecto es reversible escribiendo, no borrando. */
const MOVIMIENTOS = 'MOVIMIENTOS';
const CONFIRMADA = 'CONFIRMADA';
const ANULADA = 'ANULADA';

export interface DependenciasDeAnulacion {
  readonly repositorio: RepositorioDeImportaciones;
  readonly anularEnElLibro: AnularMovimientosDeImportacion;
}

export interface ResultadoDeAnulacion {
  readonly id: ImportJobId;
  /** Cuántas filas contrarias se escribieron. Cero: no quedaba nada por deshacer. */
  readonly filasAnuladas: number;
}

export class AnularImportacion {
  public constructor(private readonly deps: DependenciasDeAnulacion) {}

  /**
   * @throws {ImportacionNoEncontradaError} @throws {ImportacionNoAnulableError}
   * @throws {PeriodoCerradoError} si alguna de sus filas cayó en un mes cerrado
   */
  public async ejecutar(
    sesion: SesionActiva,
    datos: { readonly importJobId: ImportJobId; readonly note: string | null },
  ): Promise<ResultadoDeAnulacion> {
    const importacion = await this.deps.repositorio.buscarParaAnular({
      companyId: sesion.companyId,
      id: datos.importJobId,
    });
    if (importacion === null) throw new ImportacionNoEncontradaError();
    exigirAnulable(importacion);

    const filasAnuladas = await this.deps.anularEnElLibro.ejecutar(sesion, {
      importJobId: importacion.id,
      note: datos.note,
    });

    await this.deps.repositorio.marcarAnulada({
      companyId: sesion.companyId,
      id: importacion.id,
      userId: sesion.userId,
    });

    return { id: importacion.id, filasAnuladas };
  }
}

/**
 * Las tres razones por las que no se puede, cada una con su frase.
 *
 * **LA DE `ANULADA` ES UN 409 Y NO UN ÉXITO SILENCIOSO**: pulsar dos veces
 * «anular» tiene que decir que ya estaba hecho. El reintento que sí sigue
 * adelante es el de una `CONFIRMADA` a la que le falten filas por corregir —una
 * caída entre los dos pasos—, y ese no llega hasta aquí.
 *
 * @throws {ImportacionNoAnulableError}
 */
function exigirAnulable(importacion: ImportacionParaAnular): void {
  if (importacion.estado === ANULADA) {
    throw new ImportacionNoAnulableError('ya se anuló.');
  }
  if (importacion.estado !== CONFIRMADA) {
    throw new ImportacionNoAnulableError(
      'no llegó a confirmarse, así que no escribió nada en el libro.',
    );
  }
  if (importacion.tipo !== MOVIMIENTOS) {
    throw new ImportacionNoAnulableError(
      `es de ${importacion.tipo.toLowerCase()}, y eso no se deshace escribiendo. ` +
        'Solo las importaciones de movimientos se anulan desde aquí.',
    );
  }
}
