/**
 * El costeo — SPEC §14.
 *
 * **`BODEGA` NO TIENE `costing.read`**, y es la regla de CLAUDE.md §4.3: costo
 * de plato, margen y food cost son derivados de la receta y permiten despejarla
 * por aritmética. El filtrado va en la API, no en el frontend — aquí, en una
 * fila de `role_permission` que la migración de P5 no escribe.
 *
 * **`GERENTE_LOCAL` SÍ LO TIENE**, y su límite es la ubicación, no el permiso:
 * puede costear su local y recibe 403 sobre otro. Esa mitad la decide
 * `exigirUbicacionEnAlcance` dentro de `LeerCarta`, porque RLS no sabe nada de
 * alcances dentro de una company.
 *
 * **`fecha` ES PARÁMETRO, NO «AHORA»** (criterio E8): pedir el costeo del mes
 * pasado devuelve los precios y las recetas que estaban vigentes entonces, y no
 * los de hoy. Es lo que hace que un costeo histórico siga siendo el mismo
 * número dentro de un año.
 */

import { Controller, Get, Param, Query } from '@nestjs/common';

import { locationId, productId } from '../../../../shared/domain/identity/identificadores';
import { Money } from '../../../../shared/domain/money/tipos-monetarios';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { IdentificadorDeRuta } from '../../../../shared/infrastructure/http/identificador-de-ruta.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { CostearCarta, CostearUnProducto } from '../../application/casos-de-uso/costear';
import {
  CONSULTA_DE_COSTEO,
  CONSULTA_DE_COSTEO_DE_PRODUCTO,
  type ConsultaDeCosteo,
  type ConsultaDeCosteoDeProducto,
  type CosteoDeCartaDto,
  type ProductoSimuladoDto,
} from './costeo.dto';
import { comoCarta, comoProducto } from './presentacion';

function fechaDe(consulta: ConsultaDeCosteo): Date {
  return consulta.fecha === undefined ? new Date() : new Date(consulta.fecha);
}

/** D-16.106: el desglose con cantidades es la receta, y solo lo ve quien puede leerla. */
function puedeVerLaReceta(sesion: SesionActiva): boolean {
  return sesion.permisos.includes('recipe.read');
}

@Controller('costeo')
export class CosteoController {
  public constructor(
    private readonly carta: CostearCarta,
    private readonly unProducto: CostearUnProducto,
  ) {}

  /** La carta entera de una ubicación, costeada a una fecha. */
  @Get()
  @Requiere('costing.read')
  public async completa(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_COSTEO)) consulta: ConsultaDeCosteo,
  ): Promise<CosteoDeCartaDto> {
    const resultado = await this.carta.ejecutar(sesion, {
      locationId: locationId(consulta.locationId),
      fecha: fechaDe(consulta),
    });

    return comoCarta(resultado, puedeVerLaReceta(sesion));
  }

  @Get(':productId')
  @Requiere('costing.read')
  public async deUnProducto(
    @SesionActual() sesion: SesionActiva,
    @Param('productId', IdentificadorDeRuta) id: string,
    @Query(new EsquemaPipe(CONSULTA_DE_COSTEO_DE_PRODUCTO)) consulta: ConsultaDeCosteoDeProducto,
  ): Promise<ProductoSimuladoDto> {
    const pvpSimulado = consulta.pvp === undefined ? null : Money.fromDecimalString(consulta.pvp);
    const resultado = await this.unProducto.ejecutar(sesion, {
      productId: productId(id),
      locationId: locationId(consulta.locationId),
      fecha: fechaDe(consulta),
      pvpSimulado,
    });

    return { ...comoProducto(resultado, puedeVerLaReceta(sesion)), pvpSimulado: consulta.pvp ?? null };
  }
}
