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
import { PeriodsModule } from '../periods/periods.module';
import { PricingModule } from '../pricing/pricing.module';
import { RecipesModule } from '../recipes/recipes.module';
import { RegistrarConsumoPorVenta } from './application/casos-de-uso/consumo';
import {
  CerrarPeriodoDelConteo,
  ConfirmarConteo,
  CrearConteo,
  GuardarLineasDeConteo,
  LeerConciliacion,
  LeerHojaDeConteo,
  ListarConteos,
} from './application/casos-de-uso/conteos';
import {
  ConsultarSaldos,
  ConsultarMovimiento,
  CorregirMovimiento,
  ListarMovimientos,
  RegistrarMovimiento,
} from './application/casos-de-uso/movimientos';
import { RegistrarProduccion } from './application/casos-de-uso/produccion';
import { RegistrarTransferencia } from './application/casos-de-uso/transferencias';
import {
  CalcularConsumoTeorico,
  ConsultarAgregadosDelPeriodo,
  ConsultarComprasPorArticulo,
  ConsultarConteoConfirmado,
} from './application/casos-de-uso/para-analitica';
import { REPOSITORIO_DE_CONTEOS } from './application/ports/repositorio-de-conteos.port';
import { RegistrarMovimientosEnLote } from './application/casos-de-uso/lotes';
import { REPOSITORIO_DE_INVENTARIO } from './application/ports/repositorio-de-inventario.port';
import { DependenciasDeInventarioNest } from './infrastructure/dependencias-de-inventario';
import {
  EscriturasDelLibro,
  InventarioController,
  LecturasDelLibro,
  ProduccionController,
} from './infrastructure/http/inventario.controller';
import {
  ConciliacionController,
  ConteosController,
  EscriturasDeConteo,
  LecturasDeConteo,
} from './infrastructure/http/conteos.controller';
import { PrismaConteosRepositorio } from './infrastructure/prisma-conteos.repositorio';
import { PrismaInventarioRepositorio } from './infrastructure/prisma-inventario.repositorio';

type Deps = DependenciasDeInventarioNest;

@Module({
  imports: [CatalogModule, PeriodsModule, PricingModule, RecipesModule],
  controllers: [
    InventarioController,
    ProduccionController,
    ConteosController,
    ConciliacionController,
  ],
  providers: [
    { provide: REPOSITORIO_DE_INVENTARIO, useClass: PrismaInventarioRepositorio },
    { provide: REPOSITORIO_DE_CONTEOS, useClass: PrismaConteosRepositorio },
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
      provide: ConsultarMovimiento,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ConsultarMovimiento => new ConsultarMovimiento(d),
    },

    {
      provide: ListarConteos,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ListarConteos => new ListarConteos(d),
    },
    {
      provide: LeerHojaDeConteo,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): LeerHojaDeConteo => new LeerHojaDeConteo(d),
    },
    {
      provide: LeerConciliacion,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): LeerConciliacion => new LeerConciliacion(d),
    },

    {
      provide: CalcularConsumoTeorico,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): CalcularConsumoTeorico => new CalcularConsumoTeorico(d),
    },
    {
      provide: ConsultarComprasPorArticulo,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ConsultarComprasPorArticulo => new ConsultarComprasPorArticulo(d),
    },
    {
      provide: ConsultarAgregadosDelPeriodo,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): ConsultarAgregadosDelPeriodo => new ConsultarAgregadosDelPeriodo(d),
    },
    {
      provide: ConsultarConteoConfirmado,
      inject: [DependenciasDeInventarioNest, LeerConciliacion],
      useFactory: (d: Deps, conciliacion: LeerConciliacion): ConsultarConteoConfirmado =>
        new ConsultarConteoConfirmado(d, conciliacion),
    },
    {
      provide: EscriturasDeConteo,
      inject: [DependenciasDeInventarioNest],
      useFactory: (d: Deps): EscriturasDeConteo =>
        new EscriturasDeConteo({
          crear: new CrearConteo(d),
          lineas: new GuardarLineasDeConteo(d),
          confirmar: new ConfirmarConteo(d),
          cierre: new CerrarPeriodoDelConteo(d),
        }),
    },
    {
      provide: LecturasDeConteo,
      inject: [ListarConteos, LeerHojaDeConteo],
      useFactory: (listar: ListarConteos, hoja: LeerHojaDeConteo): LecturasDeConteo =>
        new LecturasDeConteo(listar, hoja),
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
      inject: [ConsultarSaldos, ListarMovimientos, ConsultarMovimiento],
      useFactory: (
        saldos: ConsultarSaldos,
        movimientos: ListarMovimientos,
        movimiento: ConsultarMovimiento,
      ): LecturasDelLibro => new LecturasDelLibro(saldos, movimientos, movimiento),
    },
    {
      provide: RegistrarMovimientosEnLote,
      inject: [DependenciasDeInventarioNest],
      useFactory: (deps: DependenciasDeInventarioNest): RegistrarMovimientosEnLote =>
        new RegistrarMovimientosEnLote(deps),
    },
  ],
  exports: [RegistrarMovimientosEnLote, 
    ConsultarSaldos,
    ListarMovimientos,
    LeerConciliacion,
    ConsultarAgregadosDelPeriodo,
    ConsultarComprasPorArticulo,
    ConsultarConteoConfirmado,
    CalcularConsumoTeorico,
  ],
})
export class InventoryModule {}
