/**
 * El objeto de parámetros de `imports`, inyectado por propiedad.
 *
 * Mismo patrón y misma razón que los demás: `application` no puede importar
 * NestJS —lo verifica `audit:arch`—, así que los casos de uso no llevan
 * decorador y el módulo los construye con `useFactory`. Esta clase es lo único
 * que conoce los tokens de inyección de la importación.
 *
 * Los seis casos de uso de lote se inyectan **por su clase**, que es como los
 * exportan sus módulos. Es la lista completa de lo que la importación puede
 * escribir, y se lee de un vistazo — que es justo lo que se quiere de una
 * superficie que toca cuatro módulos.
 */

import { Inject, Injectable } from '@nestjs/common';

import {
  CrearArticulosEnLote,
  CrearItemsEnLote,
} from '../../catalog/application/casos-de-uso/lotes';
import { RegistrarMovimientosEnLote } from '../../inventory/application/casos-de-uso/lotes';
import { SugerirPreciosEnLote } from '../../pricing/application/casos-de-uso/lotes';
import {
  CrearProductosEnLote,
  GuardarRecetasEnLote,
} from '../../recipes/application/casos-de-uso/lotes';
import type { TopesDelArchivo } from '../application/casos-de-uso/importar';
import { LECTOR_DE_HOJA, type LectorDeHoja } from '../application/ports/lector-de-hoja.port';
import { MAXIMO_BYTES, MAXIMO_DE_FILAS, MAXIMO_MB } from './limites';
import {
  REPOSITORIO_DE_IMPORTACIONES,
  type RepositorioDeImportaciones,
} from '../application/ports/repositorio-de-importaciones.port';

@Injectable()
export class DependenciasDeImportacionNest {
  @Inject(REPOSITORIO_DE_IMPORTACIONES)
  public readonly repositorio!: RepositorioDeImportaciones;

  @Inject(LECTOR_DE_HOJA)
  public readonly lector!: LectorDeHoja;

  /** Los topes de SEGURIDAD.md §5.1. Es infraestructura la que los conoce. */
  public readonly topes: TopesDelArchivo = {
    bytes: MAXIMO_BYTES,
    megabytes: MAXIMO_MB,
    filas: MAXIMO_DE_FILAS,
  };

  @Inject(CrearItemsEnLote)
  public readonly crearItems!: CrearItemsEnLote;

  @Inject(CrearArticulosEnLote)
  public readonly crearArticulos!: CrearArticulosEnLote;

  @Inject(SugerirPreciosEnLote)
  public readonly sugerirPrecios!: SugerirPreciosEnLote;

  @Inject(CrearProductosEnLote)
  public readonly crearProductos!: CrearProductosEnLote;

  @Inject(GuardarRecetasEnLote)
  public readonly guardarRecetas!: GuardarRecetasEnLote;

  @Inject(RegistrarMovimientosEnLote)
  public readonly registrarMovimientos!: RegistrarMovimientosEnLote;
}
