/**
 * Los parámetros de costeo de la company — D3, SPEC §11.
 *
 * **NINGUNO DE ESTOS NÚMEROS ESTÁ EN EL CÓDIGO.** Viven en `company_settings`,
 * los siembra un trigger al nacer la company con los valores del Excel
 * original, y se editan desde aquí. El motor de costeo de P5 los recibirá como
 * parámetro, no los leerá de una constante.
 *
 * LA NOTA DEL AUTOR DEL EXCEL SOBRE LA MERMA MERECE SOBREVIVIR, porque es la
 * clase de decisión que alguien deshace por parecerle baja: antes un único 4 %
 * cubría cáscara, hoja botada, derrame y error de pase. Hoy cada insumo declara
 * su rendimiento y el costo neto absorbe ahí su propia merma. El 2 % es **solo
 * lo que ningún rendimiento explica**. Subirlo a 4 % cobraría la merma dos
 * veces — que es exactamente lo que R12 prohíbe.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import { Ratio } from '../../../../shared/domain/money/tipos-monetarios';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import { problemaDeAjustes } from '../../domain/ajustes';
import { AjustesInvalidosError, ItemSinPrecioError } from '../../domain/errores';
import type { AjustesDeCompany, RepositorioDePrecios } from '../ports/repositorio-de-precios.port';

export interface DependenciasDeAjustes {
  readonly repositorio: RepositorioDePrecios;
  readonly auditoria: AuditLogPort;
}

export class LeerAjustes {
  public constructor(private readonly deps: DependenciasDeAjustes) {}

  public async ejecutar(sesion: SesionActiva): Promise<AjustesDeCompany> {
    const ajustes = await this.deps.repositorio.ajustes(sesion.companyId);
    if (ajustes === null) {
      throw new ItemSinPrecioError('La company no tiene parámetros de costeo configurados.');
    }
    return ajustes;
  }
}

export class ActualizarAjustes {
  public constructor(private readonly deps: DependenciasDeAjustes) {}

  public async ejecutar(sesion: SesionActiva, ajustes: AjustesDeCompany): Promise<void> {
    const problema = problemaDeAjustes(ajustes);
    if (problema !== null) {
      throw new AjustesInvalidosError(problema);
    }

    await this.deps.repositorio.guardarAjustes({ companyId: sesion.companyId, ajustes });

    await this.deps.auditoria.record({
      eventType: 'company.settings_updated',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      // Los VALORES no van al detalle: son configuración de negocio, y
      // SEGURIDAD.md §10 pide solo IDs y escalares. Lo que importa registrar es
      // quién los tocó y cuándo.
      detail: { ivaVenta: Ratio.fromDecimalString(ajustes.ivaVenta).toExactString() },
    });
  }
}
