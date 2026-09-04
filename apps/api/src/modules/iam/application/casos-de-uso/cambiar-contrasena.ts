/**
 * Cambio de contrasena — SEGURIDAD.md §2.2.
 *
 * "Al cambiar contrasena o correo: TODAS las sesiones activas se revocan". Es
 * la unica accion que un usuario puede tomar por su cuenta cuando sospecha que
 * alguien entro con su cuenta, y si no expulsa al intruso no sirve para nada:
 * cambiar la contrasena sin revocar sesiones deja al que ya esta dentro
 * exactamente igual de dentro.
 *
 * SE REVOCAN TAMBIEN LAS DEL PROPIO USUARIO, la suya incluida. Salvar la sesion
 * en curso significaria decidir, en el momento del cambio, cual de las sesiones
 * abiertas es "la buena" — y esa decision se toma a partir de datos que el
 * atacante controla. Se cierran todas y se vuelve a entrar.
 *
 * LA CONTRASENA ACTUAL SE EXIGE aunque el usuario ya este autenticado: es lo
 * que impide que una sesion robada, o un ataque de fijacion, cambie la
 * credencial y deje al titular fuera de su propia cuenta.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import { ContrasenaDebilError, CredencialesInvalidasError } from '../../domain/errores';
import { mensajeDelProblema, problemaDeContrasena } from '../../domain/politica-de-contrasenas';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type { RepositorioDeAutenticacion } from '../ports/repositorio-de-autenticacion.port';
import type { SesionActiva } from './validar-sesion';

export interface DependenciasDeCambiarContrasena {
  readonly repositorio: RepositorioDeAutenticacion;
  readonly hasher: HasherDeContrasenas;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

export interface DatosDelCambio {
  readonly correo: string;
  readonly actual: string;
  readonly nueva: string;
}

export class CambiarContrasena {
  public constructor(private readonly deps: DependenciasDeCambiarContrasena) {}

  /**
   * @returns cuantas sesiones se revocaron, la del propio usuario incluida.
   * @throws {CredencialesInvalidasError} si la contrasena actual no coincide
   * @throws {ContrasenaDebilError} si la nueva no cumple la politica
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDelCambio): Promise<number> {
    const credencial = await this.deps.repositorio.buscarCredencial(datos.correo.trim().toLowerCase());

    // El correo tiene que ser el del propio usuario autenticado. Sin esta
    // comprobacion, quien tuviera una sesion podria cambiar la contrasena de
    // cualquier otra cuenta cuyo correo conociera.
    const esSuyo = credencial !== null && credencial.userId === sesion.userId;
    const coincide = await this.deps.hasher.verificar(
      esSuyo ? credencial.passwordHash : null,
      datos.actual,
    );
    if (!esSuyo || !coincide) {
      throw new CredencialesInvalidasError('contrasena_incorrecta');
    }

    const problema = problemaDeContrasena({ contrasena: datos.nueva, correo: datos.correo });
    if (problema !== null) {
      throw new ContrasenaDebilError(mensajeDelProblema(problema));
    }

    await this.deps.repositorio.guardarHashDeContrasena({
      companyId: sesion.companyId,
      userId: sesion.userId,
      hash: await this.deps.hasher.hash(datos.nueva),
    });

    const ahora = this.deps.reloj.ahora();
    const revocadas = await this.deps.repositorio.revocarSesionesDe({
      companyId: sesion.companyId,
      userId: sesion.userId,
      ahora,
    });

    await this.deps.auditoria.record({
      eventType: 'auth.password.changed',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { sesionesRevocadas: revocadas },
    });

    return revocadas;
  }
}
