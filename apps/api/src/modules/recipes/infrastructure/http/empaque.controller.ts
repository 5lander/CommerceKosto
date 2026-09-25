/**
 * El empaque de un producto — SPEC §14, ADR-008.
 *
 * **VA EN SU PROPIO CONTROLADOR Y NO EN `ProductosController`** por el límite
 * de tres parámetros de CLAUDE.md §3: aquel ya tiene tres casos de uso por
 * constructor, y añadir el cuarto habría obligado a agruparlos en un objeto
 * artificial. Dos controladores sobre la misma ruta es lo que NestJS soporta de
 * fábrica y deja cada uno con una responsabilidad.
 *
 * **EL EMPAQUE ES UN ÍTEM.** No hay tabla `packaging` ni precio propio: un
 * envase se compra, tiene artículo, tiene precio con vigencia y un día se
 * cuenta en el inventario. `empaque_neto` de SPEC §14 es exactamente el
 * `costo_neto_uso` de ese ítem, con la misma cadena de SPEC §12 y sin una
 * fórmula nueva. El razonamiento completo está en ADR-008.
 */

import { Body, Controller, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';

import { itemId, productId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { IdentificadorDeRuta } from '../../../../shared/infrastructure/http/identificador-de-ruta.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { AsignarEmpaque } from '../../application/casos-de-uso/carta';
import type { VersionDeProducto } from './productos.controller';
import { CUERPO_DE_EMPAQUE, type CuerpoDeEmpaque } from './recetas.dto';

@Controller('productos')
export class EmpaqueController {
  public constructor(private readonly asignar: AsignarEmpaque) {}

  @Put(':id/empaque')
  @Requiere('product.write')
  @HttpCode(HttpStatus.OK)
  public async fijar(
    @SesionActual() sesion: SesionActiva,
    @Param('id', IdentificadorDeRuta) id: string,
    @Body(new EsquemaPipe(CUERPO_DE_EMPAQUE)) cuerpo: CuerpoDeEmpaque,
  ): Promise<VersionDeProducto> {
    const version = await this.asignar.ejecutar(sesion, {
      productId: productId(id),
      empaqueItemId: cuerpo.empaqueItemId === null ? null : itemId(cuerpo.empaqueItemId),
      version: cuerpo.version,
    });

    return { version };
  }
}
