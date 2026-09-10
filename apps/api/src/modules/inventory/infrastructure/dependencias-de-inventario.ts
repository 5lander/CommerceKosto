/**
 * El objeto de parámetros de `inventory`, inyectado por propiedad.
 *
 * Mismo patrón y misma razón que en `iam`, `catalog`, `pricing` y `recipes`: un
 * caso de uso recibe **un** objeto de dependencias y no seis parámetros, que es
 * lo que CLAUDE.md §3 pide con su máximo de tres.
 *
 * `periodos`, `asegurarPeriodo`, `consultarPeriodo` y `cerrarPeriodo` son las
 * piezas de `periods`. La flecha va en un solo sentido —`inventory` depende de
 * `periods` y nunca al revés— porque toda escritura del libro pregunta si el
 * mes está cerrado y la confirmación del conteo es la que lo cierra.
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
import { LeerItem, ListarGrupos, ListarItems } from '../../catalog/application/casos-de-uso/items';
import { TarifasDeIva } from '../../catalog/application/casos-de-uso/tarifas-de-iva';
import {
  AsegurarPeriodo,
  CerrarPeriodo,
  ConsultarPeriodo,
  ExigirPeriodoAbierto,
} from '../../periods/application/casos-de-uso/periodos';
import { CalendarioDePeriodos } from '../../periods/domain/periodo';
import { CALENDARIO_DE_PERIODOS } from '../../periods/infrastructure/dependencias-de-periodos';
import { LeerAjustes } from '../../pricing/application/casos-de-uso/ajustes';
import { CostosDeItems } from '../../pricing/application/casos-de-uso/costos-de-items';
import { LeerCarta } from '../../recipes/application/casos-de-uso/carta';
import {
  REPOSITORIO_DE_CONTEOS,
  type RepositorioDeConteos,
} from '../application/ports/repositorio-de-conteos.port';
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

  /** Los dos escalones de abajo de la tarifa de IVA de una compra (D-16.9). */
  @Inject(TarifasDeIva)
  public readonly tarifasDeIva!: TarifasDeIva;

  @Inject(ListarGrupos)
  public readonly listarGrupos!: ListarGrupos;

  /** La recuperabilidad del IVA es de la company (R13), y la guarda `pricing`. */
  @Inject(LeerAjustes)
  public readonly leerAjustes!: LeerAjustes;

  @Inject(CostosDeItems)
  public readonly costosDeItems!: CostosDeItems;

  @Inject(LeerCarta)
  public readonly leerCarta!: LeerCarta;

  @Inject(REPOSITORIO_DE_CONTEOS)
  public readonly conteos!: RepositorioDeConteos;

  /** La guarda del mes cerrado (D6): la llaman las cinco escrituras del libro. */
  @Inject(ExigirPeriodoAbierto)
  public readonly periodos!: ExigirPeriodoAbierto;

  @Inject(AsegurarPeriodo)
  public readonly asegurarPeriodo!: AsegurarPeriodo;

  @Inject(ConsultarPeriodo)
  public readonly consultarPeriodo!: ConsultarPeriodo;

  @Inject(CerrarPeriodo)
  public readonly cerrarPeriodo!: CerrarPeriodo;

  @Inject(CALENDARIO_DE_PERIODOS)
  public readonly calendario!: CalendarioDePeriodos;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  @Inject(RELOJ)
  public readonly reloj!: Reloj;
}
