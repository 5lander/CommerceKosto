/**
 * Un LOTE de movimientos del libro.
 *
 * **EL LIBRO ES APPEND-ONLY (R3), Y ESO CAMBIA LO QUE UNA VALIDACIÓN SIGNIFICA
 * AQUÍ.** En el catálogo, una fila mala se corrige editándola. En el libro no:
 * una vez dentro, solo se arregla con otro movimiento de signo contrario, que
 * queda para siempre en el histórico. Por eso el lote se revisa entero antes de
 * escribir nada, y por eso una compra sin importe se rechaza en vez de entrar
 * con un hueco.
 *
 * ES DOMINIO PURO.
 */

import { motivoDeTarifaInvalida } from '../../../shared/domain/iva/tarifa';
import {
  PRIMERA_POSICION,
  type ProblemaDelLote,
} from '../../../shared/domain/lote/problemas';
import type { TipoDeMovimiento } from './movimiento';

const DECIMAL = /^\d+(?:\.\d+)?$/u;

const ES_CERO = /^0+(?:\.0+)?$/u;

const TIPO_COMPRA = 'COMPRA';

export interface MovimientoDelLote {
  /** El NOMBRE del ítem: es lo que trae un archivo. */
  readonly item: string;
  readonly tipo: TipoDeMovimiento;
  /** Magnitud, sin signo. El signo lo pone `conSignoDelTipo` (ADR-009). */
  readonly cantidad: string;
  readonly costoTotal: string | null;
  /** La tarifa de IVA de la fila (D-16.44). `null` = manda la del grupo del ítem. */
  readonly ivaTarifa: string | null;
  readonly occurredAt: Date;
  readonly note: string | null;
}

export function problemasDelLoteDeMovimientos(
  movimientos: readonly MovimientoDelLote[],
): readonly ProblemaDelLote[] {
  const problemas: ProblemaDelLote[] = [];

  for (const [indice, movimiento] of movimientos.entries()) {
    const motivo = motivoDelMovimiento(movimiento);
    if (motivo !== null) problemas.push({ posicion: indice + PRIMERA_POSICION, motivo });
  }

  return problemas;
}

/**
 * **NO SE COMPRUEBAN REPETIDOS, y es deliberado.** Comprar dos veces el mismo
 * ítem el mismo día es lo normal: son dos facturas. El libro no tiene índice
 * único que lo impida porque no debe tenerlo — a diferencia del catálogo, donde
 * dos filas con el mismo nombre son un error de captura.
 */
export function motivoDelMovimiento(movimiento: MovimientoDelLote): string | null {
  if (movimiento.item.trim().length === 0) return 'La fila no dice de qué ítem es el movimiento.';

  if (!DECIMAL.test(movimiento.cantidad)) {
    return `La cantidad «${movimiento.cantidad}» no es un número sin signo.`;
  }
  if (ES_CERO.test(movimiento.cantidad)) {
    return 'Un movimiento de cantidad cero no mueve nada: sobra.';
  }

  return motivoDelImporte(movimiento);
}

/** El importe y la tarifa de la fila, que solo una COMPRA necesita de verdad. */
function motivoDelImporte(movimiento: MovimientoDelLote): string | null {
  if (movimiento.costoTotal !== null && !DECIMAL.test(movimiento.costoTotal)) {
    return `El importe «${movimiento.costoTotal}» no es un número.`;
  }

  // La tarifa se rechaza AQUÍ, con su fila, y no en el caso de uso: un 15
  // donde va 0.15 tiene que salir en el análisis como cualquier otro problema
  // del archivo (D-16.44), no como un 400 suelto sin número de fila.
  const tarifa = movimiento.ivaTarifa === null ? null : motivoDeTarifaInvalida(movimiento.ivaTarifa);
  if (tarifa !== null) return tarifa;

  // Una compra sin importe deja un agujero en `compras_del_mes`, y con él el
  // food cost real de SPEC §16 sale más bajo de lo que es — sin que nada avise,
  // porque el saldo de unidades sí cuadra.
  if (movimiento.tipo === TIPO_COMPRA && movimiento.costoTotal === null) {
    return 'Una compra necesita su importe: sin él, el food cost real del mes sale más bajo de lo que es.';
  }

  return null;
}
