/**
 * Lo que el conteo físico necesita de la persistencia.
 *
 * **PUERTO APARTE DEL LIBRO, Y NO POR TAMAÑO.** El libro es append-only y su
 * puerto no tiene `actualizar` ni `borrar` — la ausencia *es* el contrato de
 * R3. El conteo sí se edita mientras es borrador, así que su puerto tiene
 * `reemplazarLineas`. Mezclarlos pondría un método de edición en la misma
 * interfaz cuya seña de identidad es no tenerlo, y el día que alguien buscara
 * «¿se puede editar algo de inventario?» encontraría que sí.
 *
 * **`confirmar` ESCRIBE TODO DE UNA VEZ**: la cabecera con sus tres valores y
 * las líneas con su teórico y su costo congelados. Es una sola transacción
 * porque un conteo confirmado a medias —cabecera sí, líneas no— sería un
 * inventario final que nadie podría reconstruir.
 */

import type {
  CompanyId,
  ItemId,
  LocationId,
  PeriodId,
  PhysicalCountId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { EstadoDeConteo } from '../../domain/conteo';

export const REPOSITORIO_DE_CONTEOS = 'REPOSITORIO_DE_CONTEOS';

export interface ConteoLeido {
  readonly id: PhysicalCountId;
  readonly periodId: PeriodId;
  readonly locationId: LocationId;
  readonly anio: number;
  readonly mes: number;
  readonly estado: EstadoDeConteo;
  /** El corte: `period.ends_at` congelado al crear el conteo. */
  readonly corteEn: Date;
  /** Congelados al confirmar; `null` mientras sea borrador. */
  readonly valorTeorico: string | null;
  readonly valorCubierto: string | null;
  readonly valorFisico: string | null;
  readonly creadoEn: Date;
  readonly confirmadoEn: Date | null;
  readonly note: string | null;
}

/**
 * Una línea tal como está guardada.
 *
 * `cantidad === null` es **«sin verificar»**, y no es lo mismo que cero (D7).
 * `teorico` y `costoUnitario` solo existen tras confirmar.
 */
export interface LineaLeida {
  readonly itemId: ItemId;
  readonly cantidad: string | null;
  readonly teorico: string | null;
  readonly costoUnitario: string | null;
}

export interface LineaParaGuardar {
  readonly itemId: ItemId;
  readonly cantidad: string;
}

/** Una línea ya congelada, tal como queda al confirmar. */
export interface LineaCongelada {
  readonly itemId: ItemId;
  readonly cantidad: string | null;
  readonly teorico: string;
  readonly costoUnitario: string;
}

export interface DatosDeConfirmacion {
  readonly companyId: CompanyId;
  readonly countId: PhysicalCountId;
  readonly periodId: PeriodId;
  readonly userId: UserId;
  readonly ahora: Date;
  readonly valorTeorico: string;
  readonly valorCubierto: string;
  readonly valorFisico: string;
  readonly lineas: readonly LineaCongelada[];
}

export interface RepositorioDeConteos {
  crear(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
    readonly userId: UserId;
    readonly corteEn: Date;
    readonly note: string | null;
  }): Promise<PhysicalCountId>;

  buscar(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
  }): Promise<ConteoLeido | null>;

  listarPorUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly ConteoLeido[]>;

  /** El conteo CONFIRMADO de un período, si lo hay. Solo puede haber uno. */
  confirmadoDe(entrada: {
    readonly companyId: CompanyId;
    readonly periodId: PeriodId;
  }): Promise<ConteoLeido | null>;

  lineas(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
  }): Promise<readonly LineaLeida[]>;

  /** Reescribe la hoja entera. Solo tiene sentido mientras sea borrador. */
  reemplazarLineas(entrada: {
    readonly companyId: CompanyId;
    readonly countId: PhysicalCountId;
    readonly lineas: readonly LineaParaGuardar[];
  }): Promise<void>;

  confirmar(datos: DatosDeConfirmacion): Promise<void>;
}
