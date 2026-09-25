/**
 * Las tres lecturas de precios, empaquetadas como una dependencia.
 *
 * Misma razón que `ResolucionYCosto`: el límite son tres parámetros por
 * constructor (CLAUDE.md §3). Y en su propio archivo por la razón de P1:
 * `emitDecoratorMetadata` evalúa los tipos del constructor al definir la clase
 * decorada, así que una clase declarada después en el mismo archivo revienta al
 * arrancar.
 */

import { CostosDeItems } from '../../application/casos-de-uso/costos-de-items';
import { PreciosPendientes } from '../../application/casos-de-uso/pendientes';
import { HistorialDePrecios } from '../../application/casos-de-uso/precios';

export class LecturasDePrecios {
  public constructor(
    public readonly historial: HistorialDePrecios,
    public readonly pendientes: PreciosPendientes,
    public readonly costos: CostosDeItems,
  ) {}
}
