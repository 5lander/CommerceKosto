/**
 * Módulo `pricing` — precios de referencia con vigencia (SPEC §6, R5).
 *
 * EXPORTA `CostoDeItem`, que es lo que P5 necesita: el costo por unidad de uso
 * de un ítem a una fecha, con la cadena de SPEC §12 aplicada. El motor de
 * costeo no va a consultar precios: va a recibir costos ya resueltos, que es lo
 * que le permite ser dominio puro y probarse con la base apagada.
 */

import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import { ActualizarAjustes, LeerAjustes } from './application/casos-de-uso/ajustes';
import { CostosDeItems } from './application/casos-de-uso/costos-de-items';
import { PreciosPendientes } from './application/casos-de-uso/pendientes';
import {
  CostoDeItem,
  HistorialDePrecios,
  ResolverPrecio,
  SugerirPrecio,
} from './application/casos-de-uso/precios';
import { SugerirPreciosEnLote } from './application/casos-de-uso/lotes';
import { REPOSITORIO_DE_PRECIOS } from './application/ports/repositorio-de-precios.port';
import { DependenciasDePreciosNest } from './infrastructure/dependencias-de-precios';
import { AjustesController } from './infrastructure/http/ajustes.controller';
import { PreciosController } from './infrastructure/http/precios.controller';
import { LecturasDePrecios } from './infrastructure/http/lecturas-de-precios';
import { ResolucionYCosto } from './infrastructure/http/resolucion-y-costo';
import { PrismaPreciosRepositorio } from './infrastructure/prisma-precios.repositorio';

@Module({
  // `pricing` LEE el catalogo por sus puertos, nunca por sus tablas.
  imports: [CatalogModule],
  controllers: [PreciosController, AjustesController],
  providers: [
    { provide: REPOSITORIO_DE_PRECIOS, useClass: PrismaPreciosRepositorio },
    // `RELOJ` lo provee también `iam`; declararlo aquí hace que `pricing` no
    // dependa del orden de importación de los módulos para arrancar.
    { provide: RELOJ, useClass: RelojDelSistema },

    DependenciasDePreciosNest,

    {
      provide: SugerirPrecio,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): SugerirPrecio => new SugerirPrecio(deps),
    },
    {
      provide: LecturasDePrecios,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): LecturasDePrecios =>
        new LecturasDePrecios(new HistorialDePrecios(deps), new PreciosPendientes(deps), new CostosDeItems(deps)),
    },
    {
      provide: CostoDeItem,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): CostoDeItem => new CostoDeItem(deps),
    },
    {
      provide: ResolucionYCosto,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): ResolucionYCosto =>
        new ResolucionYCosto(new ResolverPrecio(deps), new CostoDeItem(deps)),
    },
    {
      provide: CostosDeItems,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): CostosDeItems => new CostosDeItems(deps),
    },
    {
      provide: LeerAjustes,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): LeerAjustes => new LeerAjustes(deps),
    },
    {
      provide: ActualizarAjustes,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): ActualizarAjustes =>
        new ActualizarAjustes(deps),
    },
    {
      provide: SugerirPreciosEnLote,
      inject: [DependenciasDePreciosNest],
      useFactory: (deps: DependenciasDePreciosNest): SugerirPreciosEnLote => new SugerirPreciosEnLote(deps),
    },
  ],
  exports: [SugerirPreciosEnLote, CostoDeItem, CostosDeItems, LeerAjustes],
})
export class PricingModule {}
