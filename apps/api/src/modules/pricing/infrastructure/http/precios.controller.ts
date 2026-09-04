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
import {
  HistorialDePrecios,
  SugerirPrecio,
  type CostoVigente,
} from '../../application/casos-de-uso/precios';
import type { PrecioLeido } from '../../application/ports/repositorio-de-precios.port';
import {
  CUERPO_DE_DECISION,
  CUERPO_DE_SUGERENCIA,
  type CuerpoDeDecision,
  type CuerpoDeSugerencia,
} from './precios.dto';
import { ResolucionYCosto } from './resolucion-y-costo';

export interface PrecioCreado {
  readonly id: string;
}

@Controller('precios')
export class PreciosController {
  public constructor(
    private readonly sugerirPrecio: SugerirPrecio,
    private readonly historial: HistorialDePrecios,
    private readonly resolucion: ResolucionYCosto,
  ) {}

  @Get()
  @Requiere('pricing.read')
  public listar(
    @SesionActual() sesion: SesionActiva,
    @Query('itemId') item: string,
  ): Promise<readonly PrecioLeido[]> {
    return this.historial.ejecutar(sesion, itemId(item));
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
    @Query('fecha') fecha?: string,
  ): Promise<CostoVigente> {
    return this.resolucion.costo.ejecutar(
      sesion,
      itemId(item),
      fecha === undefined ? new Date() : new Date(fecha),
    );
  }
}
