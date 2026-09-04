/**
 * Lo que `periods` necesita de la persistencia.
 *
 * **`hayCerradoQueContiene` ES EL MÉTODO CALIENTE.** Lo llama toda escritura
 * del libro de inventario, así que es una consulta por movimiento registrado.
 * Va sobre un índice parcial `(company_id, location_id, starts_at) WHERE status
 * = 'CERRADO'`, y la tabla tiene doce filas por ubicación y año: el coste es el
 * de leer una hoja de índice.
 *
 * **`asegurar` INSERTA SI FALTA Y NO PISA NADA.** Un mes sin fila está abierto
 * (ver `domain/cierre.ts`), así que la fila se crea cuando alguien se ocupa de
 * ese mes por primera vez: al abrir un conteo o al cerrarlo. Dos peticiones
 * simultáneas para el mismo mes no pueden crear dos filas — lo impide el índice
 * único de `(company_id, location_id, year, month)`.
 */

import type {
  CompanyId,
  LocationId,
  PeriodId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { EstadoDePeriodo } from '../../domain/cierre';

export const REPOSITORIO_DE_PERIODOS = 'REPOSITORIO_DE_PERIODOS';

export interface PeriodoLeido {
  readonly id: PeriodId;
  readonly locationId: LocationId;
  readonly anio: number;
  readonly mes: number;
  /** La frontera tal como se resolvió al abrirlo. Ver `domain/periodo.ts`. */
  readonly inicioEn: Date;
  readonly finEn: Date;
  readonly estado: EstadoDePeriodo;
  readonly cerradoEn: Date | null;
  readonly cerradoPor: UserId | null;
  readonly reabiertoEn: Date | null;
  readonly reabiertoPor: UserId | null;
}

export interface RepositorioDePeriodos {
  /** Crea la fila del mes si no existía, y devuelve la que quede. */
  asegurar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly anio: number;
    readonly mes: number;
    readonly inicioEn: Date;
    readonly finEn: Date;
  }): Promise<PeriodoLeido>;

  /** El mes de una ubicacion, si alguien ya se ocupo de el. Lectura pura. */
  buscar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly anio: number;
    readonly mes: number;
  }): Promise<PeriodoLeido | null>;

  buscarPorId(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<PeriodoLeido | null>;

  listar(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly PeriodoLeido[]>;

  /** El período cerrado que cubre ese instante, si lo hay. Ver arriba. */
  hayCerradoQueContiene(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly instante: Date;
  }): Promise<PeriodoLeido | null>;

  cambiarEstado(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly estado: EstadoDePeriodo;
    readonly ahora: Date;
  }): Promise<void>;
}
