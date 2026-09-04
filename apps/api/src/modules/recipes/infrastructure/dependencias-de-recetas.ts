/**
 * El objeto de parametros de `recipes`, inyectado por propiedad.
 *
 * Mismo patron y misma razon que en `iam`, `catalog` y `pricing`.
 * `leerItem` es el puerto de LECTURA del catalogo: `recipes` no toca sus
 * tablas (CLAUDE.md §2).
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import { LeerItem } from '../../catalog/application/casos-de-uso/items';
import {
  REPOSITORIO_DE_RECETAS,
  type RepositorioDeRecetas,
} from '../application/ports/repositorio-de-recetas.port';

@Injectable()
export class DependenciasDeRecetasNest {
  @Inject(REPOSITORIO_DE_RECETAS)
  public readonly repositorio!: RepositorioDeRecetas;

  @Inject(LeerItem)
  public readonly leerItem!: LeerItem;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;
}
