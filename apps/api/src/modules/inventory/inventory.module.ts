/**
 * Módulo `inventory` — el libro mayor append-only (SPEC §7, R2 y R3).
 *
 * IMPORTA `CatalogModule`, `PricingModule` y `RecipesModule`, y los tres por su
 * puerto: la unidad de uso y el interruptor de stock de cada ítem, el costo
 * estándar que R10 necesita, y la receta que el consumo por venta explota.
 * Ninguna consulta de aquí toca sus tablas (CLAUDE.md §2).
 *
 * NO IMPORTA `CostingModule`. El motor de costeo consume el libro —lo hará en
 * P8 para el food cost real— y no al revés: si el inventario dependiera del
 * costeo, un cambio en una fórmula podría mover un saldo.
 *
 * EXPORTA las lecturas, que es lo que P7 (conteo físico) y P8 (food cost real,
 * inventario valorizado) van a necesitar.
 */

import { Module } from '@nestjs/common';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import { CatalogModule } from '../catalog/catalog.module';
import { PricingModule } from '../pricing/pricing.module';
import { RecipesModule } from '../recipes/recipes.module';
import { RegistrarConsumoPorVenta } from './application/casos-de-uso/consumo';
import {
  ConsultarSaldos,
  CorregirMovimiento,
  ListarMovimientos,
  RegistrarMovimiento,
} from './application/casos-de-uso/movimientos';
import { RegistrarProduccion } from './application/casos-de-uso/produccion';
import { RegistrarTransferencia } from './application/casos-de-uso/transferencias';
import { REPOSITORIO_DE_INVENTARIO } from './application/ports/repositorio-de-inventario.port';
import { DependenciasDeInventarioNest } from './infrastructure/dependencias-de-inventario';
import {
  EscriturasDelLibro,
  InventarioController,
  LecturasDelLibro,
  ProduccionController,
} from './infrastructure/http/inventario.controller';
import { PrismaInventarioRepositorio } from './infrastructure/prisma-inventario.repositorio';

type Deps = DependenciasDeInventarioNest;

@Module({
  imports: [CatalogModule, PricingModule, RecipesModule],
  controllers: [InventarioController, ProduccionController],
  providers: [
    { provide: REPOSITORIO_DE_INVENTARIO, useClass: PrismaInventarioRepositorio },
    { provide: RELOJ, useClass: RelojDelSistema },

    DependenciasDeInventarioNest,

    {
      provide: RegistrarMovimiento,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): RegistrarMovimiento => new RegistrarMovimiento(d),
    },
    {
      provide: CorregirMovimiento,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): CorregirMovimiento => new CorregirMovimiento(d),
    },
    {
      provide: RegistrarTransferencia,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): RegistrarTransferencia => new RegistrarTransferencia(d),
    },
    {
      provide: RegistrarProduccion,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): RegistrarProduccion => new RegistrarProduccion(d),
    },
    {
      provide: RegistrarConsumoPorVenta,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): RegistrarConsumoPorVenta => new RegistrarConsumoPorVenta(d),
    },
    {
      provide: ConsultarSaldos,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ConsultarSaldos => new ConsultarSaldos(d),
    },
    {
      provide: ListarMovimientos,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ListarMovimientos => new ListarMovimientos(d),
    },

    {
      provide: EscriturasDelLibro,
      inject: [RegistrarMovimiento, CorregirMovimiento, RegistrarTransferencia],
      useFactory: (
        movimiento: RegistrarMovimiento,
        correccion: CorregirMovimiento,
        transferencia: RegistrarTransferencia,
      ): EscriturasDelLibro => new EscriturasDelLibro(movimiento, correccion, transferencia),
    },
    {
      provide: LecturasDelLibro,
      inject: [ConsultarSaldos, ListarMovimientos],
      useFactory: (saldos: ConsultarSaldos, movimientos: ListarMovimientos): LecturasDelLibro =>
        new LecturasDelLibro(saldos, movimientos),
    },
  ],
  exports: [ConsultarSaldos, ListarMovimientos],
})
export class InventoryModule {}
