/**
 * Módulo `costing` — el motor de costeo (SPEC §12 a §14).
 *
 * **NO TIENE REPOSITORIO NI TOCA UNA TABLA.** El motor es dominio puro y todo
 * lo que necesita se lo dan `recipes`, `pricing` y `catalog` por sus casos de
 * uso exportados. Es lo que permite probarlo entero con PostgreSQL apagado, que
 * es el criterio arquitectónico de CLAUDE.md §2.
 *
 * IMPORTA LOS TRES por sus módulos, nunca por su infraestructura: la regla
 * `catalogo-solo-lo-escribe-catalog` de `dependency-cruiser` lo hace cumplir.
 */

import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { RecipesModule } from '../recipes/recipes.module';
import { CostearCarta, CostearUnProducto } from './application/casos-de-uso/costear';
import { DependenciasDeCosteoNest } from './infrastructure/dependencias-de-costeo';
import { CosteoController } from './infrastructure/http/costeo.controller';

type Deps = DependenciasDeCosteoNest;

@Module({
  imports: [CatalogModule, PricingModule, RecipesModule],
  controllers: [CosteoController],
  providers: [
    DependenciasDeCosteoNest,
    {
      provide: CostearCarta,
      inject: [DependenciasDeCosteoNest],
      useFactory: (d: Deps): CostearCarta => new CostearCarta(d),
    },
    {
      // Costear uno pasa por costear todos, a propósito: dos rutas para el
      // mismo número son dos oportunidades de que den respuestas distintas.
      provide: CostearUnProducto,
      inject: [CostearCarta],
      useFactory: (carta: CostearCarta): CostearUnProducto => new CostearUnProducto(carta),
    },
  ],
})
export class CostingModule {}
