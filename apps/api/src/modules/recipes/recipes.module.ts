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
  ListarPropagaciones,
  PrevisualizarPropagacion,
  PropagarReceta,
  RevertirPropagacion,
} from './application/casos-de-uso/propagacion';
import { LeerComponentes, ReemplazarComponentes } from './application/casos-de-uso/componentes';
import { LeerProducto, ProductosDeUbicacion, UbicacionesDeProducto } from './application/casos-de-uso/productos';
import { AsignarEmpaque, LeerCarta } from './application/casos-de-uso/carta';
import {
  ConfigurarProductoEnUbicacion,
  CrearProducto,
  GuardarReceta,
  LeerReceta,
  ListarProductos,
  ListarVersionesDeReceta,
} from './application/casos-de-uso/recetas';
import { CrearProductosEnLote, GuardarRecetasEnLote } from './application/casos-de-uso/lotes';
import { REPOSITORIO_DE_RECETAS } from './application/ports/repositorio-de-recetas.port';
import { DependenciasDeRecetasNest } from './infrastructure/dependencias-de-recetas';
import { ComponentesController } from './infrastructure/http/componentes.controller';
import { EmpaqueController } from './infrastructure/http/empaque.controller';
import { FichasDeProductoController } from './infrastructure/http/fichas-de-producto.controller';
import { HistorialDeRecetasController } from './infrastructure/http/historial-de-recetas.controller';
import { Propagacion } from './infrastructure/http/propagacion';
import { ProductosController } from './infrastructure/http/productos.controller';
import { RecetasController } from './infrastructure/http/recetas.controller';
import { PrismaRecetasRepositorio } from './infrastructure/prisma-recetas.repositorio';

type Deps = DependenciasDeRecetasNest;

@Module({
  imports: [CatalogModule],
  controllers: [
    ProductosController,
    EmpaqueController,
    FichasDeProductoController,
    ComponentesController,
    RecetasController,
    HistorialDeRecetasController,
  ],
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
      provide: LeerCarta,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): LeerCarta => new LeerCarta(d),
    },
    {
      provide: AsignarEmpaque,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): AsignarEmpaque => new AsignarEmpaque(d),
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
    {
      provide: LeerProducto,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): LeerProducto => new LeerProducto(d),
    },
    {
      provide: UbicacionesDeProducto,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): UbicacionesDeProducto => new UbicacionesDeProducto(d),
    },
    {
      provide: ProductosDeUbicacion,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ProductosDeUbicacion => new ProductosDeUbicacion(d),
    },
    {
      provide: LeerComponentes,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): LeerComponentes => new LeerComponentes(d),
    },
    {
      provide: ReemplazarComponentes,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ReemplazarComponentes => new ReemplazarComponentes(d),
    },
    {
      provide: ListarPropagaciones,
      inject: [DependenciasDeRecetasNest],
      useFactory: (d: Deps): ListarPropagaciones => new ListarPropagaciones(d),
    },
    {
      provide: CrearProductosEnLote,
      inject: [DependenciasDeRecetasNest],
      useFactory: (deps: DependenciasDeRecetasNest): CrearProductosEnLote => new CrearProductosEnLote(deps),
    },
    {
      provide: GuardarRecetasEnLote,
      inject: [DependenciasDeRecetasNest],
      useFactory: (deps: DependenciasDeRecetasNest): GuardarRecetasEnLote => new GuardarRecetasEnLote(deps),
    },
  ],
  exports: [
    CrearProductosEnLote,
    GuardarRecetasEnLote,
    LeerCarta,
    LeerReceta,
    ListarProductos,
    ListarVersionesDeReceta,
  ],
})
export class RecipesModule {}
