/**
 * Los períodos contables — D6.
 *
 * **NO HAY ENDPOINT DE CIERRE AQUÍ, Y NO ES UN OLVIDO.** D6 dice que el mes se
 * cierra «al cargar el conteo físico», así que cerrar es un paso de la
 * confirmación del conteo y vive en `inventory`:
 * `POST /conteos/:id/cierre-de-periodo`. Un cierre suelto permitiría sellar un
 * mes sin la medición que lo hace interpretable, y ese mes ya no podría
 * producir food cost real nunca.
 *
 * **`period.read` SÍ LO TIENE `BODEGA`.** Saber que un mes está cerrado no
 * permite despejar ninguna receta —es un estado, no una cantidad— y sin ello no
 * entendería por qué le rechazan una compra con fecha del mes pasado.
 */

import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import { periodId as aPeriodId, locationId as aLocationId } from '../../../../shared/domain/identity/identificadores';
import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { SesionActual } from '../../../iam/infrastructure/http/decoradores';
import { ConsultarPeriodos, ReabrirPeriodo } from '../../application/casos-de-uso/periodos';
import type { PeriodoLeido } from '../../application/ports/repositorio-de-periodos.port';
import {
  CONSULTA_DE_PERIODOS,
  CUERPO_DE_REAPERTURA,
  type ConsultaDePeriodos,
  type CuerpoDeReapertura,
  type PeriodoDto,
} from './periodos.dto';

const DIGITOS_DEL_MES = 2;

@Controller('periodos')
export class PeriodosController {
  public constructor(
    private readonly consulta: ConsultarPeriodos,
    private readonly reapertura: ReabrirPeriodo,
  ) {}

  /** Los meses de una ubicación de los que alguien ya se ha ocupado. */
  @Get()
  @Requiere('period.read')
  public async listar(
    @SesionActual() sesion: SesionActiva,
    @Query(new EsquemaPipe(CONSULTA_DE_PERIODOS)) consulta: ConsultaDePeriodos,
  ): Promise<readonly PeriodoDto[]> {
    const periodos = await this.consulta.ejecutar(sesion, {
      locationId: aLocationId(consulta.locationId),
    });
    return periodos.map(comoPeriodoDto);
  }

  /** Solo el `OWNER`, y queda en `audit_log` con su motivo (D6). */
  @Post(':periodId/reapertura')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Requiere('period.reopen')
  public async reabrir(
    @SesionActual() sesion: SesionActiva,
    @Param('periodId') periodId: string,
    @Body(new EsquemaPipe(CUERPO_DE_REAPERTURA)) cuerpo: CuerpoDeReapertura,
  ): Promise<void> {
    await this.reapertura.ejecutar(sesion, {
      periodId: aPeriodId(periodId),
      motivo: cuerpo.motivo,
    });
  }
}

export function comoPeriodoDto(periodo: PeriodoLeido): PeriodoDto {
  return {
    id: periodo.id,
    locationId: periodo.locationId,
    anio: periodo.anio,
    mes: periodo.mes,
    etiqueta: `${String(periodo.anio)}-${String(periodo.mes).padStart(DIGITOS_DEL_MES, '0')}`,
    inicioEn: periodo.inicioEn.toISOString(),
    finEn: periodo.finEn.toISOString(),
    estado: periodo.estado,
    cerradoEn: periodo.cerradoEn?.toISOString() ?? null,
    cerradoPor: periodo.cerradoPor,
    reabiertoEn: periodo.reabiertoEn?.toISOString() ?? null,
    reabiertoPor: periodo.reabiertoPor,
  };
}
