/**
 * Las lecturas del producto: la ficha, sus ubicaciones y la carta de una
 * ubicación — P16-B, pantallas 11, 12 y 3.
 *
 * **UN CONTROLADOR APARTE DE `ProductosController`** por el límite de tres
 * parámetros de constructor (CLAUDE.md §3), igual que `EmpaqueController`.
 *
 * **`GET ubicaciones` VA ANTES QUE `GET :id`**, y el orden no es de estilo:
 * Express prueba las rutas en el orden en que se registran, y con `:id` primero
 * la palabra «ubicaciones» llegaría como id y respondería 400 por no ser un UUID.
 *
 * `product.read` lo tienen los cinco roles salvo `BODEGA`: nada de esto trae
 * receta, costo ni stock, pero el PVP y la activación de un local no le hacen
 * falta a quien cuenta inventario.
 */

import { Controller, Get, Param, Query } from '@nestjs/common';

import { locationId, productId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import {
  LeerProducto,
  ProductosDeUbicacion,
  UbicacionesDeProducto,
  type ProductoDeLaCarta,
} from '../../application/casos-de-uso/productos';
import type { ProductoEnUbicacion, ProductoLeido } from '../../application/ports/repositorio-de-recetas.port';
import { CONSULTA_DE_CARTA, type ConsultaDeCarta } from './recetas.dto';

@Controller('productos')
export class FichasDeProductoController {
  public constructor(
    private readonly ficha: LeerProducto,
    private readonly ubicaciones: UbicacionesDeProducto,
    private readonly carta: ProductosDeUbicacion,
  ) {}

  /** Los productos configurados en una ubicación, con su nombre: la rejilla de ventas. */
  @Get('ubicaciones')
  @Requiere('product.read')
  public deUnaUbicacion(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_CARTA)) consulta: ConsultaDeCarta,
  ): Promise<readonly ProductoDeLaCarta[]> {
    return this.carta.ejecutar(sesion, locationId(consulta.locationId));
  }

  /** La ficha, con la versión que las escrituras del producto piden de vuelta. */
  @Get(':id')
  @Requiere('product.read')
  public leer(@SesionActual() sesion: SesionActiva, @Param('id') id: string): Promise<ProductoLeido> {
    return this.ficha.ejecutar(sesion, productId(id));
  }

  /** Dónde está configurado el producto, filtrado por el alcance de la sesión (D-16.113). */
  @Get(':id/ubicaciones')
  @Requiere('product.read')
  public dondeEsta(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
  ): Promise<readonly ProductoEnUbicacion[]> {
    return this.ubicaciones.ejecutar(sesion, productId(id));
  }
}
