/**
 * El libro de inventario — SPEC §7, R2 y R3.
 *
 * **LA ASIMETRÍA DE `BODEGA` ES LO PRIMERO QUE HAY QUE ENTENDER DE ESTE
 * ARCHIVO.** Tiene `inventory.write` e `inventory.transfer`, y **no** tiene
 * `inventory.read`. No es un descuido de permisos: es CLAUDE.md §4.3.
 *
 *     saldo = inicial + compras − consumo
 *
 * Quien registra las compras conoce el inicial y las compras. Si además puede
 * leer el saldo, despeja el consumo — y el consumo dividido entre las unidades
 * vendidas **es** la cantidad de la receta, que es el secreto de negocio del
 * cliente. Por eso `GET /inventario/saldos` y `GET /inventario/movimientos`
 * exigen `inventory.read`, y por eso **ningún `POST` de aquí responde con el
 * saldo resultante**: una respuesta que dijera «nuevo saldo: 12,4 kg» filtraría
 * lo mismo que una lectura.
 *
 * Lo que `BODEGA` necesita para reponer es un semáforo `REPONER`/`OK` **sin la
 * cantidad**. Ese semáforo sale del punto de reorden, que sale del consumo
 * teórico de SPEC §18: llega en **P8**, con la vista de inventario.
 *
 * **NO HAY `PUT` NI `DELETE` DE UN MOVIMIENTO**, y la ausencia es R3. Un error
 * se corrige con `POST /inventario/movimientos/:id/correccion`, que **inserta**
 * la fila que lo anula y deja las dos a la vista.
 */

import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import {
  itemId as aItemId,
  locationId as aLocationId,
  movementId as aMovementId,
  productId as aProductId,
  purchaseArticleId as aPurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { RegistrarConsumoPorVenta } from '../../application/casos-de-uso/consumo';
import {
  ConsultarSaldos,
  CorregirMovimiento,
  ListarMovimientos,
  RegistrarMovimiento,
} from '../../application/casos-de-uso/movimientos';
import { RegistrarProduccion } from '../../application/casos-de-uso/produccion';
import { RegistrarTransferencia } from '../../application/casos-de-uso/transferencias';
import {
  CONSULTA_DEL_LIBRO,
  CONSULTA_DE_SALDOS,
  CUERPO_DE_CONSUMO,
  CUERPO_DE_CORRECCION,
  CUERPO_DE_MOVIMIENTO,
  CUERPO_DE_PRODUCCION,
  CUERPO_DE_TRANSFERENCIA,
  type ConsultaDelLibroDto,
  type ConsultaDeSaldos,
  type CuerpoDeConsumo,
  type CuerpoDeCorreccion,
  type CuerpoDeMovimiento,
  type CuerpoDeProduccion,
  type CuerpoDeTransferencia,
  type PaginaDelLibroDto,
  type RegistroDeConsumoDto,
  type RegistroDto,
  type SaldoDto,
} from './inventario.dto';
import { comoMovimientoDto, comoSaldoDto } from './presentacion';

/** Las escrituras del libro. Agrupadas para que el objeto de la clase no crezca. */
export class EscriturasDelLibro {
  public constructor(
    public readonly movimiento: RegistrarMovimiento,
    public readonly correccion: CorregirMovimiento,
    public readonly transferencia: RegistrarTransferencia,
  ) {}
}

export class LecturasDelLibro {
  public constructor(
    public readonly saldos: ConsultarSaldos,
    public readonly movimientos: ListarMovimientos,
  ) {}
}

@Controller('inventario')
export class InventarioController {
  public constructor(
    private readonly escrituras: EscriturasDelLibro,
    private readonly lecturas: LecturasDelLibro,
  ) {}

  /** El saldo por ítem de una ubicación: la proyección del libro (R3). */
  @Get('saldos')
  @Requiere('inventory.read')
  public async saldos(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_SALDOS)) consulta: ConsultaDeSaldos,
  ): Promise<readonly SaldoDto[]> {
    const saldos = await this.lecturas.saldos.ejecutar(sesion, {
      locationId: aLocationId(consulta.locationId),
    });
    return saldos.map(comoSaldoDto);
  }

  /** El libro, paginado por cursor. Nunca `OFFSET` (CLAUDE.md §5). */
  @Get('movimientos')
  @Requiere('inventory.read')
  public async movimientos(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DEL_LIBRO)) consulta: ConsultaDelLibroDto,
  ): Promise<PaginaDelLibroDto> {
    const pagina = await this.lecturas.movimientos.ejecutar(sesion, {
      locationId: aLocationId(consulta.locationId),
      itemId: consulta.itemId === undefined ? null : aItemId(consulta.itemId),
      desde: consulta.desde === undefined ? null : new Date(consulta.desde),
      hasta: consulta.hasta === undefined ? null : new Date(consulta.hasta),
      limite: consulta.limite,
      cursor: consulta.cursor ?? null,
    });

    return {
      movimientos: pagina.movimientos.map(comoMovimientoDto),
      siguiente: pagina.siguiente,
    };
  }

  /** Compra, merma o ajuste. Devuelve el id, y nada más. */
  @Post('movimientos')
  @Requiere('inventory.write')
  public async registrar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_MOVIMIENTO)) cuerpo: CuerpoDeMovimiento,
  ): Promise<RegistroDto> {
    const id = await this.escrituras.movimiento.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      itemId: aItemId(cuerpo.itemId),
      tipo: cuerpo.tipo,
      cantidad: cuerpo.cantidad,
      costoTotal: cuerpo.costoTotal,
      purchaseArticleId:
        cuerpo.purchaseArticleId === null ? null : aPurchaseArticleId(cuerpo.purchaseArticleId),
      occurredAt: new Date(cuerpo.occurredAt),
      note: cuerpo.note,
    });

    return { id };
  }

  /** R3 — la única forma de deshacer: una fila más, de signo contrario. */
  @Post('movimientos/:movementId/correccion')
  @Requiere('inventory.write')
  public async corregir(
    @SesionActual() sesion: SesionActiva,
    @Param('movementId') movementId: string,
    @Body(new EsquemaPipe(CUERPO_DE_CORRECCION)) cuerpo: CuerpoDeCorreccion,
  ): Promise<RegistroDto> {
    const id = await this.escrituras.correccion.ejecutar(sesion, {
      movementId: aMovementId(movementId),
      note: cuerpo.note,
    });
    return { id };
  }

  /** El par atómico. R2: el total de la company no cambia. */
  @Post('transferencias')
  @Requiere('inventory.transfer')
  public async transferir(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_TRANSFERENCIA)) cuerpo: CuerpoDeTransferencia,
  ): Promise<RegistroDto> {
    const id = await this.escrituras.transferencia.ejecutar(sesion, {
      origen: aLocationId(cuerpo.origen),
      destino: aLocationId(cuerpo.destino),
      itemId: aItemId(cuerpo.itemId),
      cantidad: cuerpo.cantidad,
      occurredAt: new Date(cuerpo.occurredAt),
      note: cuerpo.note,
    });
    return { id };
  }
}

/**
 * Producción y consumo, en su propio controlador.
 *
 * **NO ES UNA SEPARACIÓN COSMÉTICA: SON PERMISOS DISTINTOS.** `inventory.produce`
 * no lo tiene `BODEGA` —producir fija el costo estándar de una preparación, que
 * es información de costeo— y el consumo por venta tampoco: lo emite el sistema
 * de ventas, no quien está en la bodega.
 */
@Controller('inventario')
export class ProduccionController {
  public constructor(
    private readonly produccion: RegistrarProduccion,
    private readonly consumo: RegistrarConsumoPorVenta,
  ) {}

  /** R10 — el alta al costo estándar; el costo real del lote, al lado. */
  @Post('producciones')
  @Requiere('inventory.produce')
  public async producir(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_PRODUCCION)) cuerpo: CuerpoDeProduccion,
  ): Promise<RegistroDto> {
    const id = await this.produccion.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      itemId: aItemId(cuerpo.itemId),
      cantidad: cuerpo.cantidad,
      insumos: cuerpo.insumos.map((insumo) => ({
        itemId: aItemId(insumo.itemId),
        cantidad: insumo.cantidad,
      })),
      occurredAt: new Date(cuerpo.occurredAt),
      note: cuerpo.note,
    });
    return { id };
  }

  /** El interruptor de stock, en funcionamiento: baja hasta donde toca. */
  @Post('consumos')
  @Requiere('inventory.produce')
  public async consumir(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_CONSUMO)) cuerpo: CuerpoDeConsumo,
  ): Promise<RegistroDeConsumoDto> {
    const ids = await this.consumo.ejecutar(sesion, {
      locationId: aLocationId(cuerpo.locationId),
      ventas: cuerpo.ventas.map((venta) => ({
        productId: aProductId(venta.productId),
        unidades: venta.unidades,
      })),
      occurredAt: new Date(cuerpo.occurredAt),
      note: cuerpo.note,
    });
    return { movimientos: [...ids] };
  }
}
