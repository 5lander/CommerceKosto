/**
 * Módulo `periods` — el mes contable y su cierre (SPEC §3, D6).
 *
 * **NO IMPORTA NINGÚN OTRO MÓDULO DE NEGOCIO, Y ES DELIBERADO.** `inventory`
 * depende de `periods` —toda escritura del libro pregunta si el mes está
 * cerrado, y la confirmación del conteo es la que cierra— así que la flecha
 * tiene que apuntar en un solo sentido. Si `periods` mirara hacia `inventory`
 * para comprobar algo del conteo, habría un ciclo y `audit:arch` lo pararía;
 * peor aún, ninguno de los dos módulos podría razonarse por separado.
 *
 * Exporta las cuatro piezas que `inventory` necesita: asegurar el mes al abrir
 * un conteo, cerrarlo al confirmarlo, y la guarda que llaman las escrituras del
 * libro.
 */

import { Module } from '@nestjs/common';

import { RELOJ } from '../../shared/application/ports/reloj.port';
import { ZONA_HORARIA_DE_PERIODOS } from '../../shared/infrastructure/config/periods';
import { RelojDelSistema } from '../../shared/infrastructure/time/reloj-del-sistema';
import {
  AsegurarPeriodo,
  CerrarPeriodo,
  ConsultarPeriodo,
  ConsultarPeriodos,
  ExigirPeriodoAbierto,
  ReabrirPeriodo,
} from './application/casos-de-uso/periodos';
import { REPOSITORIO_DE_PERIODOS } from './application/ports/repositorio-de-periodos.port';
import { CalendarioDePeriodos } from './domain/periodo';
import {
  CALENDARIO_DE_PERIODOS,
  DependenciasDePeriodosNest,
} from './infrastructure/dependencias-de-periodos';
import { PeriodosController } from './infrastructure/http/periodos.controller';
import { PrismaPeriodosRepositorio } from './infrastructure/prisma-periodos.repositorio';

type Deps = DependenciasDePeriodosNest;

@Module({
  controllers: [PeriodosController],
  providers: [
    { provide: REPOSITORIO_DE_PERIODOS, useClass: PrismaPeriodosRepositorio },
    { provide: RELOJ, useClass: RelojDelSistema },
    {
      provide: CALENDARIO_DE_PERIODOS,
      useValue: new CalendarioDePeriodos(ZONA_HORARIA_DE_PERIODOS),
    },

    DependenciasDePeriodosNest,

    {
      provide: AsegurarPeriodo,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): AsegurarPeriodo => new AsegurarPeriodo(d),
    },
    {
      provide: CerrarPeriodo,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): CerrarPeriodo => new CerrarPeriodo(d),
    },
    {
      provide: ReabrirPeriodo,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): ReabrirPeriodo => new ReabrirPeriodo(d),
    },
    {
      provide: ConsultarPeriodo,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): ConsultarPeriodo => new ConsultarPeriodo(d),
    },
    {
      provide: ConsultarPeriodos,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): ConsultarPeriodos => new ConsultarPeriodos(d),
    },
    {
      provide: ExigirPeriodoAbierto,
      inject: [DependenciasDePeriodosNest],
      useFactory: (d: Deps): ExigirPeriodoAbierto => new ExigirPeriodoAbierto(d),
    },
  ],
  exports: [
    AsegurarPeriodo,
    CerrarPeriodo,
    ConsultarPeriodo,
    ExigirPeriodoAbierto,
    CALENDARIO_DE_PERIODOS,
  ],
})
export class PeriodsModule {}
