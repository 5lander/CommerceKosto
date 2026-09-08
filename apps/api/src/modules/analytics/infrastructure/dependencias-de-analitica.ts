/**
 * El objeto de parámetros de `analytics`, inyectado por propiedad.
 *
 * **ES EL MÓDULO CON MÁS DEPENDENCIAS DEL SISTEMA, Y ES LO ESPERADO.** P8 es
 * una capa de lectura sobre todo lo construido: no calcula ningún costo, pide
 * la carta a `costing`, los agregados y el conteo a `inventory`, el mes a
 * `periods` y los parámetros a `pricing`. Todas son lecturas y todas entran por
 * un caso de uso, nunca por una tabla.
 *
 * Si alguna vez esta lista deja de ser solo lecturas, `analytics` habrá dejado
 * de ser una vista.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_LOG_PORT, type AuditLogPort } from '../../../shared/application/ports/audit-log.port';
import { ListarArticulos } from '../../catalog/application/casos-de-uso/articulos';
import { ListarItems } from '../../catalog/application/casos-de-uso/items';
import { LeerCarta } from '../../recipes/application/casos-de-uso/carta';
import { CostearCarta } from '../../costing/application/casos-de-uso/costear';
import { LeerConciliacion } from '../../inventory/application/casos-de-uso/conteos';
import { ListarUbicaciones } from '../../iam/application/casos-de-uso/ubicaciones';
import {
  CalcularConsumoTeorico,
  ConsultarAgregadosDelPeriodo,
  ConsultarComprasPorArticulo,
  ConsultarConteoConfirmado,
} from '../../inventory/application/casos-de-uso/para-analitica';
import { CalendarioDePeriodos } from '../../periods/domain/periodo';
import { ZONA_HORARIA_DE_PERIODOS } from '../../../shared/infrastructure/config/periods';
import {
  AsegurarPeriodo,
  ConsultarPeriodo,
} from '../../periods/application/casos-de-uso/periodos';
import { LeerAjustes } from '../../pricing/application/casos-de-uso/ajustes';
import { CostosDeItems } from '../../pricing/application/casos-de-uso/costos-de-items';
import {
  REPOSITORIO_DE_ANALITICA,
  type RepositorioDeAnalitica,
} from '../application/ports/repositorio-de-analitica.port';

@Injectable()
export class DependenciasDeAnaliticaNest {
  @Inject(REPOSITORIO_DE_ANALITICA)
  public readonly repositorio!: RepositorioDeAnalitica;

  @Inject(AsegurarPeriodo)
  public readonly asegurarPeriodo!: AsegurarPeriodo;

  @Inject(ConsultarPeriodo)
  public readonly consultarPeriodo!: ConsultarPeriodo;

  @Inject(CostearCarta)
  public readonly costearCarta!: CostearCarta;

  /** Para el ambito compartido, no para leerla aqui. Ver `DependenciasDeVistas`. */
  @Inject(LeerCarta)
  public readonly leerCarta!: LeerCarta;

  @Inject(CalcularConsumoTeorico)
  public readonly consumoTeorico!: CalcularConsumoTeorico;

  @Inject(ConsultarAgregadosDelPeriodo)
  public readonly agregados!: ConsultarAgregadosDelPeriodo;

  @Inject(ConsultarConteoConfirmado)
  public readonly conteoConfirmado!: ConsultarConteoConfirmado;

  @Inject(ListarItems)
  public readonly listarItems!: ListarItems;

  @Inject(CostosDeItems)
  public readonly costosDeItems!: CostosDeItems;

  @Inject(LeerAjustes)
  public readonly leerAjustes!: LeerAjustes;

  @Inject(AUDIT_LOG_PORT)
  public readonly auditoria!: AuditLogPort;

  /** No lo usa `analytics`, pero `LeerConciliacion` lo necesita cableado. */
  @Inject(LeerConciliacion)
  public readonly conciliacion!: LeerConciliacion;

  // --- P9: lo que el consolidado anade -------------------------------------

  @Inject(ListarUbicaciones)
  public readonly listarUbicaciones!: ListarUbicaciones;

  @Inject(ListarArticulos)
  public readonly listarArticulos!: ListarArticulos;

  @Inject(ConsultarComprasPorArticulo)
  public readonly comprasPorArticulo!: ConsultarComprasPorArticulo;

  /**
   * El calendario, para traducir (ano, mes) a los dos instantes del corte.
   *
   * Se construye aqui y no se inyecta porque no tiene estado ni dependencias:
   * es la zona horaria de `config/periods.ts` y nada mas. La misma que usan
   * `periods` y las pruebas — si hubiera dos, un mes tendria dos fronteras.
   */
  public readonly calendario: CalendarioDePeriodos = new CalendarioDePeriodos(
    ZONA_HORARIA_DE_PERIODOS,
  );
}
