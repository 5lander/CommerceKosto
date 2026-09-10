/**
 * Restablecimiento de contrasena, en dos pasos y sin sesion — D-16.26, D-16.47.
 *
 * LOS DOS ENDPOINTS SON PUBLICOS Y NO OPERAN BAJO TENANT: quien no puede entrar
 * es justamente quien los usa. Por eso ninguna de las dos escrituras que
 * necesitan «antes de saber quien es» pasa por el camino normal: van por las
 * dos unicas funciones `SECURITY DEFINER` que escriben, con la forma exacta del
 * hueco. Lo que si tiene tenant —guardar el hash y revocar las sesiones— se
 * hace despues, por el camino de siempre, con la company que la definer devolvio.
 *
 * SOLICITAR RESPONDE IGUAL EXISTA O NO EL CORREO, y hace EL MISMO TRABAJO en
 * Node en los dos casos: genera el token, calcula la caducidad, construye el
 * enlace y llama a la base. Que el correo exista se decide dentro de la
 * funcion, que sin usuario activo no hace nada y devuelve lo mismo. Un `if`
 * aqui —«si no existe, no generes el token»— seria un canal de tiempo que
 * enumera el padron. LO QUE SI DIFIERE es lo que la base hace por dentro: con
 * usuario, dos INSERT mas (milisegundos). Ese residuo no se disimula: se
 * acota con el limite de tasa (10/h por IP, 3/h por destinatario), que impide
 * muestrearlo, y una prueba de integracion fija que se queda en la escala de
 * un INSERT y nunca en la de un hash (ADR-025).
 *
 * RESTABLECER GASTA EL TOKEN ANTES DE MIRAR LA CONTRASENA. Es el orden que
 * cierra el reuso: un token que sobreviviera a un intento fallido serviria para
 * seguir intentando. El coste es que una contrasena debil obliga a pedir otro
 * enlace, y eso se dice en la API. Inexistente, usado, caducado y vacio dan
 * el MISMO error.
 *
 * RESTABLECER REVOCA TODAS LAS SESIONES (SEGURIDAD.md §2.2), como el cambio de
 * contrasena: si alguien pide un restablecimiento es porque sospecha, y una
 * sesion ajena que sobreviviera al cambio dejaria al intruso exactamente igual
 * de dentro.
 *
 * LOS DOS PASAN PRIMERO POR EL LIMITE DE TASA (D-16.50): solicitar, por IP
 * (10/h) y por destinatario (3/h); restablecer, por IP (10/h). Antes de
 * generar nada, antes de gastar nada: un limite que corre despues del trabajo
 * limita la respuesta, no el trabajo. La IP es la que `ipDelCliente` resolvio
 * en el controlador (D-16.49), y es la misma que va a `audit_log`.
 */

import type { LimitadorDeTasa } from '../../../../shared/application/limite-de-tasa/limitador';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import { ContrasenaDebilError, TokenDeRestablecimientoInvalidoError } from '../../domain/errores';
import { mensajeDelProblema, problemaDeContrasena } from '../../domain/politica-de-contrasenas';
import type { Enlaces } from '../ports/enlaces.port';
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type {
  RepositorioDeAutenticacion,
  UsuarioRestablecido,
} from '../ports/repositorio-de-autenticacion.port';

const HORA_MS = 3_600_000;

export interface DependenciasDeRestablecimiento {
  readonly repositorio: RepositorioDeAutenticacion;
  readonly tokens: GeneradorDeTokens;
  readonly hasher: HasherDeContrasenas;
  readonly auditoria: AuditLogPort;
  readonly enlaces: Enlaces;
  readonly reloj: Reloj;
  readonly limitador: LimitadorDeTasa;
  /** `HORAS_DE_RESTABLECIMIENTO`, configuracion versionada (D-16.34). */
  readonly horasDeRestablecimiento: number;
}

export interface SolicitudDeRestablecimiento {
  readonly email: string;
  /** La IP del cliente tras el proxy, o `null` sin socket con direccion. */
  readonly ip: string | null;
}

export class SolicitarRestablecimiento {
  public constructor(private readonly deps: DependenciasDeRestablecimiento) {}

  /**
   * Nunca lanza por el correo: la respuesta es la misma exista o no.
   * @throws {LimiteDeSolicitudesError} por IP o por destinatario, antes de hacer nada
   */
  public async ejecutar(solicitud: SolicitudDeRestablecimiento): Promise<void> {
    const destino = solicitud.email.trim().toLowerCase();
    const ahora = this.deps.reloj.ahora();

    await this.deps.limitador.exigir({ kind: 'password.olvido', ip: solicitud.ip, destinatario: destino, ahora });

    const { token, hash } = this.deps.tokens.generar();
    const expiraEn = new Date(ahora.getTime() + this.deps.horasDeRestablecimiento * HORA_MS);

    await this.deps.repositorio.solicitarRestablecimiento({
      email: destino,
      tokenHash: hash,
      expiraEn,
      correo: {
        destinatario: destino,
        plantilla: 'RESTABLECIMIENTO',
        datos: { enlace: this.deps.enlaces.deRestablecimiento(token), caducaEn: expiraEn.toISOString() },
      },
    });

    // Sin company y sin actor: no se sabe quien pidio, y decirlo en el log
    // seria guardar el correo de un desconocido. Con la IP, que es un dato de
    // acceso y no identifica a nadie por si sola (SEGURIDAD.md §10).
    await this.deps.auditoria.record({
      eventType: 'auth.password.reset_requested',
      outcome: 'success',
      actorType: 'ANONYMOUS',
      actorId: null,
      companyId: null,
      ip: solicitud.ip,
      userAgent: null,
      detail: {},
    });
  }
}

export interface DatosDeRestablecimiento {
  readonly token: string;
  readonly contrasena: string;
  readonly ip: string | null;
}

export class RestablecerContrasena {
  public constructor(private readonly deps: DependenciasDeRestablecimiento) {}

  /**
   * @returns cuantas sesiones se revocaron.
   * @throws {LimiteDeSolicitudesError} por IP, antes de tocar el token
   * @throws {TokenDeRestablecimientoInvalidoError} vacio, inexistente, usado o caducado
   * @throws {ContrasenaDebilError} si la nueva no cumple la politica (el token ya se gasto)
   */
  public async ejecutar(datos: DatosDeRestablecimiento): Promise<number> {
    await this.deps.limitador.exigir({
      kind: 'password.restablecimiento',
      ip: datos.ip,
      ahora: this.deps.reloj.ahora(),
    });

    const usuario = await this.consumir(datos.token);
    const correo = await this.deps.repositorio.correoDelUsuario(usuario);

    // Un usuario que la definer acaba de devolver y el tenant no ve no deberia
    // poder ocurrir; si ocurre, se cierra en vez de restablecer a ciegas.
    if (correo === null) {
      throw new TokenDeRestablecimientoInvalidoError();
    }

    const problema = problemaDeContrasena({ contrasena: datos.contrasena, correo });
    if (problema !== null) {
      throw new ContrasenaDebilError(mensajeDelProblema(problema));
    }

    await this.deps.repositorio.guardarHashDeContrasena({
      ...usuario,
      hash: await this.deps.hasher.hash(datos.contrasena),
    });

    const revocadas = await this.deps.repositorio.revocarSesionesDe({
      ...usuario,
      ahora: this.deps.reloj.ahora(),
    });

    await this.deps.auditoria.record({
      eventType: 'auth.password.reset_completed',
      outcome: 'success',
      actorType: 'USER',
      actorId: usuario.userId,
      companyId: usuario.companyId,
      ip: datos.ip,
      userAgent: null,
      detail: { sesionesRevocadas: revocadas },
    });

    return revocadas;
  }

  private async consumir(token: string): Promise<UsuarioRestablecido> {
    // El vacio se corta antes de hashear: `hashDe('')` es un hash valido de
    // nada, y buscarlo en la base seria trabajo por un error de formato.
    if (token.trim() === '') {
      throw new TokenDeRestablecimientoInvalidoError();
    }

    const usuario = await this.deps.repositorio.consumirRestablecimiento({
      tokenHash: this.deps.tokens.hashDe(token),
      ahora: this.deps.reloj.ahora(),
    });
    if (usuario === null) {
      throw new TokenDeRestablecimientoInvalidoError();
    }
    return usuario;
  }
}
