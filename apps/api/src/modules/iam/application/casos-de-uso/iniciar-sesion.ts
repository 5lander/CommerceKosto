/**
 * Caso de uso de inicio de sesion — SEGURIDAD.md §2.1 y §2.2.
 *
 * ES LA PIEZA QUE JUNTA LAS TRES QUE YA EXISTIAN POR SEPARADO: la politica anti
 * fuerza bruta (dominio puro), el hasher de Argon2id y la funcion `auth_lookup`
 * de la base. Aqui no hay ninguna regla nueva: hay un orden, y el orden es lo
 * que decide si el sistema filtra informacion o no.
 *
 * EL ORDEN, Y POR QUE ES ESE:
 *
 *   1. bloqueo    se comprueba ANTES de tocar la contrasena. Un atacante
 *                 bloqueado no debe conseguir que el servidor gaste 64 MiB y
 *                 decenas de milisegundos en verificar su intento: eso
 *                 convertiria el propio login en una denegacion de servicio.
 *
 *   2. lookup     una sola lectura, por `auth_lookup`, que es la unica lectura
 *                 sin tenant efectivo del sistema.
 *
 *   3. verificar  SIEMPRE se ejecuta, exista o no el usuario. Es lo que impide
 *                 distinguir "el correo no existe" de "la contrasena falla" por
 *                 el tiempo de respuesta. Por eso el puerto acepta `null`.
 *
 *   4. estado     usuario y company activos se comprueban DESPUES de verificar,
 *                 no antes. Comprobarlos antes ahorraria el hash y volveria a
 *                 abrir el canal de tiempo que el paso 3 acaba de cerrar.
 *
 * EL AVISO DE BLOQUEO SE ENCOLA, NO SE ENVIA (ADR-025, desde P16-A1): va a
 * `email_outbox` bajo el tenant de la cuenta, como la invitacion y el
 * restablecimiento, y lo entrega el despachador. Antes salia por `MailerPort`
 * directamente desde la API, que en produccion tiene `MAIL_ADAPTER=fake`: el
 * aviso existia solo en la memoria del proceso y nadie lo veia.
 *
 * NO CONOCE NESTJS NI PRISMA. Recibe todo por puertos y se prueba entero con
 * dobles en memoria, con la base apagada (CLAUDE.md §2).
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { CompanyId, UserId } from '../../../../shared/domain/identity/identificadores';
import {
  AccesoBloqueadoError,
  CredencialesInvalidasError,
  RociadoDeContrasenasError,
  type MotivoDelRechazo,
} from '../../domain/errores';
import {
  VENTANA_A_CONSULTAR_MS,
  bloqueoEfectivo,
  cruzaUmbralDeBloqueo,
  evaluarIntentos,
  evaluarRociadoPorIp,
  type FalloPorIp,
} from '../../domain/politica-de-intentos';
import { caducidadDesde } from '../../domain/politica-de-sesion';
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type {
  CredencialDeLogin,
  RepositorioDeAutenticacion,
} from '../ports/repositorio-de-autenticacion.port';

const ESTADO_ACTIVO = 'ACTIVE';

/**
 * El "objeto de parametros" de CLAUDE.md §3. Se inyecta como una sola pieza
 * (ver `infrastructure/dependencias-de-iam.ts`), asi que el caso de uso tiene
 * un unico parametro por mucho que necesite cinco colaboradores.
 */
export interface DependenciasDeIniciarSesion {
  readonly repositorio: RepositorioDeAutenticacion;
  readonly hasher: HasherDeContrasenas;
  readonly tokens: GeneradorDeTokens;
  readonly auditoria: AuditLogPort;
  readonly reloj: Reloj;
}

export interface DatosDeLogin {
  readonly email: string;
  readonly contrasena: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
}

export interface SesionAbierta {
  /** Viaja al cliente una sola vez, en la cookie. No se guarda en ningun sitio. */
  readonly token: string;
  /**
   * El token anti-CSRF (ADR-021). Viaja en el CUERPO de la respuesta, no en
   * una cookie: una cookie viajaria sola en la peticion cruzada, que es
   * exactamente el canal del que este token defiende.
   */
  readonly csrf: string;
  readonly expiraEn: Date;
  readonly userId: UserId;
  readonly companyId: CompanyId;
}

/** Lo que los pasos internos necesitan saber del intento en curso. */
interface Intento {
  readonly email: string;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly ahora: Date;
}

function normalizarCorreo(email: string): string {
  return email.trim().toLowerCase();
}

export class IniciarSesion {
  public constructor(private readonly deps: DependenciasDeIniciarSesion) {}

  public async ejecutar(datos: DatosDeLogin): Promise<SesionAbierta> {
    const intento: Intento = {
      email: normalizarCorreo(datos.email),
      ip: datos.ip,
      userAgent: datos.userAgent,
      ahora: this.deps.reloj.ahora(),
    };

    const fallosPrevios = await this.exigirNoBloqueado(intento);

    const credencial = await this.deps.repositorio.buscarCredencial(intento.email);
    const coincide = await this.deps.hasher.verificar(
      credencial?.passwordHash ?? null,
      datos.contrasena,
    );

    const motivo = this.motivoDelRechazo(credencial, coincide);
    if (motivo !== null || credencial === null) {
      return this.rechazar({
        intento,
        credencial,
        fallosPrevios,
        motivo: motivo ?? 'correo_desconocido',
      });
    }

    return this.abrir(intento, credencial, datos.contrasena);
  }

  /**
   * @returns los fallos por cuenta ya acumulados, que el rechazo necesita para
   *   saber si el suyo es el que cruza el umbral y dispara el aviso.
   * @throws {AccesoBloqueadoError}
   */
  private async exigirNoBloqueado(intento: Intento): Promise<number> {
    const desde = new Date(intento.ahora.getTime() - VENTANA_A_CONSULTAR_MS);
    const fallos = await this.deps.repositorio.fallosRecientes({
      email: intento.email,
      ip: intento.ip,
      desde,
    });

    // Los dos ejes son distintos a proposito (D-16.196): la CUENTA se bloquea
    // con escalada; la IP solo se limita, y nunca por lo que haga una sola
    // cuenta. Se mira primero el bloqueo, que es el que protege la credencial.
    const bloqueado = bloqueoEfectivo([
      evaluarIntentos({ fallos: fallos.porCuenta, ahora: intento.ahora }),
    ]);

    if (bloqueado === null) {
      await this.exigirSinRociado(intento, fallos.porIp);
      return fallos.porCuenta.length;
    }

    await this.deps.repositorio.registrarIntento({
      email: intento.email,
      ip: intento.ip,
      outcome: 'blocked',
    });
    await this.registrar({
      intento,
      eventType: 'auth.login.blocked',
      outcome: 'blocked',
      credencial: null,
      detail: { bloqueadoHasta: bloqueado.toISOString() },
    });

    throw new AccesoBloqueadoError(bloqueado);
  }

  /**
   * El eje de IP: rociado de contrasenas, no bloqueo (D-16.196, ADR-028).
   *
   * Se comprueba DESPUES del bloqueo por cuenta y ANTES de tocar la contrasena:
   * un barrido tampoco debe conseguir que el servidor gaste 64 MiB por intento.
   *
   * @throws {RociadoDeContrasenasError}
   */
  private async exigirSinRociado(intento: Intento, fallosPorIp: readonly FalloPorIp[]): Promise<void> {
    const limite = evaluarRociadoPorIp({ fallos: fallosPorIp, ahora: intento.ahora });
    if (limite.permitido || limite.hasta === null) {
      return;
    }

    await this.deps.repositorio.registrarIntento({
      email: intento.email,
      ip: intento.ip,
      outcome: 'blocked',
    });
    await this.registrar({
      intento,
      eventType: 'auth.login.ip_limited',
      outcome: 'blocked',
      credencial: null,
      detail: { hasta: limite.hasta.toISOString(), cuentasDistintas: limite.cuentasDistintas },
    });

    throw new RociadoDeContrasenasError(limite.hasta, intento.ahora);
  }

  /**
   * El motivo real. Nunca sale a la respuesta: solo al log de auditoria.
   *
   * Devuelve `null` unicamente cuando TODO esta bien, asi que quien llama sabe
   * que la credencial existe y esta activa sin repetir las comprobaciones.
   */
  private motivoDelRechazo(
    credencial: CredencialDeLogin | null,
    coincide: boolean,
  ): MotivoDelRechazo | null {
    if (credencial === null) {
      return 'correo_desconocido';
    }
    if (!coincide) {
      return 'contrasena_incorrecta';
    }
    if (credencial.userStatus !== ESTADO_ACTIVO) {
      return 'usuario_no_activo';
    }
    if (credencial.companyStatus !== ESTADO_ACTIVO) {
      return 'company_no_activa';
    }
    return null;
  }

  private async rechazar(entrada: {
    readonly intento: Intento;
    readonly credencial: CredencialDeLogin | null;
    readonly fallosPrevios: number;
    readonly motivo: MotivoDelRechazo;
  }): Promise<never> {
    const { intento, credencial, fallosPrevios, motivo } = entrada;

    await this.deps.repositorio.registrarIntento({
      email: intento.email,
      ip: intento.ip,
      outcome: 'failure',
    });
    await this.registrar({
      intento,
      eventType: 'auth.login.failed',
      outcome: 'failure',
      credencial,
      detail: { motivo },
    });

    // El aviso solo se encola si la cuenta EXISTE. Encolarlo siempre convertiria
    // el login en un relay de correo hacia direcciones que elige el atacante.
    if (credencial !== null && cruzaUmbralDeBloqueo(fallosPrevios)) {
      await this.avisarAlTitular(credencial, intento.email);
    }

    throw new CredencialesInvalidasError(motivo);
  }

  private async abrir(
    intento: Intento,
    credencial: CredencialDeLogin,
    contrasena: string,
  ): Promise<SesionAbierta> {
    await this.endurecerSiHaceFalta(credencial, contrasena);

    const { token, hash } = this.deps.tokens.generar();
    // DOS tokens independientes, del mismo generador y del mismo tamano. No se
    // deriva uno del otro: un CSRF que fuera `hash(sesion)` se recalcularia
    // desde la cookie robada.
    //
    // EL TOKEN NACE CON LA SESION Y MUERE CON ELLA, y no hay rotacion en medio.
    // Abrir sesion NO revoca las anteriores —este caso de uso no llama a
    // ningun `revocar`, a proposito: el movil y el ordenador a la vez son dos
    // sesiones vivas—, asi que volver a entrar no invalida el token de antes:
    // le da uno nuevo a una sesion nueva. Lo que si garantiza es que ningun
    // token lo elige el cliente y que ninguno vale en otra sesion (ADR-021).
    const csrf = this.deps.tokens.generar().token;
    const expiraEn = caducidadDesde(intento.ahora);

    await this.deps.repositorio.abrirSesion({
      companyId: credencial.companyId,
      userId: credencial.userId,
      tokenHash: hash,
      csrfToken: csrf,
      expiresAt: expiraEn,
      ip: intento.ip,
      userAgent: intento.userAgent,
    });

    await this.deps.repositorio.registrarIntento({
      email: intento.email,
      ip: intento.ip,
      outcome: 'success',
    });
    await this.deps.repositorio.olvidarFallos(intento.email);
    await this.registrar({
      intento,
      eventType: 'auth.login.succeeded',
      outcome: 'success',
      credencial,
      detail: {},
    });

    return { token, csrf, expiraEn, userId: credencial.userId, companyId: credencial.companyId };
  }

  /**
   * El login es el UNICO momento en que la contrasena esta en claro y se puede
   * rehashear con parametros mas duros. Si esto no ocurriera aqui, los hashes
   * creados hoy seguirian con los parametros de hoy para siempre.
   */
  private async endurecerSiHaceFalta(
    credencial: CredencialDeLogin,
    contrasena: string,
  ): Promise<void> {
    if (credencial.passwordHash === null) {
      return;
    }
    if (!this.deps.hasher.necesitaRehash(credencial.passwordHash)) {
      return;
    }

    await this.deps.repositorio.guardarHashDeContrasena({
      companyId: credencial.companyId,
      userId: credencial.userId,
      hash: await this.deps.hasher.hash(contrasena),
    });
  }

  /**
   * Sin enlaces y sin datos dentro (`datos: {}`): un correo automatico de
   * seguridad con un enlace es indistinguible de la suplantacion que dice
   * prevenir. El texto vive en `shared/application/correo/plantillas.ts`.
   */
  private async avisarAlTitular(credencial: CredencialDeLogin, email: string): Promise<void> {
    await this.deps.repositorio.encolarCorreo({
      companyId: credencial.companyId,
      userId: credencial.userId,
      correo: { destinatario: email, plantilla: 'BLOQUEO', datos: {} },
    });
  }

  private async registrar(entrada: {
    readonly intento: Intento;
    readonly eventType: string;
    readonly outcome: 'success' | 'failure' | 'blocked';
    readonly credencial: CredencialDeLogin | null;
    readonly detail: Readonly<Record<string, string | number | boolean>>;
  }): Promise<void> {
    const { intento, credencial } = entrada;

    await this.deps.auditoria.record({
      eventType: entrada.eventType,
      outcome: entrada.outcome,
      actorType: credencial === null ? 'ANONYMOUS' : 'USER',
      actorId: credencial?.userId ?? null,
      companyId: credencial?.companyId ?? null,
      ip: intento.ip,
      userAgent: intento.userAgent,
      detail: entrada.detail,
    });
  }
}
