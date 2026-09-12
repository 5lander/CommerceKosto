/**
 * Módulo `catalog` — la fuente única de verdad (CLAUDE.md §2).
 *
 * NO EXPORTA EL REPOSITORIO, y esa es la parte que importa. Exporta los casos
 * de uso de LECTURA, que es lo que P3, P4 y P6 van a necesitar: el precio de
 * referencia lee ítems, la receta lee ítems, el inventario lee ítems. Ninguno
 * escribe. Si algún día un módulo necesitara crear un ítem, eso sería una
 * conversación, no un `import`.
 *
 * Desde P16-A1 exporta también `TarifasDeIva` y `ListarGrupos`: son las dos
 * lecturas por las que `inventory` y `pricing` resuelven la tarifa de IVA de
 * una compra (D-16.9) sin tocar `purchase_article` ni `item_group`.
 *
 * La regla `catalogo-solo-lo-escribe-catalog` de `audit:arch` lo hace cumplir
 * aunque alguien exporte de más.
 */

import { Module } from '@nestjs/common';

import {
  ActualizarArticulo,
  CrearArticulo,
  ListarArticulos,
} from './application/casos-de-uso/articulos';
import { LeerFichaDeArticulo, LeerFichaDeItem } from './application/casos-de-uso/fichas';
import { CrearArticulosEnLote, CrearItemsEnLote } from './application/casos-de-uso/lotes';
import {
  ActualizarGrupo,
  ActualizarItem,
  CrearGrupo,
  CrearItem,
  LeerItem,
  ListarGrupos,
  ListarItems,
} from './application/casos-de-uso/items';
import { TarifasDeIva } from './application/casos-de-uso/tarifas-de-iva';
import { ListarUnidades } from './application/casos-de-uso/unidades';
import { REPOSITORIO_DE_CATALOGO } from './application/ports/repositorio-de-catalogo.port';
import { ArticulosController } from './infrastructure/http/articulos.controller';
import { GestionDeArticulos } from './infrastructure/http/gestion-de-articulos';
import { GestionDeGrupos } from './infrastructure/http/gestion-de-grupos';
import { GestionDeItems } from './infrastructure/http/gestion-de-items';
import { ItemsController } from './infrastructure/http/items.controller';
import { UnidadesController } from './infrastructure/http/unidades.controller';
import { PrismaCatalogoRepositorio } from './infrastructure/prisma-catalogo.repositorio';
import { DependenciasDeCatalogoNest } from './infrastructure/dependencias-de-catalogo';

@Module({
  controllers: [ItemsController, ArticulosController, UnidadesController],
  providers: [
    { provide: REPOSITORIO_DE_CATALOGO, useClass: PrismaCatalogoRepositorio },
    DependenciasDeCatalogoNest,

    {
      provide: LeerItem,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): LeerItem => new LeerItem(deps),
    },
    {
      provide: ListarItems,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ListarItems => new ListarItems(deps),
    },
    {
      provide: ListarArticulos,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ListarArticulos => new ListarArticulos(deps),
    },
    {
      provide: ListarGrupos,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ListarGrupos => new ListarGrupos(deps),
    },
    {
      provide: TarifasDeIva,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): TarifasDeIva => new TarifasDeIva(deps),
    },
    {
      provide: ListarUnidades,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ListarUnidades => new ListarUnidades(deps),
    },
    {
      provide: LeerFichaDeItem,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): LeerFichaDeItem => new LeerFichaDeItem(deps),
    },
    {
      provide: LeerFichaDeArticulo,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): LeerFichaDeArticulo =>
        new LeerFichaDeArticulo(deps),
    },
    {
      provide: GestionDeItems,
      inject: [DependenciasDeCatalogoNest, ListarItems],
      useFactory: (deps: DependenciasDeCatalogoNest, listar: ListarItems): GestionDeItems =>
        new GestionDeItems(new CrearItem(deps), listar, new ActualizarItem(deps)),
    },
    {
      provide: GestionDeArticulos,
      inject: [DependenciasDeCatalogoNest, ListarArticulos],
      useFactory: (deps: DependenciasDeCatalogoNest, listar: ListarArticulos): GestionDeArticulos =>
        new GestionDeArticulos(new CrearArticulo(deps), listar, new ActualizarArticulo(deps)),
    },
    {
      provide: GestionDeGrupos,
      inject: [DependenciasDeCatalogoNest, ListarGrupos],
      useFactory: (deps: DependenciasDeCatalogoNest, listar: ListarGrupos): GestionDeGrupos =>
        new GestionDeGrupos(new CrearGrupo(deps), listar, new ActualizarGrupo(deps)),
    },
    {
      provide: CrearItemsEnLote,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): CrearItemsEnLote =>
        new CrearItemsEnLote(deps),
    },
    {
      provide: CrearArticulosEnLote,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): CrearArticulosEnLote =>
        new CrearArticulosEnLote(deps),
    },
  ],
  exports: [
    CrearItemsEnLote,
    CrearArticulosEnLote,
    LeerItem,
    ListarItems,
    ListarArticulos,
    ListarGrupos,
    TarifasDeIva,
  ],
})
export class CatalogModule {}
