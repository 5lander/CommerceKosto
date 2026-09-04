/**
 * El objeto de parametros de `pricing`, inyectado por propiedad.
 *
 * Mismo patron y misma razon que en `iam` y `catalog`: `application` no puede
 * importar NestJS, asi que los casos de uso no llevan decorador y el modulo los
 * construye con `useFactory`. Esta clase es lo unico que conoce los tokens.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import { ListarArticulos } from '../../catalog/application/casos-de-uso/articulos';
import { LeerItem, ListarItems } from '../../catalog/application/casos-de-uso/items';
import {
  REPOSITORIO_DE_PRECIOS,
  type RepositorioDePrecios,
} from '../application/ports/repositorio-de-precios.port';

@Injectable()
export class DependenciasDePreciosNest {
  @Inject(REPOSITORIO_DE_PRECIOS)
  public readonly repositorio!: RepositorioDePrecios;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;

  /**
   * Los dos puertos de LECTURA del catalogo. `pricing` no toca sus tablas:
   * CLAUDE.md §2 y la regla `tablas-de-catalogo-solo-en-catalog`.
   */
  @Inject(LeerItem)
  public readonly leerItem!: LeerItem;

  @Inject(ListarArticulos)
  public readonly listarArticulos!: ListarArticulos;

  @Inject(ListarItems)
  public readonly listarItems!: ListarItems;
}
