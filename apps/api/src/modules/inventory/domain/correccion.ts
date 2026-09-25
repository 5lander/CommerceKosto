/**
 * La corrección — R3: «un error se corrige con un movimiento de signo
 * contrario, nunca editando el original».
 *
 * LA CORRECCIÓN ES DEL MISMO TIPO QUE EL ORIGINAL, y esa es la parte que costó
 * decidir. La alternativa cómoda era corregir todo con un `AJUSTE`, que es
 * bidireccional y no pelea con la regla de signos. Pero rompe las agregaciones
 * por tipo: `compras_del_mes = Σ(movimientos tipo COMPRA)` (SPEC §16) seguiría
 * contando una compra que se anuló, porque su corrección sería de otro tipo.
 * El mes cerraría con compras que nadie hizo.
 *
 * Corrigiendo con el mismo tipo, **la cantidad** de todo agregado filtrado por
 * tipo se cancela sola: lleva signo, y el de la corrección es el contrario.
 *
 * **EL DINERO NO, Y ESO COSTÓ UN FALLO (INC-029).** `total_cost` es una
 * magnitud SIN signo (ADR-009 §2), así que `SUM(total_cost)` suma la compra y
 * su corrección en vez de cancelarlas: `compras_del_mes` (SPEC §16) salía
 * inflada por el doble de lo corregido, y esa cifra entra en el food cost real.
 * Lo que esta cabecera prometía —«ninguna consulta futura tiene que acordarse
 * de restar las correcciones»— vale para la cantidad y no para el importe. Las
 * tres agregaciones de dinero las restan, y lo dicen donde lo hacen.
 *
 * EL PRECIO ES UNA EXCEPCIÓN A LA REGLA DE SIGNOS, y está acotada: la
 * corrección de una `COMPRA` es una `COMPRA` negativa, que la regla de dirección
 * prohibiría. La excepción vale porque la regla de signos protege la CAPTURA
 * —que nadie escriba una merma al revés— y una corrección no es captura: su
 * cantidad no la escribe nadie, se deriva del movimiento que anula. En la base,
 * el `CHECK` se salta la comprobación exactamente cuando `reverses_movement_id`
 * no es nulo, y no en ningún otro caso.
 */

import type { MovimientoDelLibro } from './movimiento';
import { CorreccionDeCorreccionError } from './errores';

/** Un movimiento ya guardado, con lo que hace falta para poder anularlo. */
export interface MovimientoRegistrado extends MovimientoDelLibro {
  /** No nulo si este movimiento ya es la corrección de otro. */
  readonly corrigeA: string | null;
}

/**
 * Construye el movimiento que anula a `original`.
 *
 * La fecha es la del ORIGINAL, no la de hoy. Corregir es decir «esto que
 * registré del día 3 no pasó», y ponerle fecha de hoy dejaría el saldo del día
 * 3 mal para siempre — que es justo el número que alguien va a consultar cuando
 * cierre ese mes.
 *
 * @throws {CorreccionDeCorreccionError} corregir una corrección es editar con
 *   otro nombre: encadenarlas hace imposible saber cuál es el hecho.
 */
export function corregir(original: MovimientoRegistrado): MovimientoDelLibro {
  if (original.corrigeA !== null) throw new CorreccionDeCorreccionError();

  return {
    locationId: original.locationId,
    itemId: original.itemId,
    tipo: original.tipo,
    cantidad: original.cantidad.negated(),
    ocurridoEn: original.ocurridoEn,
  };
}
