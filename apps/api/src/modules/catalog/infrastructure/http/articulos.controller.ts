/**
 * Artículos de compra y grupos de ítems.
 *
 * VAN JUNTOS EN UN CONTROLADOR y no en dos porque los dos son recursos
 * secundarios del catálogo con la misma autorización y dos rutas cada uno.
 * Separarlos daría dos clases de veinte líneas con la misma cabecera.
 *
 * `factorDeConversion` NO SE ACEPTA EN LA PETICIÓN. Lo calcula el dominio. Lo
 * que se puede aceptar es `factorExplicito`, que es otra cosa: cuántas unidades
 * de uso salen de UNA de compra, y solo hace falta cuando las dimensiones no
 * coinciden — un huevo pesa 50 g, y eso no lo deduce ninguna física.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';

import {
  itemId,
  type ItemGroupId,
  type PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { CrearArticulo, ListarArticulos } from '../../application/casos-de-uso/articulos';
import type { ArticuloLeido, GrupoLeido } from '../../application/ports/repositorio-de-catalogo.port';
import { CUERPO_DE_ARTICULO, CUERPO_DE_GRUPO, type CuerpoDeArticulo, type CuerpoDeGrupo } from './catalogo.dto';
import { GestionDeGrupos } from './gestion-de-grupos';

export interface ArticuloCreado {
  readonly id: PurchaseArticleId;
}

export interface GrupoCreado {
  readonly id: ItemGroupId;
}

@Controller('catalogo')
export class ArticulosController {
  public constructor(
    private readonly crearArticulo: CrearArticulo,
    private readonly listarArticulos: ListarArticulos,
    private readonly grupos: GestionDeGrupos,
  ) {}

  @Get('articulos')
  @Requiere('catalog.read')
  public listar(
    @SesionActual() sesion: SesionActiva,
    @Query('itemId') item?: string,
  ): Promise<readonly ArticuloLeido[]> {
    return this.listarArticulos.ejecutar(sesion, item === undefined ? null : itemId(item));
  }

  @Post('articulos')
  @Requiere('catalog.create')
  @HttpCode(HttpStatus.CREATED)
  public async crear(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_ARTICULO)) cuerpo: CuerpoDeArticulo,
  ): Promise<ArticuloCreado> {
    const id = await this.crearArticulo.ejecutar(sesion, {
      itemId: itemId(cuerpo.itemId),
      nombre: cuerpo.nombre,
      marca: cuerpo.marca,
      proveedor: cuerpo.proveedor,
      presentacion: cuerpo.presentacion,
      unidadDePresentacion: cuerpo.unidadDePresentacion,
      factorExplicito: cuerpo.factorExplicito,
    });

    return { id };
  }

  @Get('grupos')
  @Requiere('catalog.read')
  public listarGrupos(@SesionActual() sesion: SesionActiva): Promise<readonly GrupoLeido[]> {
    return this.grupos.listar.ejecutar(sesion);
  }

  @Post('grupos')
  @Requiere('catalog.create')
  @HttpCode(HttpStatus.CREATED)
  public async crearGrupo(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_GRUPO)) cuerpo: CuerpoDeGrupo,
  ): Promise<GrupoCreado> {
    return { id: await this.grupos.crear.ejecutar(sesion, cuerpo.nombre) };
  }
}
