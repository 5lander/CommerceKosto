/**
 * Lo que `inventory` necesita de la persistencia.
 *
 * NO HAY `actualizar` NI `borrar`, y la ausencia es el contrato. R3: el libro
 * es append-only. La única forma de deshacer algo es `registrar` una fila más,
 * y por eso `corregir` aparece aquí como una escritura y no como una edición.
 *
 * `saldos` DEVUELVE UNA AGREGACIÓN, NO LOS MOVIMIENTOS. El saldo se calcula con
 * un `SUM` agrupado en PostgreSQL porque es lo único que aguanta 500 ítems en
 * los 300 ms de CLAUDE.md §5; traerse el libro entero para sumarlo en
 * TypeScript sería traerse cien mil filas. La versión que sí pliega movimiento
 * a movimiento vive en `domain/saldo.ts`, corre con la base apagada, y hay una
 * prueba de integración que exige que las dos den el mismo número.
 */

import type {
  CompanyId,
  ItemId,
  LocationId,
  MovementId,
  ProductionId,
  PurchaseArticleId,
  TransferId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { TipoDeMovimiento } from '../../domain/movimiento';

export const REPOSITORIO_DE_INVENTARIO = 'REPOSITORIO_DE_INVENTARIO';

/**
 * Un movimiento listo para escribirse.
 *
 * Los decimales viajan como cadena de punta a punta: convertirlos a `number`
 * para pasarlos al driver es exactamente lo que CLAUDE.md §8 prohíbe.
 */
export interface MovimientoParaGuardar {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly tipo: TipoDeMovimiento;
  /** CON SIGNO, ya resuelto por el dominio. */
  readonly cantidad: string;
  /** Magnitud, sin signo. `null` donde el tipo no lo exige. */
  readonly costoTotal: string | null;
  readonly purchaseArticleId: PurchaseArticleId | null;
  readonly reversesMovementId: MovementId | null;
  readonly occurredAt: Date;
  readonly note: string | null;
}

export interface MovimientoLeido {
  readonly id: MovementId;
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly tipo: TipoDeMovimiento;
  readonly cantidad: string;
  readonly costoTotal: string | null;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly transferId: TransferId | null;
  readonly productionId: ProductionId | null;
  /** No nulo si este movimiento ES la corrección de otro. */
  readonly corrigeA: MovementId | null;
  /** No nulo si este movimiento YA FUE corregido por otro. */
  readonly corregidoPor: MovementId | null;
  readonly note: string | null;
}

/**
 * El saldo tal como sale del libro: sin nombre y sin unidad.
 *
 * NO LOS TRAE, Y NO ES UNA OMISIÓN. `item` es tabla de `catalog`, que es la
 * fuente única de verdad (CLAUDE.md §2), y la regla
 * `tablas-de-catalogo-solo-en-catalog` de `audit:forbidden` impide leerla desde
 * aquí. Quien compone el nombre es el caso de uso, a través del puerto de
 * `catalog` — una consulta más, no una por ítem.
 */
export interface SaldoLeido {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  /** La suma con signo de todos los movimientos del par. */
  readonly cantidad: string;
}

export interface DatosDeTransferenciaRegistrada {
  readonly companyId: CompanyId;
  readonly userId: UserId;
  readonly fromLocationId: LocationId;
  readonly toLocationId: LocationId;
  readonly occurredAt: Date;
  readonly note: string | null;
  /** El par que construyó el dominio. Se escribe junto con la cabecera. */
  readonly movimientos: readonly MovimientoParaGuardar[];
}

export interface DatosDeProduccionRegistrada {
  readonly companyId: CompanyId;
  readonly userId: UserId;
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly cantidad: string;
  readonly costoEstandarDeUso: string;
  readonly totalEstandar: string;
  readonly totalReal: string;
  readonly occurredAt: Date;
  readonly note: string | null;
  readonly movimientos: readonly MovimientoParaGuardar[];
}

/** Una página del libro. El cursor es opaco: quien lo lee no lo interpreta. */
export interface PaginaDelLibro {
  readonly movimientos: readonly MovimientoLeido[];
  readonly siguiente: string | null;
}

export interface ConsultaDelLibro {
  readonly companyId: CompanyId;
  readonly locationId: LocationId;
  readonly itemId: ItemId | null;
  readonly desde: Date | null;
  readonly hasta: Date | null;
  readonly limite: number;
  readonly cursor: string | null;
}

export interface RepositorioDeInventario {
  /** Un movimiento suelto: `COMPRA`, `MERMA`, `AJUSTE` o una corrección. */
  registrarUno(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly movimiento: MovimientoParaGuardar;
  }): Promise<MovementId>;

  /**
   * Varios movimientos en una sola transacción.
   *
   * Lo usa el consumo por venta, que explota la receta de un lote de productos
   * vendidos y produce una salida por ítem: o entran todas o no entra ninguna.
   */
  registrarVarios(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly movimientos: readonly MovimientoParaGuardar[];
  }): Promise<readonly MovementId[]>;

  /** La cabecera y sus dos patas, atómicamente. Media transferencia no existe. */
  registrarTransferencia(datos: DatosDeTransferenciaRegistrada): Promise<TransferId>;

  /** El lote y sus movimientos, atómicamente. */
  registrarProduccion(datos: DatosDeProduccionRegistrada): Promise<ProductionId>;

  /** El saldo de cada ítem con movimiento en la ubicación, agregado en SQL. */
  saldos(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
  }): Promise<readonly SaldoLeido[]>;

  /** Paginación por cursor, nunca `OFFSET` (CLAUDE.md §5). */
  libro(consulta: ConsultaDelLibro): Promise<PaginaDelLibro>;

  buscarMovimiento(entrada: {
    readonly companyId: CompanyId;
    readonly movementId: MovementId;
  }): Promise<MovimientoLeido | null>;
}
