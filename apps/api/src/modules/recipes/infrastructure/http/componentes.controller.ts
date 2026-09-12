/**
 * Los componentes de un combo — SPEC §8, D-16.114, pantalla 13.
 *
 * LEER PIDE `product.read`; REEMPLAZAR, `product.write`, como el resto del
 * maestro del producto. `GERENTE_LOCAL` lee y no escribe: el combo es de la
 * company entera, no de su local.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';

import { productId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { IdentificadorDeRuta } from '../../../../shared/infrastructure/http/identificador-de-ruta.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import {
  LeerComponentes,
  ReemplazarComponentes,
  type ComponentesDelCombo,
} from '../../application/casos-de-uso/componentes';
import type { VersionDeProducto } from './productos.controller';
import { CUERPO_DE_COMPONENTES, type CuerpoDeComponentes } from './recetas.dto';

@Controller('productos')
export class ComponentesController {
  public constructor(
    private readonly leer: LeerComponentes,
    private readonly reemplazar: ReemplazarComponentes,
  ) {}

  @Get(':id/componentes')
  @Requiere('product.read')
  public lista(@SesionActual() sesion: SesionActiva, @Param('id', IdentificadorDeRuta) id: string): Promise<ComponentesDelCombo> {
    return this.leer.ejecutar(sesion, productId(id));
  }

  /** La lista ENTERA: lo que no venga, deja de ser componente. */
  @Put(':id/componentes')
  @Requiere('product.write')
  @HttpCode(HttpStatus.OK)
  public async guardar(
    @SesionActual() sesion: SesionActiva,
    @Param('id', IdentificadorDeRuta) id: string,
    @Body(new EsquemaPipe(CUERPO_DE_COMPONENTES)) cuerpo: CuerpoDeComponentes,
  ): Promise<VersionDeProducto> {
    const version = await this.reemplazar.ejecutar(sesion, {
      comboId: productId(id),
      componentes: cuerpo.componentes.map((c) => ({ productId: productId(c.productId), cantidad: c.cantidad })),
      version: cuerpo.version,
    });

    return { version };
  }
}
