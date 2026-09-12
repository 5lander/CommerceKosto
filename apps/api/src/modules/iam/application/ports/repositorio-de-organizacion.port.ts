/**
 * Lo que los casos de uso de organizacion —ubicaciones, usuarios y roles—
 * necesitan de la persistencia.
 *
 * `crearUbicacionSiCabe` LLEVA LA COMPROBACION DEL LIMITE DENTRO, y no es una
 * comodidad: es la unica forma de que el limite se cumpla. Contar primero y
 * crear despues, en dos operaciones, es un TOCTOU de manual —dos peticiones
 * simultaneas cuentan nueve, las dos deciden que caben, y quedan once—. El
 * adaptador lo resuelve tomando el candado de la fila de la company dentro de
 * la misma transaccion que inserta. Quien llama no puede equivocarse porque no
 * tiene las dos piezas por separado.
 *
 * `invitar` DEVUELVE UNA UNION EN VEZ DE LANZAR por lo mismo: el correo ya en
 * uso no es un fallo, es una respuesta posible, y modelarla en el tipo obliga a
 * tratarla. Un `throw` se olvida; una union no compila si se olvida.
 *
 * `invitar` Y `reinvitar` RECIBEN EL CORREO A ENCOLAR, y no es una comodidad:
 * es la unica forma de que el correo se escriba en la MISMA transaccion que
 * crea o renueva la invitacion (ADR-025). El caso de uso no tiene el `tx`; el
 * repositorio si, y deja el correo en `email_outbox` antes de confirmar. Si
 * el usuario no se crea, no hay correo; si el correo no se encola, no hay
 * usuario.
 */

import type { CorreoAEncolar } from '../../../../shared/application/correo/correo-a-encolar';
import type {
  CompanyId,
  LocationId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';

export const REPOSITORIO_DE_ORGANIZACION = 'REPOSITORIO_DE_ORGANIZACION';

export type TipoDeUbicacion = 'BODEGA' | 'LOCAL' | 'AMBOS';

export interface Ubicacion {
  readonly id: LocationId;
  readonly nombre: string;
  readonly tipo: string;
  readonly estado: string;
}

/** `limite` trae el maximo del plan, para que el mensaje sepa decir cual es. */
export type ResultadoDeCreacion =
  | { readonly clase: 'creada'; readonly id: LocationId }
  | { readonly clase: 'limite'; readonly maximo: number };

export type ResultadoDeInvitacion =
  | { readonly clase: 'invitado'; readonly id: UserId }
  | { readonly clase: 'correo_en_uso' };

export interface InvitacionPendiente {
  readonly userId: UserId;
  readonly companyId: CompanyId;
  readonly email: string;
  readonly expiraEn: Date;
  readonly estado: string;
}

/** Un usuario de la company que sigue en estado invitado: lo unico que hace falta para reinvitarlo. */
export interface UsuarioInvitado {
  readonly email: string;
}

/** Una asignación de rol tal como se lista: el rol y, si es de ubicación, cuál. */
export interface AsignacionListada {
  readonly rol: string;
  readonly locationId: LocationId | null;
}

/**
 * El último correo de invitación de un usuario (D-16.27(b)): su estado y su
 * error. **Nunca `datos`**, que lleva el enlace con el token mientras el correo
 * está en vuelo — y que `costeo_app` ni siquiera puede leer (GRANT por columnas).
 */
export interface CorreoDeInvitacion {
  readonly estado: string;
  readonly error: string | null;
}

export interface UsuarioListado {
  readonly id: UserId;
  readonly email: string;
  readonly estado: string;
  readonly roles: readonly AsignacionListada[];
  readonly invitacionCaducaEn: Date | null;
  /** `null` si nunca se encoló uno (invitados antes de P16-A1). */
  readonly correoInvitacion: CorreoDeInvitacion | null;
}

export interface RolDelCatalogo {
  readonly codigo: string;
  readonly requiereUbicacion: boolean;
  readonly permisos: readonly string[];
}

export type ResultadoDeActualizacionDeUbicacion = 'actualizada' | 'no_encontrada' | 'nombre_en_uso';

/** `no_pendiente`: activo entre la lectura y la escritura, o nunca fue invitado. */
export type ResultadoDeReinvitacion = 'reinvitado' | 'no_pendiente';

export interface RepositorioDeOrganizacion {
  crearUbicacionSiCabe(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly tipo: TipoDeUbicacion;
  }): Promise<ResultadoDeCreacion>;

  /**
   * @param ids `'todas'` para el alcance de company. La lista explicita es lo
   *   que impide que un `GERENTE_LOCAL` vea ubicaciones que no son suyas: RLS
   *   filtra por tenant, no por ubicacion.
   */
  listarUbicaciones(entrada: {
    readonly companyId: CompanyId;
    readonly ids: readonly LocationId[] | 'todas';
  }): Promise<readonly Ubicacion[]>;

  /** Crea al invitado y encola su correo en la misma transaccion. */
  invitar(entrada: {
    readonly companyId: CompanyId;
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<ResultadoDeInvitacion>;

  /** `null` si no existe en la company o ya no esta invitado. */
  invitadoPendiente(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
  }): Promise<UsuarioInvitado | null>;

  /**
   * Sustituye el token de la invitacion —el anterior deja de servir— y encola
   * el correo nuevo en la misma transaccion. Solo si sigue invitado.
   */
  reinvitar(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<ResultadoDeReinvitacion>;

  /** Lectura sin tenant: quien llega por el enlace todavia no es nadie. */
  invitacionPorToken(tokenHash: string): Promise<InvitacionPendiente | null>;

  activarConContrasena(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly hash: string;
  }): Promise<void>;

  /** `null` si el usuario no existe en esa company. */
  esOwner(entrada: { readonly companyId: CompanyId; readonly userId: UserId }): Promise<boolean | null>;

  /**
   * Los usuarios de la company con sus roles y el último correo de invitación.
   *
   * @param ubicaciones `'todas'` con alcance de company; si no, solo quien tiene
   *   un rol en alguna de ellas, y solo esas asignaciones (D-16.126).
   */
  listarUsuarios(entrada: {
    readonly companyId: CompanyId;
    readonly ubicaciones: readonly LocationId[] | 'todas';
  }): Promise<readonly UsuarioListado[]>;

  /** El catálogo de roles con sus permisos. Es global: sin datos de ninguna company. */
  listarRoles(companyId: CompanyId): Promise<readonly RolDelCatalogo[]>;

  actualizarUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly nombre: string;
    readonly tipo: TipoDeUbicacion;
  }): Promise<ResultadoDeActualizacionDeUbicacion>;

  asignarRol(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly rol: string;
    readonly locationId: LocationId | null;
  }): Promise<void>;

  /** @returns cuantas asignaciones se retiraron: cero significa que no habia. */
  revocarRol(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly rol: string;
    readonly locationId: LocationId | null;
  }): Promise<number>;
}
