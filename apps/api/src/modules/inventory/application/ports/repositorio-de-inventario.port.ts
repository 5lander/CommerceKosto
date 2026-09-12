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
import type { DesgloseDeCompra } from '../../domain/compra';
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
  /**
   * Magnitud, sin signo. `null` donde el tipo no lo exige. En una COMPRA con
   * desglose es el NETO (D-16.10); sin desglose, lo que se tecleó.
   */
  readonly costoTotal: string | null;
  /**
   * Solo una COMPRA lo lleva, y `desglose_conocido` es exactamente
   * `desglose !== null`. Los cuatro campos nacen juntos en el dominio.
   */
  readonly desglose: DesgloseDeCompra | null;
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
  /** `null` = «sin desglose»: una COMPRA anterior a P16-A1, o no es COMPRA. */
  readonly desglose: DesgloseDeCompra | null;
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

/**
 * Lo que un ítem movió en un período, separado por lo que cada vista necesita.
 *
 * Los tres primeros llevan **el signo del libro**: una merma ya viene negativa.
 * SPEC §18 los *resta* porque en el Excel se capturan en positivo; aquí se
 * suman, que es la traducción correcta de la misma fórmula.
 */
export interface AgregadoDeItem {
  readonly itemId: ItemId;
  /** `Σ` cantidad de `COMPRA`. Positiva. */
  readonly compras: string;
  /** `Σ(MERMA) + Σ(AJUSTE)`, con signo. */
  readonly mermasYAjustes: string;
  /** Transferencias y producción, con signo. No existen en el Excel: son P6. */
  readonly otros: string;
  /** `Σ total_cost` de `COMPRA` — `compras_del_mes` de SPEC §16. */
  readonly importeDeCompras: string;
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
  /** P16-C (D-16.125): el libro filtrado por tipo de la pantalla 17. `null` = todos. */
  readonly tipo: TipoDeMovimiento | null;
  readonly desde: Date | null;
  readonly hasta: Date | null;
  readonly limite: number;
  readonly cursor: string | null;
}

/**
 * Una fila de `comprasPorArticulo`: lo pagado y lo recibido, sin dividir.
 *
 * **Solo ids.** Los nombres del item y del articulo los pone quien consulta,
 * leyendo el catalogo por sus puertos: `inventory` no toca sus tablas
 * (CLAUDE.md §2, y `audit:forbidden` lo hace cumplir).
 */
export interface CompraPorArticulo {
  readonly locationId: LocationId;
  readonly itemId: ItemId;
  readonly purchaseArticleId: string | null;
  readonly importe: string;
  readonly cantidad: string;
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

  /**
   * El saldo de cada ítem con movimiento en la ubicación, agregado en SQL.
   *
   * `hasta` recorta el libro a un instante: es lo que convierte «el saldo» en
   * «el saldo en el corte» que el conteo físico necesita. `null` significa todo
   * el libro, que es la consulta de P6.
   */
  saldos(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly hasta: Date | null;
  }): Promise<readonly SaldoLeido[]>;

  /**
   * `compras_del_mes` de SPEC §16: la suma de los importes de los movimientos
   * `COMPRA` en `[desde, hasta)`.
   *
   * **SALE DEL LIBRO Y NO DE OTRO SITIO**, y por eso las correcciones se
   * cancelan solas: la corrección de una compra es una `COMPRA` de importe
   * invertido, no un `AJUSTE`. Ver ADR-009.
   */
  comprasEntre(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<string>;

  /**
   * El libro de un período agregado **por ítem y por tipo** — SPEC §18.
   *
   * `CONSUMO_POR_VENTA` NO ENTRA EN NINGÚN AGREGADO, y es la decisión que evita
   * contar el consumo dos veces: el Excel no tiene movimientos de consumo —lo
   * calcula desde la receta— y este sistema sí puede tenerlos. Si se sumaran
   * aquí *y* además se restara el consumo teórico, el stock teórico saldría
   * corto por el valor entero del consumo del mes.
   *
   * Hay una prueba de integración que registra el consumo por venta y otra que
   * no, y exige que el stock teórico dé lo mismo.
   */
  agregadosDelPeriodo(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<readonly AgregadoDeItem[]>;

  /**
   * Lo que cada ubicación pagó de verdad por cada ítem, y en qué presentación
   * — la comparativa de compras de P9.
   *
   * **NO SALE DE `reference_price`, Y ESA ES LA DECISIÓN.** El precio de
   * referencia es de la company y no tiene ubicación: compararlo entre locales
   * daría el mismo número siempre, que es una comparativa que no compara nada.
   * Lo que sí varía por ubicación es la factura, y la factura está aquí.
   *
   * Agrega por `(location_id, item_id, purchase_article_id)` porque la pregunta
   * del dueño lleva las tres: «¿por qué el Norte paga el tomate más caro —y es
   * que compra otra marca?». Los nombres los resuelve quien consulta.
   *
   * `importe` y `cantidad` vienen **sin dividir**: el precio unitario se
   * calcula en el dominio, donde la división lleva su escala explícita y su
   * guarda de divisor cero.
   */
  comprasPorArticulo(entrada: {
    readonly companyId: CompanyId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<readonly CompraPorArticulo[]>;

  /** Paginación por cursor, nunca `OFFSET` (CLAUDE.md §5). */
  libro(consulta: ConsultaDelLibro): Promise<PaginaDelLibro>;

  buscarMovimiento(entrada: {
    readonly companyId: CompanyId;
    readonly movementId: MovementId;
  }): Promise<MovimientoLeido | null>;
}
