/**
 * Lo que `analytics` necesita de la persistencia.
 *
 * **SOLO SUS DOS TABLAS.** Las ventas y los costos fijos son lo único que este
 * módulo escribe; todo lo demás —la carta costeada, el libro, el conteo, el
 * período— lo pide por los puertos de `costing`, `inventory` y `periods`. Un
 * `SELECT` sobre `inventory_movement` desde aquí sería un segundo sitio que
 * mantener en sincronía el día que cambie el signo de algo.
 *
 * **LAS DOS ESCRITURAS SON POR REEMPLAZO.** Es una grilla del mes, no un alta
 * a alta: lo que el usuario ve al guardar es exactamente lo que queda. El
 * `GRANT` de la migración concede `DELETE` y **no** `UPDATE`, para que no exista
 * la forma de dejar media grilla del mes pasado mezclada con la de este.
 */

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

export interface RepositorioDeAnalitica {
  ventasDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly VentaLeida[]>;

  reemplazarVentas(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly ventas: readonly VentaLeida[];
  }): Promise<void>;

  costosDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<readonly CostoLeido[]>;

  reemplazarCostos(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly costos: readonly CostoLeido[];
  }): Promise<void>;
}
