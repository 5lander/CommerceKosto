/**
 * Todo lo que el back office necesita de la persistencia, y nada más.
 *
 * **EL MOTIVO VIAJA EN LA MISMA LLAMADA QUE LA LECTURA, no en una aparte.** Es
 * la decisión de diseño de este puerto: `leerCompany(id, motivo)` escribe el
 * registro de acceso y devuelve los datos **en la misma transacción**. Un
 * `registrarAcceso()` separado sería una llamada que se puede olvidar, y un
 * registro de auditoría que depende de que alguien se acuerde no es un registro
 * de auditoría — es una intención. Aquí no hay forma de leer sin dejar rastro
 * porque no existe el método que lo permita.
 *
 * **Y NO HAY MÉTODO DE BORRADO EN NINGÚN SITIO.** El rol de base de datos
 * tampoco tiene `DELETE`: son las dos mitades de la misma decisión.
 */

import type { CompanyId } from '../../../../shared/domain/identity/identificadores';

export const REPOSITORIO_DE_BACKOFFICE = 'REPOSITORIO_DE_BACKOFFICE';

/** Un operador. Nunca lleva `companyId`: no pertenece a ningún tenant. */
export type OperatorId = string & { readonly __marca: 'OperatorId' };

export interface CredencialDeOperador {
  readonly operatorId: OperatorId;
  readonly passwordHash: string;
  readonly status: string;
}

export interface SesionDeOperador {
  readonly operatorId: OperatorId;
  readonly email: string;
  readonly expiraEn: Date;
  readonly revocadaEn: Date | null;
  readonly estado: string;
  /** El token anti-CSRF. `null` solo en sesiones anteriores a P16-A2. */
  readonly csrfToken: string | null;
}

export interface PlanLeido {
  readonly code: string;
  readonly name: string;
  readonly maxLocations: number;
  readonly maxItems: number;
  readonly maxProducts: number;
}

/** La ficha corta: lo que se ve en una lista, sin entrar en ningún tenant. */
export interface CompanyEnLista {
  readonly id: CompanyId;
  readonly nombre: string;
  readonly estado: string;
  readonly plan: string;
  readonly creadaEn: Date;
  readonly ubicaciones: number;
}

/** La ficha larga: lo que exige motivo, porque son datos de un cliente. */
export interface CompanyDetallada extends CompanyEnLista {
  readonly items: number;
  readonly productos: number;
  readonly usuarios: number;
  readonly limites: PlanLeido;
}

export interface LineaDeAuditoria {
  readonly at: Date;
  readonly eventType: string;
  readonly outcome: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly companyId: string | null;
  readonly ip: string | null;
  readonly correlationId: string;
}

/**
 * La salud de la cola de correo: contadores e instantes, y NADA de ningun
 * tenant (D-16.27c, D-16.34). Ni destinatarios, ni `datos`, ni ids.
 */
export interface SaludDelCorreo {
  /** `PENDIENTE` desde antes del umbral: la cola no avanza o el despachador no corre. */
  readonly pendientesAntiguos: number;
  /** `FALLIDO` en total: cada uno es un correo que alguien tendra que reenviar. */
  readonly fallidos: number;
  readonly ultimoEnvio: Date | null;
}

export interface AccesoRegistrado {
  readonly at: Date;
  readonly operador: string;
  readonly companyId: string | null;
  readonly accion: string;
  readonly motivo: string;
  readonly ip: string | null;
}

/**
 * Lo que acompaña a toda operación cross-tenant: quién, por qué y desde dónde.
 *
 * Va como objeto y no como tres parámetros sueltos porque los tres viajan
 * siempre juntos y porque así ninguna firma pasa de tres argumentos (CLAUDE.md §3).
 */
export interface Acceso {
  readonly operatorId: OperatorId;
  readonly motivo: string;
  readonly ip: string | null;
}

export interface DatosDeNuevaCompany {
  readonly nombre: string;
  readonly plan: string;
  readonly emailDelDueno: string;
}

export interface RepositorioDeBackoffice {
  buscarCredencial(email: string): Promise<CredencialDeOperador | null>;

  abrirSesion(entrada: {
    readonly operatorId: OperatorId;
    readonly tokenHash: string;
    /** En claro, como en la app cliente y por la misma razon (ADR-021). */
    readonly csrfToken: string;
    readonly expiraEn: Date;
    readonly ip: string | null;
    readonly userAgent: string | null;
  }): Promise<void>;

  sesionPorToken(tokenHash: string): Promise<SesionDeOperador | null>;

  revocarSesion(tokenHash: string): Promise<void>;

  listarPlanes(): Promise<readonly PlanLeido[]>;

  /** Lista sin entrar en ningún tenant. Deja rastro igual: quién miró la cartera. */
  listarCompanies(acceso: Acceso): Promise<readonly CompanyEnLista[]>;

  /** @throws si la company no existe. Escribe el acceso ANTES de devolver nada. */
  leerCompany(entrada: {
    readonly companyId: CompanyId;
    readonly acceso: Acceso;
  }): Promise<CompanyDetallada | null>;

  crearCompany(entrada: {
    readonly datos: DatosDeNuevaCompany;
    readonly acceso: Acceso;
  }): Promise<CompanyId>;

  /**
   * Cambia el plan si la company cabe en él.
   *
   * La comprobación va DENTRO, por lo mismo que el límite de ubicaciones desde
   * P1: contar fuera y decidir después es una ventana de carrera.
   */
  cambiarPlan(entrada: {
    readonly companyId: CompanyId;
    readonly plan: string;
    readonly acceso: Acceso;
  }): Promise<{ readonly clase: 'cambiado' } | { readonly clase: 'no_cabe'; readonly recurso: string; readonly tiene: number; readonly maximo: number }>;

  cambiarEstado(entrada: {
    readonly companyId: CompanyId;
    readonly estado: string;
    readonly acceso: Acceso;
  }): Promise<boolean>;

  /** EL PENDIENTE ESTRUCTURAL QUE P11 CIERRA: alguien puede por fin leerlo. */
  leerAuditoria(entrada: {
    readonly companyId: CompanyId | null;
    readonly limite: number;
    readonly acceso: Acceso;
  }): Promise<readonly LineaDeAuditoria[]>;

  /** El log del propio back office. No exige motivo: leerlo es lo que se pide. */
  accesosRecientes(limite: number): Promise<readonly AccesoRegistrado[]>;

  /**
   * Contadores de la cola de correo. Sin motivo ni registro de acceso: no se
   * lee ningun dato de ningun tenant (ver `LeerSaludDelCorreo`).
   */
  saludDelCorreo(pendientesDesdeAntesDe: Date): Promise<SaludDelCorreo>;
}
