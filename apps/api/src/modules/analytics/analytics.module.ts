/**
 * Módulo `analytics` — las seis vistas del Excel (SPEC §15 a §18).
 *
 * **IMPORTA CUATRO MÓDULOS Y NO EXPORTA NINGÚN CASO DE USO.** Es el final de la
 * cadena: nadie construye encima de las vistas. Si algún día P9 necesita
 * agregarlas por company, lo hará consumiendo estos casos de uso — y entonces
 * habrá que exportarlos, no duplicar el cálculo.
 *
 * La flecha va en un solo sentido, como en todo el sistema: `analytics` depende
 * de `costing`, `inventory`, `periods` y `pricing`, y ninguno depende de él.
 */

import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { CostingModule } from '../costing/costing.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PeriodsModule } from '../periods/periods.module';
import { PricingModule } from '../pricing/pricing.module';
import {
  ConsultarCostosFijos,
  ConsultarVentas,
  RegistrarCostosFijos,
  RegistrarVentas,
} from './application/casos-de-uso/carga';
import {
  ConsultarFoodCostReal,
  ConsultarInventarioValorizado,
  ConsultarMenuEngineering,
  ConsultarPuntoDeEquilibrio,
  ConsultarReposicion,
  ConsultarResumen,
} from './application/casos-de-uso/vistas';
import { REPOSITORIO_DE_ANALITICA } from './application/ports/repositorio-de-analitica.port';
import { DependenciasDeAnaliticaNest } from './infrastructure/dependencias-de-analitica';
import {
  AnaliticaController,
  CargaController,
  CargasDelMes,
  ReposicionController,
  VistasDelMes,
} from './infrastructure/http/analitica.controller';
import { PrismaAnaliticaRepositorio } from './infrastructure/prisma-analitica.repositorio';

type Deps = DependenciasDeAnaliticaNest;

@Module({
  imports: [CatalogModule, CostingModule, InventoryModule, PeriodsModule, PricingModule],
  controllers: [CargaController, AnaliticaController, ReposicionController],
  providers: [
    { provide: REPOSITORIO_DE_ANALITICA, useClass: PrismaAnaliticaRepositorio },

    DependenciasDeAnaliticaNest,

    {
      provide: ConsultarReposicion,
      inject: [DependenciasDeAnaliticaNest],
      useFactory: (d: Deps): ConsultarReposicion => new ConsultarReposicion(d),
    },
    {
      provide: CargasDelMes,
      inject: [DependenciasDeAnaliticaNest],
      useFactory: (d: Deps): CargasDelMes =>
        new CargasDelMes({
          ventas: new RegistrarVentas(d),
          costos: new RegistrarCostosFijos(d),
          leerVentas: new ConsultarVentas(d),
          leerCostos: new ConsultarCostosFijos(d),
        }),
    },
    {
      provide: VistasDelMes,
      inject: [DependenciasDeAnaliticaNest],
      useFactory: (d: Deps): VistasDelMes =>
        new VistasDelMes({
          menu: new ConsultarMenuEngineering(d),
          foodCost: new ConsultarFoodCostReal(d),
          equilibrio: new ConsultarPuntoDeEquilibrio(d),
          inventario: new ConsultarInventarioValorizado(d),
          resumen: new ConsultarResumen(d),
        }),
    },
  ],
})
export class AnalyticsModule {}
