/**
 * La identidad del operador de back office. **Separada de la de `iam` a propósito.**
 *
 * **UN OPERADOR NO ES UN `AppUser`.** Un `AppUser` pertenece a una company; un
 * operador no pertenece a ninguna, y eso no es un detalle de modelado: es la
 * razón por la que puede mirar a todas. Meterlo en `app_user` con un rol
 * especial obligaría a que exista una fila de usuario sin tenant en la tabla que
 * toda la aplicación cliente consulta, y bastaría un `WHERE` olvidado para que
 * apareciera en la lista de usuarios de alguien.
 *
 * **Y SE REUTILIZA LO QUE SÍ DEBE SER IGUAL:** el hasher Argon2id y la política
 * de vigencia de sesión. Los parámetros de Argon2 viven en un solo sitio; tener
 * dos sería tener dos, y una acabaría siendo la débil.
 */

import { randomBytes, createHash } from 'node:crypto';

import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { HasherDeContrasenas } from '../../../iam/application/ports/hasher-de-contrasenas.port';
import {
  AccesoDeOperadorDenegadoError,
  SesionDeOperadorInvalidaError,
} from '../../domain/errores';
import type {
  OperatorId,
  RepositorioDeBackoffice,
  SesionDeOperador,
} from '../ports/repositorio-de-backoffice.port';

const ESTADO_ACTIVO = 'ACTIVE';

/** Bytes de entropía del token opaco. Lo mismo que la sesión de la app cliente. */
const BYTES_DEL_TOKEN = 32;

/**
 * Ocho horas: una jornada.
 *
 * MÁS CORTA QUE LA DE LA APP CLIENTE a propósito. Una sesión de back office
 * abierta es una llave que abre todos los tenants a la vez; que caduque al final
 * del día no cuesta nada a quien la usa una vez por semana.
 */
const HORAS_DE_SESION = 8;
const MS_POR_HORA = 3_600_000;

/** Se exporta para que la cookie NO tenga su propia copia: una sola verdad. */
export const VIGENCIA_MS = HORAS_DE_SESION * MS_POR_HORA;

export interface DependenciasDeSesionDeOperador {
  readonly repositorio: RepositorioDeBackoffice;
  readonly hasher: HasherDeContrasenas;
  readonly reloj: Reloj;
}

/**
 * El hash del token que se guarda.
 *
 * SHA-256 y no Argon2: el token lo genera el servidor con 256 bits de entropía,
 * así que no hay nada que un ataque de diccionario pueda adivinar. Argon2 aquí
 * solo añadiría 50 ms a cada petición. Es la misma decisión que `iam`.
 */
function hashDelToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class IniciarSesionDeOperador {
  public constructor(private readonly deps: DependenciasDeSesionDeOperador) {}

  /** @throws {AccesoDeOperadorDenegadoError} */
  public async ejecutar(entrada: {
    readonly email: string;
    readonly contrasena: string;
    readonly ip: string | null;
    readonly userAgent: string | null;
  }): Promise<SesionDeOperadorAbierta> {
    const credencial = await this.deps.repositorio.buscarCredencial(entrada.email.toLowerCase());

    // SE VERIFICA SIEMPRE, exista el operador o no, y por eso el puerto acepta
    // `null`: sin esa rama, la respuesta para un correo inexistente tardaria
    // microsegundos y la de uno existente decenas de milisegundos, y con esa
    // diferencia se enumera la lista de quien puede ver a todos los clientes.
    const correcta = await this.deps.hasher.verificar(
      credencial?.passwordHash ?? null,
      entrada.contrasena,
    );

    if (credencial === null || !correcta || credencial.status !== ESTADO_ACTIVO) {
      throw new AccesoDeOperadorDenegadoError();
    }

    const token = randomBytes(BYTES_DEL_TOKEN).toString('base64url');
    const csrf = randomBytes(BYTES_DEL_TOKEN).toString('base64url');
    await this.deps.repositorio.abrirSesion({
      operatorId: credencial.operatorId,
      tokenHash: hashDelToken(token),
      csrfToken: csrf,
      expiraEn: new Date(this.deps.reloj.ahora().getTime() + VIGENCIA_MS),
      ip: entrada.ip,
      userAgent: entrada.userAgent,
    });

    return { token, csrf };
  }
}

/**
 * Lo que el login del operador entrega: la credencial y el token que firma sus
 * mutaciones. El primero va a la cookie; el segundo al cuerpo (ADR-021).
 */
export interface SesionDeOperadorAbierta {
  readonly token: string;
  readonly csrf: string;
}

/** El contexto que viaja con cada petición del back office. */
export interface OperadorActivo {
  readonly operatorId: OperatorId;
  readonly email: string;
  /** El token anti-CSRF de esta sesión, ya comprobado como no nulo. */
  readonly csrfToken: string;
}

export class ValidarSesionDeOperador {
  public constructor(private readonly deps: DependenciasDeSesionDeOperador) {}

  /** @throws {SesionDeOperadorInvalidaError} */
  public async ejecutar(token: string | null): Promise<OperadorActivo> {
    if (token === null || token.trim() === '') {
      throw new SesionDeOperadorInvalidaError('ausente');
    }

    const sesion = await this.deps.repositorio.sesionPorToken(hashDelToken(token));
    if (sesion === null) {
      throw new SesionDeOperadorInvalidaError('desconocida');
    }

    exigirVigente(sesion, this.deps.reloj.ahora());

    // Sesión anterior a P16-A2: sin token anti-CSRF no puede probar el origen
    // de una mutación, y media sesión no es una sesión. Vuelve a entrar.
    const csrfToken = sesion.csrfToken;
    if (csrfToken === null) throw new SesionDeOperadorInvalidaError('sin_csrf');

    return { operatorId: sesion.operatorId, email: sesion.email, csrfToken };
  }
}

/** @throws {SesionDeOperadorInvalidaError} */
function exigirVigente(sesion: SesionDeOperador, ahora: Date): void {
  if (sesion.revocadaEn !== null) throw new SesionDeOperadorInvalidaError('revocada');
  if (sesion.expiraEn.getTime() <= ahora.getTime()) {
    throw new SesionDeOperadorInvalidaError('caducada');
  }
  // Suspender a un operador surte efecto YA, sin esperar a que caduque.
  if (sesion.estado !== ESTADO_ACTIVO) throw new SesionDeOperadorInvalidaError('suspendido');
}

export class CerrarSesionDeOperador {
  public constructor(private readonly deps: DependenciasDeSesionDeOperador) {}

  public async ejecutar(token: string): Promise<void> {
    await this.deps.repositorio.revocarSesion(hashDelToken(token));
  }
}
