/**
 * Productos de venta — SPEC §8.
 *
 * LA UNIDAD DE COSTEO ES LA PORCION, NO EL PLATO. «Arroz con carne (segundo)»
 * y «(plato fuerte)» son productos DISTINTOS: distinta receta, categoria, PVP y
 * margen. Sin jerarquia padre-hijo — el padre no tendria atributos propios—;
 * para agrupar hay una etiqueta simple.
 *
 * El maestro es de la COMPANY y la activacion es POR UBICACION: eso permite
 * comparar entre locales con un `GROUP BY product_id` en vez de emparejar por
 * nombre, que es como se pierde la mitad de los datos en cuanto alguien escribe
 * una tilde distinta.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';

import { locationId, productId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import {
  ConfigurarProductoEnUbicacion,
  CrearProducto,
  ListarProductos,
} from '../../application/casos-de-uso/recetas';
import type { ProductoLeido } from '../../application/ports/repositorio-de-recetas.port';
import {
  CUERPO_DE_PRODUCTO,
  CUERPO_DE_UBICACION,
  type CuerpoDeProducto,
  type CuerpoDeUbicacion,
} from './recetas.dto';

export interface ProductoCreado {
  readonly id: string;
}

/** Lo que responde toda escritura del agregado producto (D-16.100). */
export interface VersionDeProducto {
  readonly version: number;
}

@Controller('productos')
export class ProductosController {
  public constructor(
    private readonly crear: CrearProducto,
    private readonly listar: ListarProductos,
    private readonly configurar: ConfigurarProductoEnUbicacion,
  ) {}

  @Get()
  @Requiere('product.read')
  public todos(@SesionActual() sesion: SesionActiva): Promise<readonly ProductoLeido[]> {
    return this.listar.ejecutar(sesion);
  }

  @Post()
  @Requiere('product.write')
  @HttpCode(HttpStatus.CREATED)
  public async nuevo(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_PRODUCTO)) cuerpo: CuerpoDeProducto,
  ): Promise<ProductoCreado> {
    return { id: await this.crear.ejecutar(sesion, cuerpo) };
  }

  /**
   * Activacion, PVP y rendimiento por lote en UNA ubicacion.
   *
   * `PUT` y no `PATCH`: los tres valores se leen juntos y su coherencia se
   * comprueba junta —un producto activo sin PVP es uno que se puede vender sin
   * saber a cuanto, y el margen saldria indefinido—.
   *
   * 200 con la version nueva del producto, no 204: el formulario sigue abierto.
   */
  @Put(':id/ubicaciones')
  @Requiere('product.write')
  @HttpCode(HttpStatus.OK)
  public async enUbicacion(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
    @Body(new EsquemaPipe(CUERPO_DE_UBICACION)) cuerpo: CuerpoDeUbicacion,
  ): Promise<VersionDeProducto> {
    const version = await this.configurar.ejecutar(sesion, {
      productId: productId(id),
      locationId: locationId(cuerpo.locationId),
      activo: cuerpo.activo,
      pvp: cuerpo.pvp,
      rendimientoPorciones: cuerpo.rendimientoPorciones,
      version: cuerpo.version,
    });

    return { version };
  }
}
