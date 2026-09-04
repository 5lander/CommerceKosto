/**
 * El objeto de parámetros de `catalog`, inyectado por propiedad.
 *
 * Mismo patrón y misma razón que `DependenciasDeIam`: `application` no puede
 * importar NestJS —lo verifica `audit:arch`—, así que los casos de uso no
 * llevan decorador y este módulo los construye con `useFactory`. Esta clase es
 * lo único que conoce los tokens de inyección del catálogo.
 *
 * Satisface por estructura tanto `DependenciasDeCatalogo` como
 * `DependenciasDeArticulos`: son la misma pareja de puertos y no hace falta
 * jerarquía para decirlo.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import {
  REPOSITORIO_DE_CATALOGO,
  type RepositorioDeCatalogo,
} from '../application/ports/repositorio-de-catalogo.port';

@Injectable()
export class DependenciasDeCatalogoNest {
  @Inject(REPOSITORIO_DE_CATALOGO)
  public readonly repositorio!: RepositorioDeCatalogo;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;
}
