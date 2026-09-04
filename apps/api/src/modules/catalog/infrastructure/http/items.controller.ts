/**
 * Ítems y grupos.
 *
 * `catalog.read` para leer, `catalog.create` y `catalog.update` para escribir.
 * `GERENTE_LOCAL` y `BODEGA` solo tienen la primera: necesitan ver los ítems
 * para contar inventario (P7), y un ítem no revela ninguna receta — lo que
 * CLAUDE.md §4.3 protege son las líneas de receta y los derivados del consumo,
 * que llegan en P4 y P6.
 *
 * SIN ALCANCE POR UBICACIÓN, y es deliberado: el catálogo es de la company
 * entera (SPEC §5). Un ítem no pertenece a un local. Lo que sí es por ubicación
 * son el precio de referencia (P3), la receta (P4) y el inventario (P6).
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';

import { itemGroupId, itemId, type ItemId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { ActualizarItem, CrearItem, ListarItems } from '../../application/casos-de-uso/items';
import type { ItemLeido } from '../../application/ports/repositorio-de-catalogo.port';
import {
  CUERPO_DE_CAMBIO_DE_ITEM,
  CUERPO_DE_ITEM,
  type CuerpoDeCambioDeItem,
  type CuerpoDeItem,
} from './catalogo.dto';

export interface ItemCreado {
  readonly id: ItemId;
}

@Controller('catalogo/items')
export class ItemsController {
  public constructor(
    private readonly crearItem: CrearItem,
    private readonly listarItems: ListarItems,
    private readonly actualizarItem: ActualizarItem,
  ) {}

  @Get()
  @Requiere('catalog.read')
  public listar(
    @SesionActual() sesion: SesionActiva,
    @Query('incluirInactivos') incluirInactivos?: string,
  ): Promise<readonly ItemLeido[]> {
    return this.listarItems.ejecutar(sesion, incluirInactivos !== 'true');
  }

  @Post()
  @Requiere('catalog.create')
  @HttpCode(HttpStatus.CREATED)
  public async crear(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_ITEM)) cuerpo: CuerpoDeItem,
  ): Promise<ItemCreado> {
    const id = await this.crearItem.ejecutar(sesion, {
      nombre: cuerpo.nombre,
      tipo: cuerpo.tipo,
      unidadDeUso: cuerpo.unidadDeUso,
      rendimiento: cuerpo.rendimiento,
      grupoId: cuerpo.grupoId === null ? null : itemGroupId(cuerpo.grupoId),
      confianzaDePrecio: cuerpo.confianzaDePrecio,
      llevaStock: cuerpo.llevaStock,
    });

    return { id };
  }

  /**
   * `PUT` y no `PATCH`: el cuerpo trae el estado completo del ítem editable.
   * Un `PATCH` con campos opcionales haría que «no mandé el grupo» y «quiero
   * quitarle el grupo» fueran la misma petición.
   */
  @Put(':id')
  @Requiere('catalog.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async actualizar(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_ITEM)) cuerpo: CuerpoDeCambioDeItem,
  ): Promise<void> {
    await this.actualizarItem.ejecutar(sesion, {
      itemId: itemId(id),
      nombre: cuerpo.nombre,
      rendimiento: cuerpo.rendimiento,
      grupoId: cuerpo.grupoId === null ? null : itemGroupId(cuerpo.grupoId),
      confianzaDePrecio: cuerpo.confianzaDePrecio,
      estado: cuerpo.estado,
    });
  }
}
