/**
 * La transferencia entre ubicaciones — R2, criterio de aceptación de P6.
 *
 * ES UN PAR DE MOVIMIENTOS QUE SUMA CERO, y esa propiedad es la que sostiene el
 * criterio: «una transferencia deja el total de la company intacto y cambia los
 * saldos de las dos ubicaciones». No hace falta comprobarlo con una consulta ni
 * confiar en que nadie escriba mal la salida: la entrada se construye como la
 * negación de la salida, aquí, en una línea.
 *
 * LAS DOS MITADES SE ESCRIBEN JUNTAS O NO SE ESCRIBE NINGUNA. La atomicidad la
 * da la transacción del caso de uso; lo que esta función garantiza es que no
 * exista una forma de pedir media transferencia. Por eso los dos movimientos
 * salen de una sola llamada y `TRANSFERENCIA_SALIDA` / `TRANSFERENCIA_ENTRADA`
 * no están entre los tipos que se pueden registrar sueltos.
 *
 * NO CRUZA COMPANIES. Ni siquiera hace falta comprobarlo aquí: las dos
 * ubicaciones vienen de la misma sesión y RLS filtra por `company_id` en las
 * dos filas. Lo que sí se comprueba es que no cruce hacia sí misma.
 */

import type { Quantity } from '../../../shared/domain/money/tipos-monetarios';
import type { ItemId, LocationId } from '../../../shared/domain/identity/identificadores';
import { conSignoDelTipo, type MovimientoDelLibro } from './movimiento';
import { TransferenciaSinDestinoError } from './errores';

export interface DatosDeTransferencia {
  readonly origen: LocationId;
  readonly destino: LocationId;
  readonly itemId: ItemId;
  /** Magnitud positiva: el sentido lo pone el par, no quien la escribe. */
  readonly cantidad: Quantity;
  readonly ocurridoEn: Date;
}

/** Salida primero, entrada después. El orden es el del relato, no importa al saldo. */
export type ParDeTransferencia = readonly [MovimientoDelLibro, MovimientoDelLibro];

/**
 * @throws {TransferenciaSinDestinoError} transferir a la misma ubicación no
 *   mueve nada y deja dos filas que solo sirven para confundir un arqueo.
 * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
 */
export function construirTransferencia(datos: DatosDeTransferencia): ParDeTransferencia {
  if (datos.origen === datos.destino) throw new TransferenciaSinDestinoError();

  const sale = conSignoDelTipo('TRANSFERENCIA_SALIDA', datos.cantidad);

  return [
    {
      locationId: datos.origen,
      itemId: datos.itemId,
      tipo: 'TRANSFERENCIA_SALIDA',
      cantidad: sale,
      ocurridoEn: datos.ocurridoEn,
    },
    {
      locationId: datos.destino,
      itemId: datos.itemId,
      tipo: 'TRANSFERENCIA_ENTRADA',
      // LA ENTRADA ES LA NEGACIÓN DE LA SALIDA. Escrita así, el par suma cero
      // por construcción y no por una comprobación que alguien pueda quitar.
      cantidad: sale.negated(),
      ocurridoEn: datos.ocurridoEn,
    },
  ];
}
