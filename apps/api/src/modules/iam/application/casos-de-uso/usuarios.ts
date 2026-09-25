/**
 * Invitacion, activacion, reenvio y roles — SPEC §4.
 *
 * LA INVITACION NO DICE SI EL CORREO YA EXISTE, y esa asimetria es deliberada.
 * La unicidad del correo es GLOBAL —el login ocurre antes de saber el tenant—,
 * asi que un mensaje franco convertiria este endpoint en un oraculo: cualquier
 * administrador de cualquier company podria averiguar quien mas usa el sistema
 * probando correos. Se responde siempre igual, y el motivo real va al log.
 *
 * EL TOKEN DE INVITACION SE GUARDA HASHEADO, como el de sesion, y viaja una
 * sola vez, dentro de un enlace, por correo. Son 256 bits: infuerzabrutable,
 * que es lo que permite que el enlace sea la unica credencial para activar.
 *
 * EL CORREO NO SE ENVIA DESDE AQUI: SE ENCOLA (ADR-025). El caso de uso
 * prepara el correo —destinatario, enlace, caducidad— y se lo entrega al
 * repositorio, que lo deja en `email_outbox` DENTRO de la misma transaccion
 * que crea o renueva la invitacion. Antes de P16-A1 el envio era una llamada
 * suelta despues de la transaccion, y en el hueco entre las dos vivian las
 * invitaciones sin correo.
 *
 * REENVIAR INVALIDA EL ENLACE ANTERIOR: el token se sustituye, y `app_user`
 * tiene como mucho UNA invitacion viva. Es lo correcto —un enlace reenviado
 * porque «no llego» no debe dejar vivo el que si llego a otro buzon— y sale
 * gratis del modelo.
 *
 * INVITAR Y REENVIAR PASAN PRIMERO POR EL LIMITE DE TASA (D-16.50): por IP
 * (30/h) y por destinatario (3/h). Aunque haya sesion: un administrador
 * legitimo no invita al mismo correo cuatro veces en una hora, y un
 * administrador con la cuenta robada es exactamente quien inundaria un buzon.
 * En el reenvio el destinatario se sabe despues de buscar al invitado, asi
 * que el limite corre entre la lectura y la escritura, y cuenta la IP aunque
 * el usuario no exista.
 *
 * QUIEN PUEDE TOCAR A QUIEN lo decide `politica-de-roles`, que es dominio puro.
 * Aqui solo se consulta si el objetivo es el OWNER —eso si necesita la base— y
 * se le pasa a la regla.
 */

import type { CorreoAEncolar } from '../../../../shared/application/correo/correo-a-encolar';
import { registrarEventoDeUsuario } from '../../../../shared/application/eventos-de-usuario';
import type { LimitadorDeTasa } from '../../../../shared/application/limite-de-tasa/limitador';
import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { LocationId, UserId } from '../../../../shared/domain/identity/identificadores';
import {
  ContrasenaDebilError,
  NoEncontradoError,
  PermisoDenegadoError,
  SesionInvalidaError,
} from '../../domain/errores';
import { mensajeDelProblema, problemaDeContrasena } from '../../domain/politica-de-contrasenas';
import {
  mensajeDelProblemaDeRol,
  problemaDeAsignacion,
  problemaDeRevocacion,
} from '../../domain/politica-de-roles';
import type { Enlaces } from '../ports/enlaces.port';
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type { RepositorioDeOrganizacion } from '../ports/repositorio-de-organizacion.port';
import type { SesionActiva } from './validar-sesion';

const DIA_MS = 86_400_000;

/** Una invitacion caduca en una semana: tiempo de sobra sin dejar la puerta abierta. */
const DIAS_DE_INVITACION = 7;

const SIN_INVITACION_PENDIENTE = 'Ese usuario no tiene una invitacion pendiente en tu company.';

export interface DependenciasDeUsuarios {
  readonly organizacion: RepositorioDeOrganizacion;
  readonly tokens: GeneradorDeTokens;
  readonly hasher: HasherDeContrasenas;
  readonly auditoria: AuditLogPort;
  readonly enlaces: Enlaces;
  readonly reloj: Reloj;
  readonly limitador: LimitadorDeTasa;
}

export interface DatosDeInvitacion {
  readonly email: string;
  /** La IP del cliente tras el proxy, o `null` sin socket con direccion. */
  readonly ip: string | null;
}

export interface DatosDeReenvio {
  readonly objetivo: UserId;
  readonly ip: string | null;
}

interface InvitacionPreparada {
  readonly tokenHash: string;
  readonly expiraEn: Date;
  readonly correo: CorreoAEncolar;
}

/**
 * Token, caducidad y correo de una invitacion, nueva o reenviada. El token en
 * claro solo existe dentro del enlace: aqui no se devuelve.
 */
function prepararInvitacion(deps: DependenciasDeUsuarios, destino: string): InvitacionPreparada {
  const { token, hash } = deps.tokens.generar();
  const expiraEn = new Date(deps.reloj.ahora().getTime() + DIAS_DE_INVITACION * DIA_MS);

  return {
    tokenHash: hash,
    expiraEn,
    correo: {
      destinatario: destino,
      plantilla: 'INVITACION',
      datos: { enlace: deps.enlaces.deActivacion(token), caducaEn: expiraEn.toISOString() },
    },
  };
}

export class InvitarUsuario {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  /**
   * Responde igual exista o no el correo. Lo unico observable desde fuera es
   * que la operacion se acepto.
   * @throws {LimiteDeSolicitudesError} por IP o por destinatario, antes de hacer nada
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeInvitacion): Promise<void> {
    const destino = datos.email.trim().toLowerCase();

    await this.deps.limitador.exigir({
      kind: 'usuario.invitar',
      ip: datos.ip,
      destinatario: destino,
      ahora: this.deps.reloj.ahora(),
    });

    const { tokenHash, expiraEn, correo } = prepararInvitacion(this.deps, destino);

    const resultado = await this.deps.organizacion.invitar({
      companyId: sesion.companyId,
      email: destino,
      tokenHash,
      expiraEn,
      correo,
    });

    await this.deps.auditoria.record({
      eventType: 'user.invited',
      outcome: resultado.clase === 'invitado' ? 'success' : 'failure',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      // El correo NO va al detalle: SEGURIDAD.md §10 pide solo IDs y escalares.
      detail: { resultado: resultado.clase },
    });
  }
}

export class ReenviarInvitacion {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  /**
   * @throws {LimiteDeSolicitudesError} por IP (exista o no el invitado) o por destinatario
   * @throws {NoEncontradoError} si no esta invitado en la company de quien pide
   */
  public async ejecutar(sesion: SesionActiva, datos: DatosDeReenvio): Promise<void> {
    const { objetivo, ip } = datos;
    const donde = { companyId: sesion.companyId, userId: objetivo };

    const invitado = await this.deps.organizacion.invitadoPendiente(donde);

    await this.deps.limitador.exigir({
      kind: 'usuario.reenvio',
      ip,
      destinatario: invitado?.email ?? null,
      ahora: this.deps.reloj.ahora(),
    });

    if (invitado === null) {
      throw new NoEncontradoError(SIN_INVITACION_PENDIENTE);
    }

    const { tokenHash, expiraEn, correo } = prepararInvitacion(this.deps, invitado.email);
    const resultado = await this.deps.organizacion.reinvitar({ ...donde, tokenHash, expiraEn, correo });

    // Activo entre la lectura y la escritura: la ventana es de milisegundos,
    // pero existe, y el WHERE del repositorio es quien la cierra.
    if (resultado === 'no_pendiente') {
      throw new NoEncontradoError(SIN_INVITACION_PENDIENTE);
    }

    await registrarEventoDeUsuario({
      auditoria: this.deps.auditoria,
      actorId: sesion.userId,
      companyId: sesion.companyId,
      eventType: 'user.invitation_resent',
      detail: { objetivo },
    });
  }
}

export interface DatosDeActivacion {
  readonly token: string;
  readonly contrasena: string;
}

export class AceptarInvitacion {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  /** @throws {SesionInvalidaError} si el token no vale o caduco */
  public async ejecutar(datos: DatosDeActivacion): Promise<void> {
    const invitacion = await this.deps.organizacion.invitacionPorToken(
      this.deps.tokens.hashDe(datos.token),
    );

    // Token inexistente, ya usado o caducado dan la MISMA respuesta: quien
    // prueba tokens no debe poder distinguir "no existe" de "ya se uso".
    if (invitacion === null || invitacion.expiraEn.getTime() <= this.deps.reloj.ahora().getTime()) {
      throw new SesionInvalidaError('desconocida');
    }

    const problema = problemaDeContrasena({
      contrasena: datos.contrasena,
      correo: invitacion.email,
    });
    if (problema !== null) {
      throw new ContrasenaDebilError(mensajeDelProblema(problema));
    }

    await this.deps.organizacion.activarConContrasena({
      companyId: invitacion.companyId,
      userId: invitacion.userId,
      hash: await this.deps.hasher.hash(datos.contrasena),
    });

    await this.deps.auditoria.record({
      eventType: 'user.activated',
      outcome: 'success',
      actorType: 'USER',
      actorId: invitacion.userId,
      companyId: invitacion.companyId,
      ip: null,
      userAgent: null,
      detail: {},
    });
  }
}

export interface DatosDeRol {
  readonly userId: UserId;
  readonly rol: string;
  readonly locationId: LocationId | null;
}

export class AsignarRol {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDeRol): Promise<void> {
    await exigirCambioLegitimo({ organizacion: this.deps.organizacion, sesion, datos, modo: 'asignar' });

    await this.deps.organizacion.asignarRol({
      companyId: sesion.companyId,
      userId: datos.userId,
      rol: datos.rol,
      locationId: datos.locationId,
    });

    await this.deps.auditoria.record({
      eventType: 'user.role_granted',
      outcome: 'success',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { objetivo: datos.userId, rol: datos.rol, ubicacion: datos.locationId ?? 'ninguna' },
    });
  }
}

export class RevocarRol {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  public async ejecutar(sesion: SesionActiva, datos: DatosDeRol): Promise<void> {
    await exigirCambioLegitimo({ organizacion: this.deps.organizacion, sesion, datos, modo: 'revocar' });

    const retiradas = await this.deps.organizacion.revocarRol({
      companyId: sesion.companyId,
      userId: datos.userId,
      rol: datos.rol,
      locationId: datos.locationId,
    });

    await this.deps.auditoria.record({
      eventType: 'user.role_revoked',
      // `failure` cuando no habia nada que retirar: la operacion se pidio y no
      // cambio nada. Registrarlo como exito haria que el log dijera que se
      // revoco un rol que nunca estuvo.
      outcome: retiradas > 0 ? 'success' : 'failure',
      actorType: 'USER',
      actorId: sesion.userId,
      companyId: sesion.companyId,
      ip: null,
      userAgent: null,
      detail: { objetivo: datos.userId, rol: datos.rol, retiradas },
    });
  }
}

/**
 * Las dos comprobaciones que preceden a cualquier cambio de rol.
 *
 * ESTABAN DUPLICADAS EN LOS DOS CASOS DE USO y `audit:duplication` lo marco. No
 * es una queja de estilo: si manana se anade una tercera regla —"no se puede
 * dejar una company sin ningun ADMIN", por ejemplo— con el codigo duplicado se
 * anadiria en un sitio y se olvidaria en el otro, y la ruta olvidada seria la
 * que alguien encuentre.
 */
async function exigirCambioLegitimo(entrada: {
  readonly organizacion: RepositorioDeOrganizacion;
  readonly sesion: SesionActiva;
  readonly datos: DatosDeRol;
  readonly modo: 'asignar' | 'revocar';
}): Promise<void> {
  const { organizacion, sesion, datos, modo } = entrada;

  const esOwner = await exigirObjetivo(organizacion, sesion, datos.userId);
  const actor = { userId: sesion.userId, objetivoUserId: datos.userId, objetivoEsOwner: esOwner };

  const problema =
    modo === 'asignar'
      ? problemaDeAsignacion({
          asignacion: { rol: datos.rol, tieneUbicacion: datos.locationId !== null },
          actor,
        })
      : problemaDeRevocacion(actor);

  if (problema !== null) {
    throw new PermisoDenegadoError(mensajeDelProblemaDeRol(problema));
  }
}

/**
 * Comprueba que el objetivo existe DENTRO de la company de quien pregunta.
 *
 * RLS ya impide tocar filas de otro tenant, asi que sin esto la operacion no
 * fugaria nada: no haria nada. Pero devolver 204 por un usuario de otra company
 * es un oraculo de existencia igualmente, y un 404 honesto es ademas lo que
 * necesita quien se equivoco de identificador.
 */
async function exigirObjetivo(
  organizacion: RepositorioDeOrganizacion,
  sesion: SesionActiva,
  objetivo: UserId,
): Promise<boolean> {
  const esOwner = await organizacion.esOwner({ companyId: sesion.companyId, userId: objetivo });
  if (esOwner === null) {
    throw new NoEncontradoError('Ese usuario no existe en tu company.');
  }
  return esOwner;
}
