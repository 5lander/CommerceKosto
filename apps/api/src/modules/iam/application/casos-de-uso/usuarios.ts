/**
 * Invitacion, activacion y roles — SPEC §4.
 *
 * LA INVITACION NO DICE SI EL CORREO YA EXISTE, y esa asimetria es deliberada.
 * La unicidad del correo es GLOBAL —el login ocurre antes de saber el tenant—,
 * asi que un mensaje franco convertiria este endpoint en un oraculo: cualquier
 * administrador de cualquier company podria averiguar quien mas usa el sistema
 * probando correos. Se responde siempre igual, y el motivo real va al log.
 *
 * EL TOKEN DE INVITACION SE GUARDA HASHEADO, como el de sesion, y viaja una
 * sola vez por correo. Son 256 bits: infuerzabrutable, que es lo que permite
 * que el enlace sea la unica credencial para activar la cuenta.
 *
 * QUIEN PUEDE TOCAR A QUIEN lo decide `politica-de-roles`, que es dominio puro.
 * Aqui solo se consulta si el objetivo es el OWNER —eso si necesita la base— y
 * se le pasa a la regla.
 */

import type { AuditLogPort } from '../../../../shared/application/ports/audit-log.port';
import type { MailerPort } from '../../../../shared/application/ports/mailer.port';
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
import type { GeneradorDeTokens } from '../ports/generador-de-tokens.port';
import type { HasherDeContrasenas } from '../ports/hasher-de-contrasenas.port';
import type { RepositorioDeOrganizacion } from '../ports/repositorio-de-organizacion.port';
import type { SesionActiva } from './validar-sesion';

const DIA_MS = 86_400_000;

/** Una invitacion caduca en una semana: tiempo de sobra sin dejar la puerta abierta. */
const DIAS_DE_INVITACION = 7;

const ASUNTO_DE_INVITACION = 'Te han invitado a costeo-saas';

export interface DependenciasDeUsuarios {
  readonly organizacion: RepositorioDeOrganizacion;
  readonly tokens: GeneradorDeTokens;
  readonly hasher: HasherDeContrasenas;
  readonly auditoria: AuditLogPort;
  readonly correo: MailerPort;
  readonly reloj: Reloj;
}

export class InvitarUsuario {
  public constructor(private readonly deps: DependenciasDeUsuarios) {}

  /**
   * Responde igual exista o no el correo. Lo unico observable desde fuera es
   * que la operacion se acepto.
   */
  public async ejecutar(sesion: SesionActiva, email: string): Promise<void> {
    const destino = email.trim().toLowerCase();
    const { token, hash } = this.deps.tokens.generar();
    const expiraEn = new Date(this.deps.reloj.ahora().getTime() + DIAS_DE_INVITACION * DIA_MS);

    const resultado = await this.deps.organizacion.invitar({
      companyId: sesion.companyId,
      email: destino,
      tokenHash: hash,
      expiraEn,
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

    if (resultado.clase !== 'invitado') {
      return;
    }

    await this.deps.correo.send({
      to: destino,
      subject: ASUNTO_DE_INVITACION,
      body:
        'Te han invitado a usar costeo-saas. Para activar tu cuenta necesitas este codigo, ' +
        `que caduca en ${String(DIAS_DE_INVITACION)} dias:\n\n${token}\n\n` +
        'Si no esperabas esta invitacion, ignora este mensaje: sin el codigo no ocurre nada.',
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
