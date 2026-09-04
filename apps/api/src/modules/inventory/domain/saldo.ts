/**
 * El saldo como PROYECCIÓN del libro — R3, criterio de aceptación de P6.
 *
 * NO EXISTE UN CAMPO `stock`. El saldo de un ítem en una ubicación es la suma
 * de sus movimientos, y nada más. Un campo mutable sería un segundo número que
 * puede discrepar del libro, y cuando discrepara nadie sabría cuál de los dos
 * es el bueno — mientras que un libro append-only siempre puede decir por qué
 * el saldo es el que es.
 *
 * ESTA FUNCIÓN ES LA RECONSTRUCCIÓN, no la consulta de producción. En caliente,
 * el saldo lo calcula PostgreSQL con un `SUM` agrupado, que es lo único que
 * aguanta 500 ítems en 300 ms (CLAUDE.md §5). Esto de aquí recorre los
 * movimientos uno a uno, en TypeScript, con la base apagada. Que las dos vías
 * den exactamente el mismo número es lo que exige el criterio de aceptación, y
 * tiene su prueba de integración: si el `SUM` de la consulta y este pliegue
 * discrepan, uno de los dos está mal y da igual cuál.
 *
 * EL ORDEN NO IMPORTA. La suma decimal es exacta y asociativa —no hay
 * redondeo—, así que el saldo no depende de en qué orden lleguen los
 * movimientos. La prueba lo fija barajándolos.
 */

import { Quantity } from '../../../shared/domain/money/tipos-monetarios';
import type { UnidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';
import type { ItemId, LocationId } from '../../../shared/domain/identity/identificadores';
import type { MovimientoDelLibro } from './movimiento';

export interface SaldoDeItem {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly cantidad: Quantity;
}

/**
 * El separador de la clave de agrupamiento.
 *
 * Es el carácter nulo, que no puede aparecer dentro de un UUID. Concatenar con
 * un guion dejaría que dos pares distintos produjeran la misma clave el día que
 * un identificador dejara de ser un UUID.
 */
const SEPARADOR = '\u0000';

function claveDe(movimiento: MovimientoDelLibro): string {
  return `${movimiento.locationId}${SEPARADOR}${movimiento.itemId}`;
}

interface Acumulado {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  cantidad: Quantity;
}

/**
 * Pliega los movimientos en un saldo por (ubicación, ítem).
 *
 * Un par cuyos movimientos se cancelan aparece con saldo CERO, y no se omite:
 * «hubo movimiento y quedó en nada» y «nunca hubo nada» son estados distintos,
 * y quien lee un inventario necesita distinguirlos.
 *
 * @throws {UnidadIncompatibleError} si dos movimientos del mismo ítem traen
 *   unidades distintas — lo que solo puede pasar si algo corrompió los datos,
 *   porque la unidad de uso de un ítem es inmutable desde P2.
 */
export function proyectarSaldos(movimientos: readonly MovimientoDelLibro[]): readonly SaldoDeItem[] {
  const porPar = new Map<string, Acumulado>();

  for (const movimiento of movimientos) {
    const clave = claveDe(movimiento);
    const acumulado = porPar.get(clave);

    if (acumulado === undefined) {
      porPar.set(clave, {
        locationId: movimiento.locationId,
        itemId: movimiento.itemId,
        cantidad: movimiento.cantidad,
      });
      continue;
    }

    acumulado.cantidad = acumulado.cantidad.plus(movimiento.cantidad);
  }

  return [...porPar.values()];
}

/**
 * El saldo de UN ítem en UNA ubicación.
 *
 * Necesita la unidad porque un ítem sin ningún movimiento tiene saldo cero, y
 * un cero sin unidad no se puede sumar a nada después.
 */
export function proyectarSaldoDe(
  movimientos: readonly MovimientoDelLibro[],
  unidad: UnidadDeUso,
): Quantity {
  return Quantity.sum(
    movimientos.map((movimiento) => movimiento.cantidad),
    unidad,
  );
}
