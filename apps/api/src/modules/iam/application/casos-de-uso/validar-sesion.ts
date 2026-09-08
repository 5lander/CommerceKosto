/**
 * BARRERA 3 de CLAUDE.md §4.1 — de donde sale el tenant.
 *
 * NINGUN ENDPOINT ACEPTA `company_id` DE ENTRADA. El tenant sale de aqui, y
 * solo de aqui: del token opaco que presenta el cliente, resuelto contra la
 * tabla `session`. Un cliente puede mentir sobre cualquier cosa que escriba en
 * la peticion; no puede mentir sobre que fila de `session` tiene su token.
 *
 * LO QUE DEVUELVE ES EL CONTEXTO COMPLETO —tenant, usuario, capacidades y
 * alcance de ubicaciones— porque la alternativa es que cada endpoint vuelva a
 * consultarlos, y un endpoint que se olvida de consultar el alcance es un
 * endpoint que responde con datos de otra ubicacion.
 *
 * ES APPLICATION: no sabe de cookies, de cabeceras ni de NestJS. Recibe un
 * token y devuelve un contexto o lanza.
 */

import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type {
  CompanyId,
  LocationId,
  SessionId,
  UserId,
} from '../../../../shared/domain/identity/identificadores';
import { SesionInvalidaError, UbicacionFueraDeAlcanceError } from '../../domain/errores';
import { estadoDeSesion } from '../../domain/politica-de-sesion';
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type {
  AlcanceDeUsuario,
  RepositorioDeAutenticacion,
} from '../ports/repositorio-de-autenticacion.port';

const ESTADO_ACTIVO = 'ACTIVE';

/**
 * Cada cuanto se refresca `last_seen_at`.
 *
 * ESCRIBIRLO EN CADA PETICION SERIA UN `UPDATE` POR CADA LECTURA. Con una
 * pantalla que consulta media docena de endpoints, eso multiplica por seis las
 * escrituras de la aplicacion para ganar una precision —el minuto exacto de la
 * ultima actividad— que a nadie le sirve: el limite por inactividad es de
 * cuatro horas. Se refresca como mucho cada cinco minutos, y el efecto sobre
 * el limite es despreciable (OPTIMIZACION.md §3).
 */
const REFRESCO_DE_ACTIVIDAD_MS = 300_000;

export interface DependenciasDeValidarSesion {
  readonly repositorio: RepositorioDeAutenticacion;
  readonly tokens: GeneradorDeTokens;
  readonly reloj: Reloj;
}

/**
 * El contexto que viaja con la peticion. Es lo que los guards y los casos de
 * uso leen para saber quien pregunta y que puede ver.
 */
export interface SesionActiva {
  readonly sessionId: SessionId;
  readonly userId: UserId;
  readonly companyId: CompanyId;
  readonly permisos: readonly string[];
  readonly alcance: AlcanceDeUsuario;
  /** Las de la company, para comprobar pertenencia. Ver el puerto. */
  readonly ubicacionesDeCompany: readonly LocationId[];
}

/**
 * Comprueba que la ubicacion es de esta company Y esta en el alcance.
 *
 * SON DOS COMPROBACIONES Y EL ORDEN IMPORTA. La primera —¿es siquiera mia?— se
 * le hace a TODO el mundo, incluido el `OWNER`; la segunda —¿puedo con ella?—
 * solo a quien tiene alcance de ubicaciones.
 *
 * POR QUE LA PRIMERA EXISTE (P15). Antes esta funcion salia temprano si el
 * alcance era de company, asi que un `locationId` de OTRA company pasaba entera:
 * `GET /costeo?locationId=<ajena>` respondia **200**. No habia fuga —RLS filtra
 * y lo devuelto eran los productos del propio usuario— pero incumplia
 * CLAUDE.md 4.4 y, peor para un producto cuyo valor es el numero, ensenaba una
 * carta entera a coste cero. Un numero plausible y falso es peor que un error.
 *
 * Lo encontro el pentest de P15, no una revision de codigo.
 *
 * @throws {UbicacionFueraDeAlcanceError}
 */
export function exigirUbicacionEnAlcance(sesion: SesionActiva, locationId: LocationId): void {
  if (!sesion.ubicacionesDeCompany.includes(locationId)) {
    throw new UbicacionFueraDeAlcanceError();
  }
  if (sesion.alcance.clase === 'company') {
    return;
  }
  if (!sesion.alcance.ids.includes(locationId)) {
    throw new UbicacionFueraDeAlcanceError();
  }
}

export class ValidarSesion {
  public constructor(private readonly deps: DependenciasDeValidarSesion) {}

  /** @throws {SesionInvalidaError} */
  public async ejecutar(token: string | null): Promise<SesionActiva> {
    if (token === null || token.trim() === '') {
      throw new SesionInvalidaError('ausente');
    }

    const contexto = await this.deps.repositorio.contextoDeSesion(this.deps.tokens.hashDe(token));
    if (contexto === null) {
      throw new SesionInvalidaError('desconocida');
    }

    const ahora = this.deps.reloj.ahora();
    const estado = estadoDeSesion(contexto.vigencia, ahora);
    if (estado !== 'vigente') {
      throw new SesionInvalidaError(estado);
    }

    // Suspender a un usuario o a una company tiene que surtir efecto YA, sin
    // esperar a que caduquen sus sesiones. Se comprueba en cada peticion.
    if (contexto.userStatus !== ESTADO_ACTIVO || contexto.companyStatus !== ESTADO_ACTIVO) {
      throw new SesionInvalidaError('revocada');
    }

    await this.refrescarActividad({
      companyId: contexto.companyId,
      sessionId: contexto.sessionId,
      ultimaVez: contexto.vigencia.lastSeenAt,
      ahora,
    });

    return {
      sessionId: contexto.sessionId,
      userId: contexto.userId,
      companyId: contexto.companyId,
      permisos: contexto.permisos,
      alcance: contexto.alcance,
      ubicacionesDeCompany: contexto.ubicacionesDeCompany,
    };
  }

  private async refrescarActividad(entrada: {
    readonly companyId: CompanyId;
    readonly sessionId: SessionId;
    readonly ultimaVez: Date;
    readonly ahora: Date;
  }): Promise<void> {
    const { companyId, sessionId, ultimaVez, ahora } = entrada;

    if (ahora.getTime() - ultimaVez.getTime() < REFRESCO_DE_ACTIVIDAD_MS) {
      return;
    }
    await this.deps.repositorio.marcarVista({ companyId, sessionId, ahora });
  }
}
