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
 */

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

  invitar(entrada: {
    readonly companyId: CompanyId;
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
  }): Promise<ResultadoDeInvitacion>;

  /** Lectura sin tenant: quien llega por el enlace todavia no es nadie. */
  invitacionPorToken(tokenHash: string): Promise<InvitacionPendiente | null>;

  activarConContrasena(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly hash: string;
  }): Promise<void>;

  /** `null` si el usuario no existe en esa company. */
  esOwner(entrada: { readonly companyId: CompanyId; readonly userId: UserId }): Promise<boolean | null>;

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
