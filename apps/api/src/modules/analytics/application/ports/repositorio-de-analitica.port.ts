/**
 * Lo que `analytics` necesita de la persistencia.
 *
 * **SUS DOS TABLAS, Y UNA COLUMNA DE UNA TERCERA.** Las ventas y los costos fijos
 * son lo único que este módulo escribe, más `period.version` (D-16.121): la
 * versión de la carga del mes tiene que subir en la MISMA transacción que la
 * reemplaza, o entre las dos sentencias cabe otra carga. `periods` no la toca; todo lo demás —la carta costeada, el libro, el conteo, el
 * período— lo pide por los puertos de `costing`, `inventory` y `periods`. Un
 * `SELECT` sobre `inventory_movement` desde aquí sería un segundo sitio que
 * mantener en sincronía el día que cambie el signo de algo.
 *
 * **LAS DOS ESCRITURAS SON POR REEMPLAZO.** Es una grilla del mes, no un alta
 * a alta: lo que el usuario ve al guardar es exactamente lo que queda. El
 * `GRANT` de la migración concede `DELETE` y **no** `UPDATE`, para que no exista
 * la forma de dejar media grilla del mes pasado mezclada con la de este.
 */

import type { DesenlaceVersionado } from '../../../../shared/application/concurrencia';
import type {
  CompanyId,
  PeriodId,
  ProductId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { ClasificacionDeCosto } from '../../domain/punto-de-equilibrio';

export const REPOSITORIO_DE_ANALITICA = 'REPOSITORIO_DE_ANALITICA';

export interface VentaLeida {
  readonly productId: ProductId;
  readonly unidades: string;
}

export interface CostoLeido {
  readonly concepto: string;
  readonly clasificacion: ClasificacionDeCosto;
  readonly importe: string;
}

/** Lo común a las dos cargas del mes. */
export interface CargaVersionada {
  readonly companyId: CompanyId;
  readonly periodId: PeriodId;
  readonly userId: UserId;
  /** La que se leyó con la carga (D-16.122: `1` si el mes no tenía fila). */
  readonly versionEsperada: number;
}

export interface RepositorioDeAnalitica {
  ventasDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly VentaLeida[]>;

  /**
   * Reemplaza las ventas del mes **solo si la versión del período sigue siendo la
   * esperada**, y la sube en la misma transacción (D-16.121, ADR-023).
   */
  reemplazarVentas(entrada: CargaVersionada & { readonly ventas: readonly VentaLeida[] }): Promise<DesenlaceVersionado>;

  costosDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly CostoLeido[]>;

  /** Lo mismo para los costos fijos, con el MISMO testigo: la carga del mes. */
  reemplazarCostos(entrada: CargaVersionada & { readonly costos: readonly CostoLeido[] }): Promise<DesenlaceVersionado>;
}
