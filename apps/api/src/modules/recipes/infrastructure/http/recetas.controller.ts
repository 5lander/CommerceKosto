/**
 * Recetas y propagación — SPEC §9, R9 y R11.
 *
 * **`recipe.propagate` ES UN PERMISO SEPARADO Y DE NIVEL COMPANY**, y de ahí
 * sale E18 sin escribir un solo `if`: `GERENTE_LOCAL` tiene `recipe.write` y no
 * `recipe.propagate`, así que gestiona la receta de su ubicación y recibe 403 al
 * intentar sobrescribir la del local de al lado. Un gerente no decide cómo
 * cocina otro local.
 *
 * **`BODEGA` NO TIENE NI `recipe.read`**, y es la regla más dura de CLAUDE.md
 * §4.3: las líneas de receta con sus cantidades **son** la receta. El filtrado
 * va en la API, no en el frontend — aquí, en una fila de `role_permission` que
 * no existe.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';

import {
  itemId,
  locationId,
  productId,
  recipeId,
  recipePropagationId,
  type LocationId,
} from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import type { Previsualizacion } from '../../application/casos-de-uso/propagacion';
import {
  GuardarReceta,
  LeerReceta,
  type RecetaParaEditar,
} from '../../application/casos-de-uso/recetas';
import { destinoDeConsulta } from './destino-de-consulta';
import {
  CONSULTA_DE_PREVISUALIZACION,
  CONSULTA_DE_RECETA,
  CUERPO_DE_PROPAGACION,
  CUERPO_DE_RECETA,
  type ConsultaDePrevisualizacion,
  type ConsultaDeReceta,
  type CuerpoDePropagacion,
  type CuerpoDeReceta,
} from './recetas.dto';
import { Propagacion } from './propagacion';

export interface RecetaCreada {
  readonly id: string;
}

export interface PropagacionCreada {
  readonly id: string;
}

@Controller('recetas')
export class RecetasController {
  public constructor(
    private readonly guardar: GuardarReceta,
    private readonly leer: LeerReceta,
    private readonly propagacion: Propagacion,
  ) {}

  /**
   * La receta vigente a una fecha. `fecha` es un parámetro y no «ahora»: los
   * costeos históricos usan la receta que estaba vigente entonces (SPEC §9).
   */
  /**
   * Los parametros de consulta llegan como UN objeto y se validan con esquema,
   * igual que un cuerpo. Cinco `@Query` sueltos habrian pasado del limite de
   * tres parametros de CLAUDE.md §3, y sobre todo habrian entrado sin validar:
   * un parametro de URL es entrada no confiable igual que un cuerpo.
   */
  @Get()
  @Requiere('recipe.read')
  public vigente(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_RECETA)) consulta: ConsultaDeReceta,
  ): Promise<RecetaParaEditar> {
    return this.leer.ejecutar(sesion, {
      destino: destinoDeConsulta(consulta),
      locationId: locationId(consulta.locationId),
      fecha: consulta.fecha === undefined ? new Date() : new Date(consulta.fecha),
    });
  }

  @Put()
  @Requiere('recipe.write')
  @HttpCode(HttpStatus.CREATED)
  public async guardarVersion(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_RECETA)) cuerpo: CuerpoDeReceta,
  ): Promise<RecetaCreada> {
    const id = await this.guardar.ejecutar(sesion, {
      destino:
        cuerpo.destino.clase === 'producto'
          ? { clase: 'producto', productId: productId(cuerpo.destino.productId) }
          : { clase: 'item', itemId: itemId(cuerpo.destino.itemId) },
      locationId: locationId(cuerpo.locationId),
      validFrom: new Date(cuerpo.validFrom),
      nota: cuerpo.nota,
      basadaEn: cuerpo.basadaEn === null ? null : recipeId(cuerpo.basadaEn),
      lineas: cuerpo.lineas.map((l) => ({
        itemId: itemId(l.itemId),
        cantidad: l.cantidad,
        base: l.base,
        estado: l.estado,
      })),
    });

    return { id };
  }

  /**
   * R11 EXIGE VER ESTO ANTES DE PROPAGAR. `personalizadas` es el número que hay
   * que mirar: son las ubicaciones que perderían una receta propia.
   */
  @Get('propagacion/previsualizacion')
  @Requiere('recipe.propagate')
  public previsualizar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_PREVISUALIZACION)) consulta: ConsultaDePrevisualizacion,
  ): Promise<Previsualizacion> {
    return this.propagacion.previsualizar.ejecutar(sesion, {
      productId: productId(consulta.productId),
      origen: locationId(consulta.origen),
    });
  }

  @Post('propagacion')
  @Requiere('recipe.propagate')
  @HttpCode(HttpStatus.CREATED)
  public async propagar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_PROPAGACION)) cuerpo: CuerpoDePropagacion,
  ): Promise<PropagacionCreada> {
    const id = await this.propagacion.propagar.ejecutar(sesion, {
      productId: productId(cuerpo.productId),
      origen: locationId(cuerpo.origen),
      destinos: cuerpo.destinos.map((d): LocationId => locationId(d)),
    });

    return { id };
  }

  /**
   * Revertir NO borra nada: crea una versión nueva en cada ubicación con las
   * líneas de la que estaba vigente antes. Los costeos hechos entre medias
   * siguen siendo correctos porque usaron la receta que de verdad estaba
   * vigente entonces.
   */
  @Post('propagacion/:id/reversion')
  @Requiere('recipe.propagate')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revertir(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
  ): Promise<void> {
    await this.propagacion.revertir.ejecutar(sesion, recipePropagationId(id));
  }
}
