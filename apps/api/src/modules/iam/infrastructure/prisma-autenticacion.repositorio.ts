/**
 * El puerto de autenticacion, sobre PostgreSQL.
 *
 * DOS CAMINOS, Y LA DIFERENCIA ES DE SEGURIDAD, NO DE ESTILO:
 *
 *   sin tenant   `buscarCredencial` y `contextoDeSesion`, las dos lecturas que
 *                ocurren antes de saber el tenant; y desde P16-A1
 *                `solicitarRestablecimiento` y `consumirRestablecimiento`, las
 *                dos ESCRITURAS que ocurren sin sesion (D-16.47). Todas van
 *                por funciones `SECURITY DEFINER` con la forma exacta del
 *                hueco: se entra por el correo o por el hash del token, y
 *                sale una fila o ninguna. No admiten ningun otro filtro, asi
 *                que con ellas no se puede enumerar ni reescribir nada mas.
 *
 *   con tenant   todo lo demas. Pasa por `TenantTransaction.run()`, con RLS
 *                filtrando por debajo.
 *
 * LAS FILAS CRUDAS SE VALIDAN CON ZOD. Para TypeScript, lo que devuelve
 * `$queryRaw` es `unknown`: es un limite externo como cualquier otro, y
 * CLAUDE.md §3 pide esquema en todos. La alternativa —anotar el generico y
 * confiar— es una promesa que nadie comprueba: el dia que una columna cambie de
 * nombre en una migracion, la promesa seguiria compilando y el valor llegaria
 * `undefined` a la logica de sesion.
 *
 * `updateMany` Y `createMany` EN VEZ DE `update` Y `create` donde se puede: no
 * emiten `RETURNING`, que bajo RLS exige pasar tambien la politica de SELECT
 * (INC-010). Ademas repiten `company_id` en el WHERE — RLS ya lo filtra, pero
 * una defensa que solo esta en un sitio es una defensa que se cae entera si ese
 * sitio falla.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  datosParaGuardar,
  type CorreoAEncolar,
} from '../../../shared/application/correo/correo-a-encolar';
import type { AuditOutcome } from '../../../shared/application/ports/audit-log.port';
import {
  companyId,
  locationId,
  sessionId,
  userId,
  type CompanyId,
  type SessionId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { escribirEnOutbox } from '../../../shared/infrastructure/persistence/outbox';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  ContextoDeSesion,
  CredencialDeLogin,
  FallosRecientes,
  NuevaSesion,
  RepositorioDeAutenticacion,
  UsuarioRestablecido,
} from '../application/ports/repositorio-de-autenticacion.port';

const RESULTADO_FALLIDO = 'failure';

/**
 * Una funcion `RETURNS void` no devuelve nada que Prisma sepa leer: el motor
 * falla con «Failed to deserialize column of type 'void'». Se pide `::text`
 * —una cadena vacia— y se valida como tal: lo que se comprueba no es un valor,
 * es que la sentencia se ejecuto y devolvio su unica fila.
 */
const RESULTADO_DE_SOLICITUD = z.tuple([z.object({ hecho: z.string() })]);

const FILA_DE_RESTABLECIMIENTO = z.object({
  user_id: z.uuid(),
  company_id: z.uuid(),
});
const RESTABLECIMIENTOS = z.array(FILA_DE_RESTABLECIMIENTO);

const FILA_DE_CREDENCIAL = z.object({
  user_id: z.uuid(),
  company_id: z.uuid(),
  password_hash: z.string().nullable(),
  user_status: z.string(),
  company_status: z.string(),
});

const FILA_DE_SESION = z.object({
  session_id: z.uuid(),
  user_id: z.uuid(),
  company_id: z.uuid(),
  created_at: z.date(),
  last_seen_at: z.date(),
  expires_at: z.date(),
  revoked_at: z.date().nullable(),
  user_status: z.string(),
  company_status: z.string(),
  permisos: z.array(z.string()),
  ubicaciones: z.array(z.uuid()),
  alcance_company: z.boolean(),
  ubicaciones_de_company: z.array(z.uuid()),
  csrf_token: z.string().nullable(),
});

const CREDENCIALES = z.array(FILA_DE_CREDENCIAL);
const SESIONES = z.array(FILA_DE_SESION);

/**
 * El motivo que acompana a cada uso de `runWithoutTenant`. Es obligatorio por
 * firma, de modo que `grep runWithoutTenant` devuelve la lista completa de
 * excepciones con su razon al lado.
 */
const MOTIVO_LOGIN = 'login: el tenant se DEDUCE de quien entra, asi que no existe todavia';
const MOTIVO_SESION = 'Barrera 3: el tenant sale de la sesion, y la sesion es lo que se esta resolviendo';
const MOTIVO_INTENTOS = 'login_attempt no tiene tenant a proposito (ver la migracion de P1)';
const MOTIVO_RESTABLECIMIENTO =
  'restablecimiento: ocurre sin sesion; la definer decide si hay usuario y lo atribuye a su company (D-16.47)';

@Injectable()
export class PrismaAutenticacionRepositorio implements RepositorioDeAutenticacion {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async buscarCredencial(email: string): Promise<CredencialDeLogin | null> {
    const filas = await this.transaccion.runWithoutTenant(MOTIVO_LOGIN, async (tx) =>
      tx.$queryRaw`SELECT user_id, company_id, password_hash, user_status, company_status
                   FROM auth_lookup(${email})`,
    );

    const [fila] = CREDENCIALES.parse(filas);
    if (fila === undefined) {
      return null;
    }

    return {
      userId: userId(fila.user_id),
      companyId: companyId(fila.company_id),
      passwordHash: fila.password_hash,
      userStatus: fila.user_status,
      companyStatus: fila.company_status,
    };
  }

  public async solicitarRestablecimiento(entrada: {
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<void> {
    // Los datos del correo viajan como texto y se convierten a `jsonb` en la
    // base: campo a campo, para que nada de mas llegue al outbox.
    const datos = JSON.stringify(datosParaGuardar(entrada.correo));

    const filas = await this.transaccion.runWithoutTenant(MOTIVO_RESTABLECIMIENTO, async (tx) =>
      tx.$queryRaw`SELECT password_reset_request(${entrada.email}, ${entrada.tokenHash},
                                                 ${entrada.expiraEn}::timestamptz, ${datos}::jsonb)::text AS hecho`,
    );

    RESULTADO_DE_SOLICITUD.parse(filas);
  }

  public async consumirRestablecimiento(entrada: {
    readonly tokenHash: string;
    readonly ahora: Date;
  }): Promise<UsuarioRestablecido | null> {
    const filas = await this.transaccion.runWithoutTenant(MOTIVO_RESTABLECIMIENTO, async (tx) =>
      tx.$queryRaw`SELECT user_id, company_id
                   FROM password_reset_consume(${entrada.tokenHash}, ${entrada.ahora}::timestamptz)`,
    );

    const [fila] = RESTABLECIMIENTOS.parse(filas);
    if (fila === undefined) {
      return null;
    }

    return { userId: userId(fila.user_id), companyId: companyId(fila.company_id) };
  }

  public async correoDelUsuario(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
  }): Promise<string | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.appUser.findFirst({
        where: { id: entrada.userId, companyId: entrada.companyId },
        select: { email: true },
      });
      return fila?.email ?? null;
    });
  }

  public async encolarCorreo(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly correo: CorreoAEncolar;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => escribirEnOutbox(tx, entrada));
  }

  public async contextoDeSesion(tokenHash: string): Promise<ContextoDeSesion | null> {
    const filas = await this.transaccion.runWithoutTenant(MOTIVO_SESION, async (tx) =>
      tx.$queryRaw`SELECT session_id, user_id, company_id, created_at, last_seen_at, expires_at,
                          revoked_at, user_status, company_status, permisos, ubicaciones,
                          alcance_company, ubicaciones_de_company, csrf_token
                   FROM session_lookup(${tokenHash})`,
    );

    const [fila] = SESIONES.parse(filas);
    if (fila === undefined) {
      return null;
    }

    return {
      sessionId: sessionId(fila.session_id),
      userId: userId(fila.user_id),
      companyId: companyId(fila.company_id),
      vigencia: {
        createdAt: fila.created_at,
        lastSeenAt: fila.last_seen_at,
        expiresAt: fila.expires_at,
        revokedAt: fila.revoked_at,
      },
      userStatus: fila.user_status,
      companyStatus: fila.company_status,
      permisos: fila.permisos,
      alcance: fila.alcance_company
        ? { clase: 'company' }
        : { clase: 'ubicaciones', ids: fila.ubicaciones.map(locationId) },
      ubicacionesDeCompany: fila.ubicaciones_de_company.map(locationId),
      csrfToken: fila.csrf_token,
    };
  }

  public async fallosRecientes(entrada: {
    readonly email: string;
    readonly ip: string | null;
    readonly desde: Date;
  }): Promise<FallosRecientes> {
    const { email, ip, desde } = entrada;

    return this.transaccion.runWithoutTenant(MOTIVO_INTENTOS, async (tx) => {
      const porCuenta = await tx.loginAttempt.findMany({
        where: { email, outcome: RESULTADO_FALLIDO, at: { gte: desde } },
        select: { at: true },
      });

      // Sin IP conocida no hay eje que contar. Devolver la lista vacia es lo
      // correcto: la cuenta sigue protegiendo por su lado.
      const porIp =
        ip === null
          ? []
          : await tx.loginAttempt.findMany({
              where: { ip, outcome: RESULTADO_FALLIDO, at: { gte: desde } },
              select: { at: true },
            });

      return { porCuenta: porCuenta.map((f) => f.at), porIp: porIp.map((f) => f.at) };
    });
  }

  public async registrarIntento(intento: {
    readonly email: string;
    readonly ip: string | null;
    readonly outcome: AuditOutcome;
  }): Promise<void> {
    await this.transaccion.runWithoutTenant(MOTIVO_INTENTOS, async (tx) => {
      await tx.loginAttempt.createMany({
        data: [{ email: intento.email, ip: intento.ip, outcome: intento.outcome }],
      });
    });
  }

  public async olvidarFallos(email: string): Promise<void> {
    await this.transaccion.runWithoutTenant(MOTIVO_INTENTOS, async (tx) => {
      await tx.loginAttempt.deleteMany({ where: { email, outcome: RESULTADO_FALLIDO } });
    });
  }

  public async abrirSesion(nueva: NuevaSesion): Promise<SessionId> {
    return this.transaccion.run(nueva.companyId, async (tx) => {
      // Aqui SI se usa `create`: la politica de `session` es `FOR ALL`, asi que
      // la fila recien insertada pasa tambien el SELECT del RETURNING. Es la
      // diferencia con `audit_log`, cuya politica de lectura es `USING (false)`.
      const fila = await tx.session.create({
        data: {
          companyId: nueva.companyId,
          userId: nueva.userId,
          tokenHash: nueva.tokenHash,
          csrfToken: nueva.csrfToken,
          expiresAt: nueva.expiresAt,
          ip: nueva.ip,
          userAgent: nueva.userAgent,
        },
        select: { id: true },
      });

      return sessionId(fila.id);
    });
  }

  public async marcarVista(entrada: {
    readonly companyId: CompanyId;
    readonly sessionId: SessionId;
    readonly ahora: Date;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.session.updateMany({
        where: { id: entrada.sessionId, companyId: entrada.companyId },
        data: { lastSeenAt: entrada.ahora },
      });
    });
  }

  public async revocarSesion(entrada: {
    readonly companyId: CompanyId;
    readonly sessionId: SessionId;
    readonly ahora: Date;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await this.revocar(tx, {
        id: entrada.sessionId,
        companyId: entrada.companyId,
        revokedAt: null,
      }, entrada.ahora);
    });
  }

  public async revocarSesionesDe(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly ahora: Date;
  }): Promise<number> {
    return this.transaccion.run(entrada.companyId, async (tx) =>
      this.revocar(tx, {
        userId: entrada.userId,
        companyId: entrada.companyId,
        revokedAt: null,
      }, entrada.ahora),
    );
  }

  public async guardarHashDeContrasena(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly hash: string;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      await tx.appUser.updateMany({
        where: { id: entrada.userId, companyId: entrada.companyId },
        data: { passwordHash: entrada.hash },
      });
    });
  }

  /**
   * `revokedAt: null` en el WHERE no es cosmetico: hace la revocacion
   * IDEMPOTENTE. Sin el, revocar dos veces moveria la fecha de revocacion
   * hacia adelante y el registro diria que la sesion se cerro cuando en
   * realidad ya estaba cerrada.
   */
  private async revocar(
    tx: ClienteDeTransaccion,
    donde: { readonly companyId: CompanyId; readonly revokedAt: null; readonly id?: string; readonly userId?: string },
    ahora: Date,
  ): Promise<number> {
    const resultado = await tx.session.updateMany({ where: donde, data: { revokedAt: ahora } });
    return resultado.count;
  }
}
