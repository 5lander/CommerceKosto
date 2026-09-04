/**
 * Módulo `catalog` — la fuente única de verdad (CLAUDE.md §2).
 *
 * NO EXPORTA EL REPOSITORIO, y esa es la parte que importa. Exporta los casos
 * de uso de LECTURA, que es lo que P3, P4 y P6 van a necesitar: el precio de
 * referencia lee ítems, la receta lee ítems, el inventario lee ítems. Ninguno
 * escribe. Si algún día un módulo necesitara crear un ítem, eso sería una
 * conversación, no un `import`.
 *
 * La regla `catalogo-solo-lo-escribe-catalog` de `audit:arch` lo hace cumplir
 * aunque alguien exporte de más.
 */

import { Module } from '@nestjs/common';

import { CrearArticulo, ListarArticulos } from './application/casos-de-uso/articulos';
import {
  ActualizarItem,
  CrearGrupo,
  CrearItem,
  LeerItem,
  ListarGrupos,
  ListarItems,
} from './application/casos-de-uso/items';
import { REPOSITORIO_DE_CATALOGO } from './application/ports/repositorio-de-catalogo.port';
import { ArticulosController } from './infrastructure/http/articulos.controller';
import { GestionDeGrupos } from './infrastructure/http/gestion-de-grupos';
import { ItemsController } from './infrastructure/http/items.controller';
import { PrismaCatalogoRepositorio } from './infrastructure/prisma-catalogo.repositorio';
import { DependenciasDeCatalogoNest } from './infrastructure/dependencias-de-catalogo';

@Module({
  controllers: [ItemsController, ArticulosController],
  providers: [
    { provide: REPOSITORIO_DE_CATALOGO, useClass: PrismaCatalogoRepositorio },
    DependenciasDeCatalogoNest,

    {
      provide: CrearItem,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): CrearItem => new CrearItem(deps),
    },
    {
      provide: ActualizarItem,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ActualizarItem => new ActualizarItem(deps),
    },
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
      provide: CrearArticulo,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): CrearArticulo => new CrearArticulo(deps),
    },
    {
      provide: ListarArticulos,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): ListarArticulos => new ListarArticulos(deps),
    },
    {
      provide: GestionDeGrupos,
      inject: [DependenciasDeCatalogoNest],
      useFactory: (deps: DependenciasDeCatalogoNest): GestionDeGrupos =>
        new GestionDeGrupos(new CrearGrupo(deps), new ListarGrupos(deps)),
    },
  ],
  exports: [LeerItem, ListarItems, ListarArticulos],
})
export class CatalogModule {}
