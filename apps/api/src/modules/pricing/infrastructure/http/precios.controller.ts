/**
 * Precios de referencia y parámetros de costeo.
 *
 * **SUGERIR Y CONFIRMAR SON DOS PERMISOS**, y de ahí sale R5 sin escribir nada
 * más: `GERENTE_LOCAL` tiene `pricing.suggest` y no `pricing.confirm`. Ve las
 * compras de su local, es quien primero nota que un precio subió, y no puede
 * mover por su cuenta el número del que salen todos los costos del negocio.
 *
 * **`BODEGA` NO TIENE NINGUNO DE LOS DOS**, ni siquiera lectura, y es
 * deliberado (CLAUDE.md §4.3). El precio de referencia es un derivado directo
 * del costo del plato: con el precio y la cantidad se despeja la receta. Es el
 * mismo criterio que deja fuera el consumo teórico y el stock teórico.
 *
 * NO HAY `PUT /precios/:id`. Un precio nuevo es una fila nueva; lo único que
 * cambia de una existente es su estado, y para eso está `POST .../decision`.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { itemId, purchaseArticleId, referencePriceId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import type { PaginaDePendientes } from '../../application/casos-de-uso/pendientes';
import {
  SugerirPrecio,
  type CostoVigente,
  type PrecioDelHistorial,
} from '../../application/casos-de-uso/precios';
import {
  CONSULTA_DE_FECHA,
  CONSULTA_DE_HISTORIAL,
  CONSULTA_DE_PENDIENTES,
  CUERPO_DE_DECISION,
  CUERPO_DE_SUGERENCIA,
  type ConsultaDeFecha,
  type ConsultaDeHistorial,
  type ConsultaDePendientes,
  type CuerpoDeDecision,
  type CuerpoDeSugerencia,
} from './precios.dto';
import { LecturasDePrecios } from './lecturas-de-precios';
import { comoCostosAUnaFecha, type CostosAUnaFechaDto } from './presentacion';
import { ResolucionYCosto } from './resolucion-y-costo';

export interface PrecioCreado {
  readonly id: string;
}

@Controller('precios')
export class PreciosController {
  public constructor(
    private readonly sugerirPrecio: SugerirPrecio,
    private readonly lecturas: LecturasDePrecios,
    private readonly resolucion: ResolucionYCosto,
  ) {}

  /** El historial de un ítem, con la marca del que manda hoy. */
  @Get()
  @Requiere('pricing.read')
  public listar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_HISTORIAL)) consulta: ConsultaDeHistorial,
  ): Promise<readonly PrecioDelHistorial[]> {
    return this.lecturas.historial.ejecutar(sesion, itemId(consulta.itemId));
  }

  /** La bandeja de R5: lo sugerido que alguien tiene que confirmar o rechazar. */
  @Get('pendientes')
  @Requiere('pricing.read')
  public pendientes(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_PENDIENTES)) consulta: ConsultaDePendientes,
  ): Promise<PaginaDePendientes> {
    return this.lecturas.pendientes.ejecutar(sesion, {
      despuesDe: consulta.despuesDe === undefined ? null : referencePriceId(consulta.despuesDe),
      limite: consulta.limite,
    });
  }

  /**
   * El costo por unidad de uso de TODOS los ítems a una fecha, en cuatro
   * consultas fijas: el listado de insumos. Los que no tienen precio confirmado
   * van aparte, en `sinPrecio`, y no con un cero que parecería un costo.
   */
  @Get('costos')
  @Requiere('pricing.read')
  public async costos(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_FECHA)) consulta: ConsultaDeFecha,
  ): Promise<CostosAUnaFechaDto> {
    const fecha = consulta.fecha === undefined ? new Date() : new Date(consulta.fecha);
    return comoCostosAUnaFecha(fecha, await this.lecturas.costos.ejecutar(sesion, fecha));
  }

  @Post()
  @Requiere('pricing.suggest')
  @HttpCode(HttpStatus.CREATED)
  public async sugerir(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_SUGERENCIA)) cuerpo: CuerpoDeSugerencia,
  ): Promise<PrecioCreado> {
    const id = await this.sugerirPrecio.ejecutar(sesion, {
      itemId: itemId(cuerpo.itemId),
      purchaseArticleId:
        cuerpo.purchaseArticleId === null ? null : purchaseArticleId(cuerpo.purchaseArticleId),
      precio: cuerpo.precio,
      ivaCompra: cuerpo.ivaCompra,
      origen: cuerpo.origen,
      validFrom: new Date(cuerpo.validFrom),
      nota: cuerpo.nota,
    });

    return { id };
  }

  /**
   * Confirmar es lo que hace vigente un precio. Va como recurso propio y no
   * como un `PATCH` del precio porque no es «editar»: es una decisión, con su
   * permiso y su evento de auditoría.
   */
  @Post(':id/decision')
  @Requiere('pricing.confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async decidir(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
    @Body(new EsquemaPipe(CUERPO_DE_DECISION)) cuerpo: CuerpoDeDecision,
  ): Promise<void> {
    await this.resolucion.resolver.ejecutar(sesion, referencePriceId(id), cuerpo.decision);
  }

  /**
   * El costo por unidad de uso a una fecha, con la cadena de SPEC §12 entera.
   *
   * `fecha` es un parámetro y no «ahora»: preguntar cuánto costaba el mes
   * pasado devuelve el precio que estaba vigente **entonces**. Es el criterio
   * E8, expuesto en la API.
   */
  @Get('costo/:itemId')
  @Requiere('pricing.read')
  public costo(
    @SesionActual() sesion: SesionActiva,
    @Param('itemId') item: string,
    @Query(new EsquemaPipe(CONSULTA_DE_FECHA)) consulta: ConsultaDeFecha,
  ): Promise<CostoVigente> {
    return this.resolucion.costo.ejecutar(
      sesion,
      itemId(item),
      consulta.fecha === undefined ? new Date() : new Date(consulta.fecha),
    );
  }
}
