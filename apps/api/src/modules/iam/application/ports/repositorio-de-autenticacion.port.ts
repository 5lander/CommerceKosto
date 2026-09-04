/**
 * Todo lo que la autenticacion necesita de la persistencia, y nada mas.
 *
 * EL PUERTO ES LA SUPERFICIE COMPLETA. No hay `buscarUsuarios()` ni
 * `ejecutarConsulta()`: cada metodo responde a un paso concreto del flujo de
 * login o de validacion de sesion. Un puerto generico volveria a poner la
 * decision de que se lee en manos de quien llama, que es justo lo que la
 * arquitectura intenta impedir.
 */

import type { AuditOutcome } from '../../../../shared/application/ports/audit-log.port';
import type {
  CompanyId,
  LocationId,
  SessionId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import type { VigenciaDeSesion } from '../../domain/politica-de-sesion';

export const REPOSITORIO_DE_AUTENTICACION = 'REPOSITORIO_DE_AUTENTICACION';

/** Lo que devuelve `auth_lookup`: cinco columnas, de un solo correo. */
export interface CredencialDeLogin {
  readonly userId: UserId;
  readonly companyId: CompanyId;
  /** `null` mientras la invitacion este pendiente. */
  readonly passwordHash: string | null;
  readonly userStatus: string;
  readonly companyStatus: string;
}

/**
 * Fallos recientes por los DOS ejes que exige SEGURIDAD.md §2.1.
 *
 * Contar solo por cuenta deja pasar el rociado de contrasenas: una IP prueba
 * "Verano2026" contra mil correos distintos y ninguna cuenta llega a cinco
 * fallos. Contar solo por IP deja pasar la botnet. Se cuentan los dos y manda
 * el mas restrictivo.
 */
export interface FallosRecientes {
  readonly porCuenta: readonly Date[];
  readonly porIp: readonly Date[];
}

export interface NuevaSesion {
  readonly companyId: CompanyId;
  readonly userId: UserId;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/**
 * Alcance del usuario dentro de su company.
 *
 * ES UNA UNION Y NO UNA LISTA CON UN CASO ESPECIAL. Un `ubicaciones: []` que
 * significara "todas" es la clase de convencion que alguien lee al reves una
 * vez y convierte en fuga. Aqui los dos casos se nombran, y quien consuma esto
 * tiene que tratarlos por separado o no compila.
 */
export type AlcanceDeUsuario =
  | { readonly clase: 'company' }
  | { readonly clase: 'ubicaciones'; readonly ids: readonly LocationId[] };

export interface ContextoDeSesion {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly companyId: CompanyId;
  readonly vigencia: VigenciaDeSesion;
  readonly userStatus: string;
  readonly companyStatus: string;
  /** Capacidades efectivas, ya resueltas desde los roles (SPEC §4). */
  readonly permisos: readonly string[];
  readonly alcance: AlcanceDeUsuario;
}

export interface RepositorioDeAutenticacion {
  /** Unica lectura sin tenant efectivo del sistema. Va por `auth_lookup`. */
  buscarCredencial(email: string): Promise<CredencialDeLogin | null>;

  fallosRecientes(entrada: {
    readonly email: string;
    readonly ip: string | null;
    readonly desde: Date;
  }): Promise<FallosRecientes>;

  registrarIntento(intento: {
    readonly email: string;
    readonly ip: string | null;
    readonly outcome: AuditOutcome;
  }): Promise<void>;

  /**
   * Borra los fallos de una cuenta tras un acceso correcto.
   *
   * Sin esto, un usuario legitimo que se equivoco cuatro veces por la manana
   * arrastraria esos fallos toda la hora siguiente y se bloquearia al primer
   * error de la tarde.
   */
  olvidarFallos(email: string): Promise<void>;

  abrirSesion(nueva: NuevaSesion): Promise<SessionId>;

  contextoDeSesion(tokenHash: string): Promise<ContextoDeSesion | null>;

  /** Renueva `last_seen_at`: es lo que sostiene el limite por inactividad. */
  marcarVista(entrada: {
    readonly companyId: CompanyId;
    readonly sessionId: SessionId;
    readonly ahora: Date;
  }): Promise<void>;

  revocarSesion(entrada: {
    readonly companyId: CompanyId;
    readonly sessionId: SessionId;
    readonly ahora: Date;
  }): Promise<void>;

  /** Al cambiar la contrasena se revocan TODAS (SEGURIDAD.md §2.2). */
  revocarSesionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly ahora: Date;
  }): Promise<number>;

  /** Reemplaza el hash cuando `necesitaRehash` lo pide, o al cambiarla. */
  guardarHashDeContrasena(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly hash: string;
  }): Promise<void>;
}
