/**
 * El puerto de inventario, sobre PostgreSQL.
 *
 * NO HAY UN SOLO `update` NI `delete` EN ESTE ARCHIVO, y no puede haberlo: las
 * reglas `append-only-cliente-inventory_movement` y
 * `append-only-sql-inventory_movement` de `audit:forbidden` rompen el build si
 * alguien lo escribe. Es la tercera capa de R3; las otras dos —privilegio y
 * trigger— viven en la base.
 *
 * `direction` SE ESCRIBE AQUÍ, derivada del tipo. Es la copia que la clave
 * foránea compuesta `(type, direction)` ata a su catálogo, para que el `CHECK`
 * que cruza dirección con signo pueda vivir en la fila —un `CHECK` no puede
 * consultar otra tabla—. Derivarla en el repositorio y no pedirla al llamante
 * evita que exista una forma de escribirla mal.
 *
 * EL SALDO SE AGREGA EN SQL, no en TypeScript. `groupBy` con `_sum` sobre el
 * índice `(company_id, location_id, item_id, occurred_at)` es lo que sostiene
 * el presupuesto de 300 ms de CLAUDE.md §5 para 500 ítems.
 */

import { Injectable } from '@nestjs/common';

import { ALMACENAMIENTO } from '../../../shared/domain/decimal/escalas';
import { Money, Quantity } from '../../../shared/domain/money/tipos-monetarios';
import { unidadDeUso } from '../../../shared/domain/unidad/unidad-de-uso';

import {
  itemId as aItemId,
  locationId as aLocationId,
  movementId as aMovementId,
  productionId as aProductionId,
  purchaseArticleId as aPurchaseArticleId,
  transferId as aTransferId,
  type CompanyId,
  type ImportJobId,
  type ItemId,
  type LocationId,
  type MovementId,
  type ProductionId,
  type TransferId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import { exigirDesgloseEnCompra, type DesgloseDeCompra } from '../domain/compra';
import { DIRECCION_DE, type TipoDeMovimiento } from '../domain/movimiento';
import type {
  AgregadoDeItem,
  CompraPorArticulo,
  ConsultaDelLibro,
  DatosDeProduccionRegistrada,
  DatosDeTransferenciaRegistrada,
  MovimientoLeido,
  MovimientoParaGuardar,
  PaginaDelLibro,
  RepositorioDeInventario,
  SaldoLeido,
} from '../application/ports/repositorio-de-inventario.port';

/**
 * TODO DECIMAL DE ESTE PUERTO SALE A LA MISMA ESCALA, la de almacenamiento.
 *
 * No es cosmética. `_sum` de Prisma devuelve el decimal normalizado —`"8.5"`—
 * mientras que leer la columna devuelve `"8.500000000000"`, así que el saldo y
 * el movimiento que lo produce salían con dos formas distintas del mismo
 * número. Quien consuma la API acabaría comparándolos como cadenas alguna vez.
 *
 * La escala elegida es la de `toStorageString()` del dominio, que es lo que
 * permite que la prueba del criterio de aceptación compare los dos caminos —el
 * `SUM` de PostgreSQL y el pliegue en TypeScript— sin normalizar nada por medio.
 */
interface Decimal {
  toFixed: (decimales?: number) => string;
}

function aEscalaDeAlmacenamiento(valor: Decimal): string {
  return valor.toFixed(ALMACENAMIENTO);
}

/** Un agregado sin filas no vale `null` hacia fuera: vale cero, a su escala. */
const CERO_ALMACENADO = (0).toFixed(ALMACENAMIENTO);

/**
 * El importe de unas compras CON LAS CORRECCIONES RESTADAS — INC-029.
 *
 * **POR QUE HAY QUE RESTARLAS A MANO, SI LA CANTIDAD SE CANCELA SOLA.** Porque
 * `total_cost` es una MAGNITUD SIN SIGNO (ADR-009 §2): el sentido lo lleva la
 * cantidad. La correccion de una compra es otra `COMPRA`, con cantidad negativa
 * y el mismo importe en positivo, asi que `SUM(quantity)` vuelve a cero y
 * `SUM(total_cost)` se DUPLICA. `compras_del_mes` (SPEC §16) contaba el dinero
 * de compras que nadie hizo, y eso entra directo en el food cost real (R7).
 *
 * **SE RESTAN DOS VECES, Y NO ES UN ERROR**: el total ya las trae sumadas. Una
 * resta las saca del total y la otra devuelve su dinero.
 */
function sinLasCorrecciones(total: Decimal | null, correcciones: Decimal | null): string {
  if (total === null) return CERO_ALMACENADO;
  if (correcciones === null) return aEscalaDeAlmacenamiento(total);

  const devuelto = Money.fromDatabase(aEscalaDeAlmacenamiento(correcciones));
  return Money.fromDatabase(aEscalaDeAlmacenamiento(total))
    .minus(devuelto)
    .minus(devuelto)
    .toStorageString();
}

/** Lo que hace falta de un movimiento para responderlo. */
const CAMPOS = {
  id: true,
  locationId: true,
  itemId: true,
  type: true,
  quantity: true,
  totalCost: true,
  totalBruto: true,
  ivaTarifaAplicada: true,
  ivaRecuperableAplicado: true,
  purchaseArticleId: true,
  occurredAt: true,
  recordedAt: true,
  transferId: true,
  productionId: true,
  reversesMovementId: true,
  note: true,
  correccion: { select: { id: true } },
} as const;

interface FilaDeMovimiento {
  readonly id: string;
  readonly locationId: string;
  readonly itemId: string;
  readonly type: string;
  readonly quantity: Decimal;
  readonly totalCost: Decimal | null;
  readonly totalBruto: Decimal | null;
  readonly ivaTarifaAplicada: Decimal | null;
  readonly ivaRecuperableAplicado: boolean | null;
  readonly purchaseArticleId: string | null;
  readonly occurredAt: Date;
  readonly recordedAt: Date;
  readonly transferId: string | null;
  readonly productionId: string | null;
  readonly reversesMovementId: string | null;
  readonly note: string | null;
  readonly correccion: { readonly id: string } | null;
}

function comoMovimiento(fila: FilaDeMovimiento): MovimientoLeido {
  return {
    id: aMovementId(fila.id),
    locationId: aLocationId(fila.locationId),
    itemId: aItemId(fila.itemId),
    tipo: fila.type as TipoDeMovimiento,
    cantidad: aEscalaDeAlmacenamiento(fila.quantity),
    costoTotal: fila.totalCost === null ? null : aEscalaDeAlmacenamiento(fila.totalCost),
    desglose: desgloseDe(fila),
    purchaseArticleId:
      fila.purchaseArticleId === null ? null : aPurchaseArticleId(fila.purchaseArticleId),
    occurredAt: fila.occurredAt,
    recordedAt: fila.recordedAt,
    transferId: fila.transferId === null ? null : aTransferId(fila.transferId),
    productionId: fila.productionId === null ? null : aProductionId(fila.productionId),
    corrigeA: fila.reversesMovementId === null ? null : aMovementId(fila.reversesMovementId),
    corregidoPor: fila.correccion === null ? null : aMovementId(fila.correccion.id),
    note: fila.note,
  };
}

/**
 * El desglose sale entero o no sale: el CHECK `inventory_movement_desglose_coherente`
 * garantiza que los tres campos van juntos, así que basta con mirar uno.
 */
function desgloseDe(fila: FilaDeMovimiento): DesgloseDeCompra | null {
  if (
    fila.totalBruto === null ||
    fila.ivaTarifaAplicada === null ||
    fila.ivaRecuperableAplicado === null
  ) {
    return null;
  }
  return {
    totalBruto: aEscalaDeAlmacenamiento(fila.totalBruto),
    ivaTarifaAplicada: aEscalaDeAlmacenamiento(fila.ivaTarifaAplicada),
    ivaRecuperableAplicado: fila.ivaRecuperableAplicado,
  };
}

/**
 * La fila tal como entra.
 *
 * Se declara explícitamente en vez de dejarla en `Record<string, unknown>`:
 * así el compilador comprueba que lo que se escribe encaja con la tabla, que es
 * media razón de tener tipos.
 */
interface FilaParaInsertar {
  readonly companyId: string;
  readonly locationId: string;
  readonly itemId: string;
  readonly type: string;
  readonly direction: string;
  readonly quantity: string;
  readonly totalCost: string | null;
  readonly totalBruto: string | null;
  readonly ivaTarifaAplicada: string | null;
  readonly ivaRecuperableAplicado: boolean | null;
  readonly desgloseConocido: boolean;
  readonly purchaseArticleId: string | null;
  readonly transferId: string | null;
  readonly productionId: string | null;
  readonly importJobId: string | null;
  readonly reversesMovementId: string | null;
  readonly occurredAt: Date;
  readonly createdBy: string;
  readonly note: string | null;
}

/** Lo que comparten todas las filas de una misma escritura. */
interface ContextoDeInsercion {
  readonly companyId: CompanyId;
  readonly userId: UserId;
  readonly transferId: TransferId | null;
  readonly productionId: ProductionId | null;
  /** La importación que trajo estas filas, o `null` si no vinieron de un archivo. */
  readonly importJobId: ImportJobId | null;
}

/**
 * `direction` se DERIVA del tipo aquí: no hay forma de recibirla mal. Y una
 * COMPRA nueva sin desglose se para aquí (D-16.25): la base no la distingue de
 * una anterior a P16-A1, así que la guarda es de aplicación y vive en la
 * única función por la que entra toda fila del libro.
 */
function comoFila(movimiento: MovimientoParaGuardar, contexto: ContextoDeInsercion): FilaParaInsertar {
  exigirDesgloseEnCompra(movimiento);

  return {
    companyId: contexto.companyId,
    locationId: movimiento.locationId,
    itemId: movimiento.itemId,
    type: movimiento.tipo,
    direction: DIRECCION_DE[movimiento.tipo],
    quantity: movimiento.cantidad,
    totalCost: movimiento.costoTotal,
    totalBruto: movimiento.desglose?.totalBruto ?? null,
    ivaTarifaAplicada: movimiento.desglose?.ivaTarifaAplicada ?? null,
    ivaRecuperableAplicado: movimiento.desglose?.ivaRecuperableAplicado ?? null,
    desgloseConocido: movimiento.desglose !== null,
    purchaseArticleId: movimiento.purchaseArticleId,
    transferId: contexto.transferId,
    productionId: contexto.productionId,
    importJobId: contexto.importJobId,
    reversesMovementId: movimiento.reversesMovementId,
    occurredAt: movimiento.occurredAt,
    createdBy: contexto.userId,
    note: movimiento.note,
  };
}

const SIN_AGRUPAR = { transferId: null, productionId: null } as const;

const CONSUMO_POR_VENTA = 'CONSUMO_POR_VENTA';
const MERMA_O_AJUSTE: readonly string[] = ['MERMA', 'AJUSTE'];
const COMPRA = 'COMPRA';

interface FilaAgregada {
  readonly itemId: string;
  readonly type: string;
  readonly _sum: { readonly quantity: Decimal | null; readonly totalCost: Decimal | null };
}

interface Acumulado {
  compras: string;
  mermasYAjustes: string;
  otros: string;
  importeDeCompras: string;
}

function vacio(): Acumulado {
  return {
    compras: CERO_ALMACENADO,
    mermasYAjustes: CERO_ALMACENADO,
    otros: CERO_ALMACENADO,
    importeDeCompras: CERO_ALMACENADO,
  };
}

/**
 * Reparte cada tipo en su casilla.
 *
 * Se pliega en TypeScript y no en SQL porque son tres sumas condicionales
 * sobre el MISMO grupo: en SQL serian tres `FILTER (WHERE ...)` escritos a
 * mano, que es exactamente el `SELECT` crudo que la capa de tenant no deja
 * pasar. Aqui la consulta devuelve como mucho `items x 6` filas.
 */
function plegarAgregados(
  filas: readonly FilaAgregada[],
  devuelto: ReadonlyMap<string, Decimal | null>,
): readonly AgregadoDeItem[] {
  const porItem = new Map<string, Acumulado>();

  for (const fila of filas) {
    const acumulado = porItem.get(fila.itemId) ?? vacio();
    const cantidad = fila._sum.quantity;
    const importe = fila._sum.totalCost;

    if (fila.type === COMPRA) {
      acumulado.compras = aEscalaDeAlmacenamiento(cantidad ?? CERO_DECIMAL);
      acumulado.importeDeCompras = sinLasCorrecciones(importe, devuelto.get(fila.itemId) ?? null);
    } else if (MERMA_O_AJUSTE.includes(fila.type)) {
      acumulado.mermasYAjustes = sumarCadenas(acumulado.mermasYAjustes, cantidad);
    } else {
      acumulado.otros = sumarCadenas(acumulado.otros, cantidad);
    }
    porItem.set(fila.itemId, acumulado);
  }

  return [...porItem].map(([itemId, acumulado]) => ({ itemId: aItemId(itemId), ...acumulado }));
}

/** Un decimal neutro con la forma que `toFixed` espera. */
const CERO_DECIMAL: Decimal = { toFixed: (decimales?: number) => (0).toFixed(decimales) };

/**
 * Suma dos decimales que viajan como cadena.
 *
 * MERMA y AJUSTE caen en la misma casilla y llegan como dos filas del
 * `groupBy`, asi que hay que sumarlas. Se hace con `Quantity` y no con
 * `Number`: son cantidades de inventario, y CLAUDE.md 8 no admite punto
 * flotante para ellas ni siquiera en un acumulador temporal. La unidad es
 * irrelevante aqui —las dos filas son del mismo item— y por eso se usa una
 * fija.
 */
function sumarCadenas(acumulado: string, cantidad: Decimal | null): string {
  if (cantidad === null) return acumulado;

  const unidad = unidadDeUso('unid');
  return Quantity.fromDatabase(acumulado, unidad)
    .plus(Quantity.fromDatabase(aEscalaDeAlmacenamiento(cantidad), unidad))
    .toStorageString();
}

@Injectable()
export class PrismaInventarioRepositorio implements RepositorioDeInventario {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async registrarUno(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly movimiento: MovimientoParaGuardar;
  }): Promise<MovementId> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.inventoryMovement.create({
        data: comoFila(entrada.movimiento, { ...entrada, ...SIN_AGRUPAR, importJobId: null }),
        select: { id: true },
      });
      return aMovementId(fila.id);
    });
  }

  public async registrarVarios(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly movimientos: readonly MovimientoParaGuardar[];
    readonly importJobId: ImportJobId | null;
  }): Promise<readonly MovementId[]> {
    return this.transaccion.run(entrada.companyId, async (tx) =>
      insertarTodos(tx, entrada.movimientos, { ...entrada, ...SIN_AGRUPAR }),
    );
  }

  /**
   * Las filas que trajo una importación (D-16.200).
   *
   * `company_id` va en el `WHERE` además de en RLS: la misma defensa repetida
   * que en el resto del repositorio, porque una que solo está en un sitio se
   * cae entera si ese sitio falla.
   */
  public async movimientosDeImportacion(entrada: {
    readonly companyId: CompanyId;
    readonly importJobId: ImportJobId;
  }): Promise<readonly MovimientoLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.inventoryMovement.findMany({
        where: { companyId: entrada.companyId, importJobId: entrada.importJobId },
        select: CAMPOS,
        orderBy: { id: 'asc' },
      });
      return filas.map(comoMovimiento);
    });
  }

  public async registrarTransferencia(datos: DatosDeTransferenciaRegistrada): Promise<TransferId> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const cabecera = await tx.inventoryTransfer.create({
        data: {
          companyId: datos.companyId,
          fromLocationId: datos.fromLocationId,
          toLocationId: datos.toLocationId,
          occurredAt: datos.occurredAt,
          createdBy: datos.userId,
          note: datos.note,
        },
        select: { id: true },
      });

      const transferId = aTransferId(cabecera.id);
      await insertarTodos(tx, datos.movimientos, {
        companyId: datos.companyId,
        userId: datos.userId,
        transferId,
        productionId: null,
        importJobId: null,
      });

      return transferId;
    });
  }

  public async registrarProduccion(datos: DatosDeProduccionRegistrada): Promise<ProductionId> {
    return this.transaccion.run(datos.companyId, async (tx) => {
      const cabecera = await tx.inventoryProduction.create({
        data: {
          companyId: datos.companyId,
          locationId: datos.locationId,
          itemId: datos.itemId,
          quantity: datos.cantidad,
          standardUnitCost: datos.costoEstandarDeUso,
          standardTotal: datos.totalEstandar,
          realTotal: datos.totalReal,
          occurredAt: datos.occurredAt,
          createdBy: datos.userId,
          note: datos.note,
        },
        select: { id: true },
      });

      const productionId = aProductionId(cabecera.id);
      await insertarTodos(tx, datos.movimientos, {
        companyId: datos.companyId,
        userId: datos.userId,
        transferId: null,
        productionId,
        importJobId: null,
      });

      return productionId;
    });
  }

  /**
   * El saldo de cada ítem con movimiento en la ubicación. UNA consulta.
   *
   * NO TRAE EL NOMBRE NI LA UNIDAD: `item` es tabla de `catalog`, y leerla desde
   * aquí rompe la fuente única de verdad de CLAUDE.md §2 —lo detiene la regla
   * `tablas-de-catalogo-solo-en-catalog`—. Los compone `ConsultarSaldos` con el
   * puerto de `catalog`, que es una consulta más y no una por ítem.
   */
  public async saldos(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly hasta: Date | null;
  }): Promise<readonly SaldoLeido[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const agregados = await tx.inventoryMovement.groupBy({
        by: ['itemId'],
        where: {
          companyId: entrada.companyId,
          locationId: entrada.locationId,
          // El corte del conteo fisico. Semiabierto igual que el periodo: un
          // movimiento en el instante exacto del corte ya es del mes siguiente.
          ...(entrada.hasta === null ? {} : { occurredAt: { lt: entrada.hasta } }),
        },
        _sum: { quantity: true },
      });

      return agregados
        .map((agregado) => saldoDe(agregado, entrada.locationId))
        .filter((saldo): saldo is SaldoLeido => saldo !== null);
    });
  }

  /**
   * Una página del libro, con cursor y nunca `OFFSET` (CLAUDE.md §5).
   *
   * El cursor es el `id` del último movimiento devuelto. Los identificadores
   * son UUID v7, que ordenan por tiempo de creación: `id` desempata el orden
   * por `occurred_at` de forma estable aunque dos movimientos compartan fecha.
   */
  public async libro(consulta: ConsultaDelLibro): Promise<PaginaDelLibro> {
    return this.transaccion.run(consulta.companyId, async (tx) => {
      const filas = await tx.inventoryMovement.findMany({
        where: filtroDelLibro(consulta),
        select: CAMPOS,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: consulta.limite + 1,
        ...(consulta.cursor === null
          ? {}
          : { cursor: { id: consulta.cursor }, skip: 1 }),
      });

      const pagina = filas.slice(0, consulta.limite);
      return {
        movimientos: pagina.map(comoMovimiento),
        siguiente: filas.length > consulta.limite ? (pagina.at(-1)?.id ?? null) : null,
      };
    });
  }

  /**
   * `compras_del_mes` de SPEC 16, agregado en SQL.
   *
   * Filtra por `type = 'COMPRA'` y suma el importe, asi que **las correcciones
   * se cancelan solas**: la correccion de una compra es una COMPRA de importe
   * invertido y no un AJUSTE (ADR-009). Si conservara otro tipo, este numero
   * seguiria contando dinero que no se gasto.
   */
  public async comprasEntre(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<string> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filtro = {
        companyId: entrada.companyId,
        locationId: entrada.locationId,
        type: COMPRA,
        occurredAt: { gte: entrada.desde, lt: entrada.hasta },
      };

      const agregado = await tx.inventoryMovement.aggregate({
        where: filtro,
        _sum: { totalCost: true },
      });

      const correcciones = await tx.inventoryMovement.aggregate({
        where: { ...filtro, reversesMovementId: { not: null } },
        _sum: { totalCost: true },
      });

      return sinLasCorrecciones(agregado._sum.totalCost, correcciones._sum.totalCost);
    });
  }

  /**
   * El libro de un periodo, agrupado por item y por tipo. UNA consulta.
   *
   * `CONSUMO_POR_VENTA` se excluye en el `where`, no al plegar: asi ni siquiera
   * viaja. Ver la cabecera del metodo en el puerto — es lo que evita contar el
   * consumo dos veces en el stock teorico de SPEC 18.
   */
  public async agregadosDelPeriodo(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<readonly AgregadoDeItem[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filtro = {
        companyId: entrada.companyId,
        locationId: entrada.locationId,
        occurredAt: { gte: entrada.desde, lt: entrada.hasta },
      };

      const filas = await tx.inventoryMovement.groupBy({
        by: ['itemId', 'type'],
        where: { ...filtro, type: { not: CONSUMO_POR_VENTA } },
        _sum: { quantity: true, totalCost: true },
      });

      // El dinero devuelto por las correcciones, por item — INC-029. Las
      // cantidades NO lo necesitan: llevan signo y ya vienen netas de arriba.
      const correcciones = await tx.inventoryMovement.groupBy({
        by: ['itemId'],
        where: { ...filtro, type: COMPRA, reversesMovementId: { not: null } },
        _sum: { totalCost: true },
      });

      return plegarAgregados(filas, new Map(correcciones.map((c) => [c.itemId, c._sum.totalCost])));
    });
  }

  /**
   * Lo pagado y lo recibido por (ubicacion, item, articulo) — la comparativa
   * de compras de P9.
   *
   * `groupBy` agrega en SQL, no en la aplicacion (CLAUDE.md §5).
   *
   * **DEVUELVE IDS, NO NOMBRES, y eso lo decidio `audit:forbidden`.** La primera
   * version resolvia aqui los nombres del item y del articulo con dos lecturas
   * de catalogo, y la regla `tablas-de-catalogo-solo-en-catalog` la paro: el
   * catalogo es fuente unica de verdad y se lee por sus puertos, no por sus
   * tablas desde otro modulo (CLAUDE.md §2). Los nombres los pone `analytics`
   * con `ListarItems` y `ListarArticulos`, que es donde corresponde.
   */
  public async comprasPorArticulo(entrada: {
    readonly companyId: CompanyId;
    readonly desde: Date;
    readonly hasta: Date;
  }): Promise<readonly CompraPorArticulo[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filtro = {
        companyId: entrada.companyId,
        occurredAt: { gte: entrada.desde, lt: entrada.hasta },
        type: COMPRA,
      };

      const filas = await tx.inventoryMovement.groupBy({
        by: ['locationId', 'itemId', 'purchaseArticleId'],
        where: filtro,
        _sum: { quantity: true, totalCost: true },
      });

      // INC-029, por presentacion. La correccion de una compra conserva su
      // articulo justamente para caer en este mismo grupo: sin el, la
      // devolucion no se podria restar de lo que se devolvio.
      const correcciones = await tx.inventoryMovement.groupBy({
        by: ['locationId', 'itemId', 'purchaseArticleId'],
        where: { ...filtro, reversesMovementId: { not: null } },
        _sum: { totalCost: true },
      });
      const devuelto = new Map(
        correcciones.map((c) => [claveDeCompra(c), c._sum.totalCost]),
      );

      return filas.map((fila) => ({
        locationId: fila.locationId as LocationId,
        itemId: fila.itemId as ItemId,
        purchaseArticleId: fila.purchaseArticleId,
        importe: sinLasCorrecciones(fila._sum.totalCost, devuelto.get(claveDeCompra(fila)) ?? null),
        cantidad: (fila._sum.quantity ?? CERO_DECIMAL).toFixed(),
      }));
    });
  }

  public async buscarMovimiento(entrada: {
    readonly companyId: CompanyId;
    readonly movementId: MovementId;
  }): Promise<MovimientoLeido | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.inventoryMovement.findFirst({
        where: { id: entrada.movementId, companyId: entrada.companyId },
        select: CAMPOS,
      });
      return fila === null ? null : comoMovimiento(fila);
    });
  }
}

async function insertarTodos(
  tx: ClienteDeTransaccion,
  movimientos: readonly MovimientoParaGuardar[],
  contexto: ContextoDeInsercion,
): Promise<readonly MovementId[]> {
  const ids: MovementId[] = [];

  // Uno a uno y no `createMany`: hace falta el `id` de cada fila para
  // devolverlo, y `createMany` no lo devuelve bajo RLS (ver INC-010).
  for (const movimiento of movimientos) {
    const fila = await tx.inventoryMovement.create({
      data: comoFila(movimiento, contexto),
      select: { id: true },
    });
    ids.push(aMovementId(fila.id));
  }

  return ids;
}

/** La clave del grupo de `comprasPorArticulo`: sin articulo tambien es un grupo. */
function claveDeCompra(fila: {
  readonly locationId: string;
  readonly itemId: string;
  readonly purchaseArticleId: string | null;
}): string {
  return `${fila.locationId}|${fila.itemId}|${fila.purchaseArticleId ?? ''}`;
}

function saldoDe(
  agregado: { readonly itemId: string; readonly _sum: { readonly quantity: Decimal | null } },
  locationId: LocationId,
): SaldoLeido | null {
  if (agregado._sum.quantity === null) return null;

  return {
    locationId,
    itemId: aItemId(agregado.itemId),
    cantidad: aEscalaDeAlmacenamiento(agregado._sum.quantity),
  };
}

function filtroDelLibro(consulta: ConsultaDelLibro): Record<string, unknown> {
  const rango = rangoDeFechas(consulta);
  return {
    companyId: consulta.companyId,
    locationId: consulta.locationId,
    ...(consulta.itemId === null ? {} : { itemId: consulta.itemId }),
    ...(consulta.tipo === null ? {} : { type: consulta.tipo }),
    ...(rango === null ? {} : { occurredAt: rango }),
  };
}

function rangoDeFechas(consulta: ConsultaDelLibro): Record<string, Date> | null {
  const rango = {
    ...(consulta.desde === null ? {} : { gte: consulta.desde }),
    ...(consulta.hasta === null ? {} : { lte: consulta.hasta }),
  };
  return Object.keys(rango).length === 0 ? null : rango;
}
