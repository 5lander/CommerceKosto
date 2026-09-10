/**
 * Todo lo que la autenticacion necesita de la persistencia, y nada mas.
 *
 * EL PUERTO ES LA SUPERFICIE COMPLETA. No hay `buscarUsuarios()` ni
 * `ejecutarConsulta()`: cada metodo responde a un paso concreto del flujo de
 * login o de validacion de sesion. Un puerto generico volveria a poner la
 * decision de que se lee en manos de quien llama, que es justo lo que la
 * arquitectura intenta impedir.
 */

import type { CorreoAEncolar } from '../../../../shared/application/correo/correo-a-encolar';
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
  /**
   * TODAS las ubicaciones de la company, independientemente del alcance.
   *
   * NO ES EL ALCANCE Y NO LO SUSTITUYE: es el conjunto contra el que se
   * comprueba que un `locationId` recibido pertenece siquiera a esta company.
   * `alcance` responde «puede este usuario»; esto responde «existe esto aqui»,
   * y son dos preguntas distintas — un OWNER puede con todas las suyas y con
   * ninguna ajena.
   *
   * Viaja en `session_lookup`, que ya se ejecuta en cada peticion, para que la
   * comprobacion no cueste una consulta mas. Y por eso mismo NO se queda rancio:
   * una ubicacion creada hace un segundo esta en la siguiente peticion.
   */
  readonly ubicacionesDeCompany: readonly LocationId[];
}

/** Lo que devuelve `password_reset_consume`: a quien pertenece el token que se acaba de gastar. */
export interface UsuarioRestablecido {
  readonly userId: UserId;
  readonly companyId: CompanyId;
}

export interface RepositorioDeAutenticacion {
  /** Unica lectura sin tenant efectivo del sistema. Va por `auth_lookup`. */
  buscarCredencial(email: string): Promise<CredencialDeLogin | null>;

  /**
   * Crea el token de restablecimiento y encola su correo en UNA operacion, sin
   * tenant (`password_reset_request`, D-16.47). Sin usuario activo no hace
   * nada y devuelve lo mismo: la respuesta no dice si el correo existe.
   */
  solicitarRestablecimiento(entrada: {
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<void>;

  /**
   * Gasta el token si no estaba usado ni caducado (`password_reset_consume`).
   * `null` para inexistente, usado o caducado: los tres iguales, a proposito.
   */
  consumirRestablecimiento(entrada: {
    readonly tokenHash: string;
    readonly ahora: Date;
  }): Promise<UsuarioRestablecido | null>;

  /**
   * El correo de un usuario de la company, bajo tenant. La politica de
   * contrasenas lo necesita para rechazar una que lo contenga.
   */
  correoDelUsuario(entrada: { readonly companyId: CompanyId; readonly userId: UserId }): Promise<string | null>;

  /**
   * Deja un correo en `email_outbox` bajo el tenant del usuario. Hoy lo usa
   * solo el aviso de bloqueo del login: lo entrega el despachador, como la
   * invitacion y el restablecimiento (ADR-025). La API no envia nada.
   */
  encolarCorreo(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly correo: CorreoAEncolar;
  }): Promise<void>;

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
