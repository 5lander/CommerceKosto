/**
 * Módulo `imports`.
 *
 * **SUBIR NO ES UN ENDPOINT, Y ES UNA DECISIÓN DE ALCANCE, NO UN OLVIDO.** La
 * importación de esta versión es una migración operada desde la línea de
 * comandos (`npm run importar`), no un autoservicio: sin pantalla de subida no
 * hay nada que exponer, y publicar un endpoint «por si acaso» sería abrir una
 * superficie de ataque que nadie usa. El día que exista la pantalla (P20), el
 * controlador crece encima de este mismo caso de uso.
 *
 * **DESHACER SÍ LO ES, DESDE D-16.200.** Y no contradice lo anterior: el
 * comando puede dejar cientos de filas en el libro de un cliente, y hasta ahora
 * la única forma de revertirlas era corregirlas a mano una a una. La asimetría
 * es a propósito — se entra por la puerta estrecha y se sale por la ancha.
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
import { AnularImportacion } from './application/casos-de-uso/anular';
import { ImportarArchivo } from './application/casos-de-uso/importar';
import { LECTOR_DE_HOJA } from './application/ports/lector-de-hoja.port';
import { REPOSITORIO_DE_IMPORTACIONES } from './application/ports/repositorio-de-importaciones.port';
import { DependenciasDeImportacionNest } from './infrastructure/dependencias-de-importacion';
import { ImportacionesController } from './infrastructure/http/importaciones.controller';
import { LectorEnProcesoHijo } from './infrastructure/lector-en-proceso-hijo';
import { PrismaImportacionesRepositorio } from './infrastructure/prisma-importaciones.repositorio';

@Module({
  imports: [CatalogModule, PricingModule, RecipesModule, InventoryModule],
  controllers: [ImportacionesController],
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
    {
      provide: AnularImportacion,
      inject: [DependenciasDeImportacionNest],
      useFactory: (deps: DependenciasDeImportacionNest): AnularImportacion =>
        new AnularImportacion(deps),
    },
  ],
  exports: [ImportarArchivo],
})
export class ImportsModule {}
