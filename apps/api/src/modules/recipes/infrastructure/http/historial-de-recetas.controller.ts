/**
 * El historial de una receta: sus versiones y sus propagaciones — P16-B,
 * pantallas 15 y 16.
 *
 * **LAS VERSIONES PIDEN `recipe.read`; LAS PROPAGACIONES, `recipe.propagate`**:
 * la lista de propagaciones existe para revertir una, y quien no puede propagar
 * no tiene nada que revertir. `BODEGA` no tiene ninguno de los dos (§4.3).
 *
 * Aparte de `RecetasController` por el límite de tres parámetros de constructor.
 */

import { Controller, Get, Query } from '@nestjs/common';

import { locationId, productId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { ListarPropagaciones } from '../../application/casos-de-uso/propagacion';
import { ListarVersionesDeReceta, type VersionesDeReceta } from '../../application/casos-de-uso/recetas';
import type { PropagacionLeida } from '../../application/ports/repositorio-de-recetas.port';
import { destinoDeConsulta } from './destino-de-consulta';
import {
  CONSULTA_DE_PROPAGACIONES,
  CONSULTA_DE_VERSIONES,
  type ConsultaDePropagaciones,
  type ConsultaDeVersiones,
} from './recetas.dto';

@Controller('recetas')
export class HistorialDeRecetasController {
  public constructor(
    private readonly versiones: ListarVersionesDeReceta,
    private readonly propagaciones: ListarPropagaciones,
  ) {}

  @Get('versiones')
  @Requiere('recipe.read')
  public deUnDestino(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_VERSIONES)) consulta: ConsultaDeVersiones,
  ): Promise<VersionesDeReceta> {
    return this.versiones.ejecutar(sesion, {
      destino: destinoDeConsulta(consulta),
      locationId: locationId(consulta.locationId),
    });
  }

  @Get('propagacion')
  @Requiere('recipe.propagate')
  public deUnProducto(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_PROPAGACIONES)) consulta: ConsultaDePropagaciones,
  ): Promise<readonly PropagacionLeida[]> {
    return this.propagaciones.ejecutar(sesion, productId(consulta.productId));
  }
}
