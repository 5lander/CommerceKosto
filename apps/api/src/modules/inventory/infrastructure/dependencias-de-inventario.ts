/**
 * El objeto de parámetros de `inventory`, inyectado por propiedad.
 *
 * Mismo patrón y misma razón que en `iam`, `catalog`, `pricing` y `recipes`: un
 * caso de uso recibe **un** objeto de dependencias y no seis parámetros, que es
 * lo que CLAUDE.md §3 pide con su máximo de tres.
 *
 * `leerItem` y `listarItems` son los puertos de LECTURA del catálogo:
 * `inventory` no toca sus tablas (CLAUDE.md §2). `costosDeItems` es el de
 * `pricing`, y hace falta para R10 — el costo estándar de una preparación y el
 * de los insumos que entran a un lote. `leerCarta` es el de `recipes`, y lo usa
 * el consumo por venta para explotar la receta.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { RELOJ, type Reloj } from '../../../shared/application/ports/reloj.port';
import { LeerItem, ListarItems } from '../../catalog/application/casos-de-uso/items';
import { CostosDeItems } from '../../pricing/application/casos-de-uso/costos-de-items';
import { LeerCarta } from '../../recipes/application/casos-de-uso/carta';
import {
  REPOSITORIO_DE_INVENTARIO,
  type RepositorioDeInventario,
} from '../application/ports/repositorio-de-inventario.port';

@Injectable()
export class DependenciasDeInventarioNest {
  @Inject(REPOSITORIO_DE_INVENTARIO)
  public readonly repositorio!: RepositorioDeInventario;

  @Inject(LeerItem)
  public readonly leerItem!: LeerItem;

  @Inject(ListarItems)
  public readonly listarItems!: ListarItems;

  @Inject(CostosDeItems)
  public readonly costosDeItems!: CostosDeItems;

  @Inject(LeerCarta)
  public readonly leerCarta!: LeerCarta;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;
}
