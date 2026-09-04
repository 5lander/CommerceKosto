/**
 * Los parametros de costeo de la company — D3, SPEC §11.
 *
 * VA EN SU PROPIO CONTROLADOR y no junto a los precios porque su autorizacion
 * es otra: `settings.read` y `settings.update`, no `pricing.*`. Mezclarlos
 * pondria en la misma clase rutas con exigencias distintas, y un `@Requiere`
 * mal colocado a nivel de clase abriria una de las dos.
 *
 * `PUT` y no `PATCH`: son once parametros que se leen juntos y cuya coherencia
 * se comprueba junta —los umbrales del semaforo tienen que ir en orden—, asi
 * que mandar la mitad no tiene sentido.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';

import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { ActualizarAjustes, LeerAjustes } from '../../application/casos-de-uso/ajustes';
import type { AjustesDeCompany } from '../../application/ports/repositorio-de-precios.port';
import { CUERPO_DE_AJUSTES, type CuerpoDeAjustes } from './precios.dto';

@Controller('ajustes')
export class AjustesController {
  public constructor(
    private readonly leer: LeerAjustes,
    private readonly actualizar: ActualizarAjustes,
  ) {}

  @Get()
  @Requiere('settings.read')
  public obtener(@SesionActual() sesion: SesionActiva): Promise<AjustesDeCompany> {
    return this.leer.ejecutar(sesion);
  }

  @Put()
  @Requiere('settings.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async guardar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_AJUSTES)) cuerpo: CuerpoDeAjustes,
  ): Promise<void> {
    await this.actualizar.ejecutar(sesion, cuerpo);
  }
}
