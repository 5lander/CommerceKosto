/**
 * Módulo `imports`.
 *
 * **NO TIENE CONTROLADOR, Y ES UNA DECISIÓN DE ALCANCE, NO UN OLVIDO.** La
 * importación de esta versión es una migración operada desde la línea de
 * comandos (`npm run importar`), no un autoservicio: sin pantalla de subida no
 * hay nada que exponer por HTTP, y publicar un endpoint «por si acaso» sería
 * abrir una superficie de ataque que nadie usa. El día que exista la pantalla,
 * el controlador se añade encima de este mismo caso de uso.
 *
 * **IMPORTA LOS CUATRO MÓDULOS DUEÑOS** para usar sus casos de uso de lote.
 * `imports` no escribe ni una fila de negocio por su cuenta: traduce celdas y
 * delega en quien tiene las reglas.
 */

import { Module } from '@nestjs/common';

import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PricingModule } from '../pricing/pricing.module';
import { RecipesModule } from '../recipes/recipes.module';
import { ImportarArchivo } from './application/casos-de-uso/importar';
import { LECTOR_DE_HOJA } from './application/ports/lector-de-hoja.port';
import { REPOSITORIO_DE_IMPORTACIONES } from './application/ports/repositorio-de-importaciones.port';
import { DependenciasDeImportacionNest } from './infrastructure/dependencias-de-importacion';
import { LectorEnProcesoHijo } from './infrastructure/lector-en-proceso-hijo';
import { PrismaImportacionesRepositorio } from './infrastructure/prisma-importaciones.repositorio';

@Module({
  imports: [CatalogModule, PricingModule, RecipesModule, InventoryModule],
  providers: [
    { provide: REPOSITORIO_DE_IMPORTACIONES, useClass: PrismaImportacionesRepositorio },
    { provide: LECTOR_DE_HOJA, useClass: LectorEnProcesoHijo },
    DependenciasDeImportacionNest,
    {
      provide: ImportarArchivo,
      inject: [DependenciasDeImportacionNest],
      useFactory: (deps: DependenciasDeImportacionNest): ImportarArchivo =>
        new ImportarArchivo(deps),
    },
  ],
  exports: [ImportarArchivo],
})
export class ImportsModule {}
