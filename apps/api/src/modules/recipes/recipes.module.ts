/**
 * Módulo `recipes` — productos, recetas versionadas y propagación.
 *
 * IMPORTA `CatalogModule` porque lee ítems por su puerto, nunca por sus tablas
 * (CLAUDE.md §2). No importa `PricingModule`: el costo de cada línea lo calcula
 * el motor de P5 con los costos ya resueltos, no `recipes`.
 *
 * EXPORTA `LeerReceta`, que es lo que P5 va a necesitar: la receta vigente de
 * un producto en una ubicación **a una fecha**. El motor de costeo recibe la
 * receta y los costos; no consulta nada.
 */

import { Module } from '@nestjs/common';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import { CatalogModule } from '../catalog/catalog.module';
import {
  PrevisualizarPropagacion,
  PropagarReceta,
  RevertirPropagacion,
} from './application/casos-de-uso/propagacion';
import {
  ConfigurarProductoEnUbicacion,
  CrearProducto,
  GuardarReceta,
  LeerReceta,
  ListarProductos,
  ListarVersionesDeReceta,
} from './application/casos-de-uso/recetas';
import { REPOSITORIO_DE_RECETAS } from './application/ports/repositorio-de-recetas.port';
import { DependenciasDeRecetasNest } from './infrastructure/dependencias-de-recetas';
import { Propagacion } from './infrastructure/http/propagacion';
import { ProductosController } from './infrastructure/http/productos.controller';
import { RecetasController } from './infrastructure/http/recetas.controller';
import { PrismaRecetasRepositorio } from './infrastructure/prisma-recetas.repositorio';

type Deps = DependenciasDeRecetasNest;

@Module({
  imports: [CatalogModule],
  controllers: [ProductosController, RecetasController],
  providers: [
    { provide: REPOSITORIO_DE_RECETAS, useClass: PrismaRecetasRepositorio },
    { provide: RELOJ, useClass: RelojDelSistema },

    DependenciasDeRecetasNest,

    {
      provide: CrearProducto,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): CrearProducto => new CrearProducto(d),
    },
    {
      provide: ListarProductos,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ListarProductos => new ListarProductos(d),
    },
    {
      provide: ConfigurarProductoEnUbicacion,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ConfigurarProductoEnUbicacion => new ConfigurarProductoEnUbicacion(d),
    },
    {
      provide: GuardarReceta,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): GuardarReceta => new GuardarReceta(d),
    },
    {
      provide: LeerReceta,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): LeerReceta => new LeerReceta(d),
    },
    {
      provide: ListarVersionesDeReceta,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ListarVersionesDeReceta => new ListarVersionesDeReceta(d),
    },
    {
      provide: Propagacion,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): Propagacion =>
        new Propagacion(
          new PrevisualizarPropagacion(d),
          new PropagarReceta(d),
          new RevertirPropagacion(d),
        ),
    },
  ],
  exports: [LeerReceta, ListarVersionesDeReceta],
})
export class RecipesModule {}
