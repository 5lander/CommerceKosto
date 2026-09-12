/**
 * Artículos de compra y grupos de ítems.
 *
 * VAN JUNTOS EN UN CONTROLADOR y no en dos porque los dos son recursos
 * secundarios del catálogo con la misma autorización y tres rutas cada uno.
 * Separarlos daría dos clases de veinte líneas con la misma cabecera.
 *
 * `factorDeConversion` NO SE ACEPTA EN LA PETICIÓN. Lo calcula el dominio. Lo
 * que se puede aceptar es `factorExplicito`, que es otra cosa: cuántas unidades
 * de uso salen de UNA de compra, y solo hace falta cuando las dimensiones no
 * coinciden — un huevo pesa 50 g, y eso no lo deduce ninguna física.
 *
 * **`ivaTarifa` ES DEL ARTÍCULO Y ES OBLIGATORIA AL CREARLO** (D-16.9): la
 * factura del saco de harina dice 0 % y la del detergente 15 %. En el grupo es
 * opcional: `null` significa «el grupo no define», y una compra sin artículo
 * de un ítem de ese grupo se rechaza. Nunca se asume una tarifa.
 *
 * Los dos `PUT` existen desde P16-A1 (D-16.45) porque sin ellos la semilla
 * `0.15` de los artículos anteriores no se podría corregir.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';

import {
  itemGroupId,
  itemId,
  purchaseArticleId,
  type ItemGroupId,
  type PurchaseArticleId,
} from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { LeerFichaDeArticulo, type FichaDeArticulo } from '../../application/casos-de-uso/fichas';
import type { ArticuloLeido, GrupoLeido } from '../../application/ports/repositorio-de-catalogo.port';
import {
  CONSULTA_DE_ARTICULOS,
  CUERPO_DE_ARTICULO,
  CUERPO_DE_CAMBIO_DE_ARTICULO,
  CUERPO_DE_CAMBIO_DE_GRUPO,
  CUERPO_DE_GRUPO,
  type ConsultaDeArticulos,
  type CuerpoDeArticulo,
  type CuerpoDeCambioDeArticulo,
  type CuerpoDeCambioDeGrupo,
  type CuerpoDeGrupo,
} from './catalogo.dto';
import { GestionDeArticulos } from './gestion-de-articulos';
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
    private readonly articulos: GestionDeArticulos,
    private readonly grupos: GestionDeGrupos,
    private readonly ficha: LeerFichaDeArticulo,
  ) {}

  @Get('articulos')
  @Requiere('catalog.read')
  public listar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_ARTICULOS)) consulta: ConsultaDeArticulos,
  ): Promise<readonly ArticuloLeido[]> {
    return this.articulos.listar.ejecutar(sesion, consulta.itemId === undefined ? null : itemId(consulta.itemId));
  }

  /**
   * LA FICHA DEL ARTICULO: el artículo con su ítem dentro, que es lo que la
   * pantalla titula. Un id ajeno es **404**, igual que uno inexistente: la
   * company va en el WHERE de la lectura (CLAUDE.md §4.4).
   */
  @Get('articulos/:id')
  @Requiere('catalog.read')
  public leer(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
  ): Promise<FichaDeArticulo> {
    return this.ficha.ejecutar(sesion, purchaseArticleId(id));
  }

  @Post('articulos')
  @Requiere('catalog.create')
  @HttpCode(HttpStatus.CREATED)
  public async crear(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_ARTICULO)) cuerpo: CuerpoDeArticulo,
  ): Promise<ArticuloCreado> {
    const id = await this.articulos.crear.ejecutar(sesion, {
      itemId: itemId(cuerpo.itemId),
      nombre: cuerpo.nombre,
      marca: cuerpo.marca,
      proveedor: cuerpo.proveedor,
      presentacion: cuerpo.presentacion,
      unidadDePresentacion: cuerpo.unidadDePresentacion,
      factorExplicito: cuerpo.factorExplicito,
      ivaTarifa: cuerpo.ivaTarifa,
    });

    return { id };
  }

  /**
   * `PUT` y no `PATCH`, como en los ítems: el cuerpo trae el estado completo
   * de lo editable. La presentación, su unidad y el factor no se editan: ver
   * `ActualizarArticulo`.
   */
  @Put('articulos/:id')
  @Requiere('catalog.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async actualizar(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_ARTICULO)) cuerpo: CuerpoDeCambioDeArticulo,
  ): Promise<void> {
    await this.articulos.actualizar.ejecutar(sesion, {
      articuloId: purchaseArticleId(id),
      nombre: cuerpo.nombre,
      marca: cuerpo.marca,
      proveedor: cuerpo.proveedor,
      ivaTarifa: cuerpo.ivaTarifa,
      estado: cuerpo.estado,
    });
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
    return { id: await this.grupos.crear.ejecutar(sesion, cuerpo) };
  }

  @Put('grupos/:id')
  @Requiere('catalog.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async actualizarGrupo(
    @SesionActual() sesion: SesionActiva,
    @Param('id') id: string,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_GRUPO)) cuerpo: CuerpoDeCambioDeGrupo,
  ): Promise<void> {
    await this.grupos.actualizar.ejecutar(sesion, { grupoId: itemGroupId(id), ...cuerpo });
  }
}
