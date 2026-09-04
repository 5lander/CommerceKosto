/**
 * El objeto de parámetros de `periods`, inyectado por propiedad.
 *
 * Mismo patrón que en `iam`, `catalog`, `pricing`, `recipes` e `inventory`: un
 * caso de uso recibe **un** objeto y no cuatro parámetros, que es lo que
 * CLAUDE.md §3 pide con su máximo de tres.
 *
 * `calendario` llega ya construido con la zona de `config/periods.ts`. El
 * dominio no lee configuración: la recibe.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import { CalendarioDePeriodos } from '../domain/periodo';
import {
  REPOSITORIO_DE_PERIODOS,
  type RepositorioDePeriodos,
} from '../application/ports/repositorio-de-periodos.port';

export const CALENDARIO_DE_PERIODOS = 'CALENDARIO_DE_PERIODOS';

@Injectable()
export class DependenciasDePeriodosNest {
  @Inject(REPOSITORIO_DE_PERIODOS)
  public readonly repositorio!: RepositorioDePeriodos;

  @Inject(CALENDARIO_DE_PERIODOS)
  public readonly calendario!: CalendarioDePeriodos;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;
}
