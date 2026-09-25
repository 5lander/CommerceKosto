/**
 * El puerto de organizacion, sobre PostgreSQL.
 *
 * EL LIMITE DE UBICACIONES SE RESUELVE CON UN CANDADO, no con un `count` y un
 * `if`. `SELECT ... FOR UPDATE` sobre la fila de la company serializa a todos
 * los que intenten crear una ubicacion de ESA company: el segundo espera al
 * primero y cuenta despues de que el primero haya insertado. Sin el candado,
 * dos peticiones simultaneas leen nueve, las dos deciden que caben, y el plan
 * de diez acaba con once. Un limite que se salta con dos pestanas abiertas no
 * es un limite.
 *
 * EL CODIGO `P2002` SE COMPRUEBA A MANO en vez de importar el tipo de error de
 * Prisma: importar del cliente generado fuera de `persistence/` lo prohibe
 * `audit:forbidden`, y con razon. Comprobar la propiedad `code` no es peor —es
 * el mismo contrato— y no arrastra el cliente entero hasta aqui.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { CorreoAEncolar } from '../../../shared/application/correo/correo-a-encolar';
import {
  companyId as aCompanyId,
  locationId as aLocationId,
  userId as aUserId,
  type CompanyId,
  type LocationId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import { escribirEnOutbox } from '../../../shared/infrastructure/persistence/outbox';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  AsignacionListada,
  CorreoDeInvitacion,
  InvitacionPendiente,
  RepositorioDeOrganizacion,
  ResultadoDeCreacion,
  ResultadoDeInvitacion,
  ResultadoDeActualizacionDeUbicacion,
  ResultadoDeReinvitacion,
  RolDelCatalogo,
  TipoDeUbicacion,
  Ubicacion,
  UsuarioInvitado,
  UsuarioListado,
} from '../application/ports/repositorio-de-organizacion.port';

const ESTADO_ACTIVO = 'ACTIVE';
const ESTADO_INVITADO = 'INVITED';
const ROL_OWNER = 'OWNER';

/** Violacion de restriccion unica en Prisma. */
const CODIGO_DE_DUPLICADO = 'P2002';

const MOTIVO_INVITACION = 'aceptar invitacion: ocurre sin sesion, asi que no hay tenant';

/** La plantilla de `email_outbox` cuyo estado enseña `GET /usuarios` (D-16.27(b)). */
const PLANTILLA_DE_INVITACION = 'INVITACION';

const FILA_DE_LIMITE = z.array(z.object({ max_locations: z.number().int() }));

const FILA_DE_INVITACION = z.array(
  z.object({
    user_id: z.uuid(),
    company_id: z.uuid(),
    email: z.string(),
    expires_at: z.date(),
    status: z.string(),
  }),
);

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === CODIGO_DE_DUPLICADO;
}

@Injectable()
export class PrismaOrganizacionRepositorio implements RepositorioDeOrganizacion {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async crearUbicacionSiCabe(entrada: {
    readonly companyId: CompanyId;
    readonly nombre: string;
    readonly tipo: TipoDeUbicacion;
  }): Promise<ResultadoDeCreacion> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const maximo = await this.limiteBloqueado(tx, entrada.companyId);
      const actuales = await tx.location.count({ where: { companyId: entrada.companyId } });

      if (actuales >= maximo) {
        return { clase: 'limite', maximo };
      }

      const fila = await tx.location.create({
        data: {
          companyId: entrada.companyId,
          name: entrada.nombre,
          type: entrada.tipo,
          status: ESTADO_ACTIVO,
        },
        select: { id: true },
      });

      return { clase: 'creada', id: aLocationId(fila.id) };
    });
  }

  public async listarUbicaciones(entrada: {
    readonly companyId: CompanyId;
    readonly ids: readonly LocationId[] | 'todas';
  }): Promise<readonly Ubicacion[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const filas = await tx.location.findMany({
        where: {
          companyId: entrada.companyId,
          ...(entrada.ids === 'todas' ? {} : { id: { in: [...entrada.ids] } }),
        },
        select: { id: true, name: true, type: true, status: true },
        orderBy: { name: 'asc' },
      });

      return filas.map((f) => ({
        id: aLocationId(f.id),
        nombre: f.name,
        tipo: f.type,
        estado: f.status,
      }));
    });
  }

  public async invitar(entrada: {
    readonly companyId: CompanyId;
    readonly email: string;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<ResultadoDeInvitacion> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      try {
        const fila = await tx.appUser.create({
          data: {
            companyId: entrada.companyId,
            email: entrada.email,
            status: ESTADO_INVITADO,
            invitationTokenHash: entrada.tokenHash,
            invitationExpiresAt: entrada.expiraEn,
          },
          select: { id: true },
        });

        // EN LA MISMA TRANSACCION que el usuario (ADR-025): o existen los dos,
        // o no existe ninguno.
        const id = aUserId(fila.id);
        await escribirEnOutbox(tx, { companyId: entrada.companyId, userId: id, correo: entrada.correo });

        return { clase: 'invitado', id };
      } catch (error) {
        // El correo es unico GLOBALMENTE: puede estar en uso en otra company, y
        // por RLS ni siquiera se puede saber cual. El caso de uso responde lo
        // mismo en los dos casos, que es lo que cierra el oraculo.
        if (esDuplicado(error)) {
          return { clase: 'correo_en_uso' };
        }
        throw error;
      }
    });
  }

  public async invitadoPendiente(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
  }): Promise<UsuarioInvitado | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const fila = await tx.appUser.findFirst({
        where: { id: entrada.userId, companyId: entrada.companyId, status: ESTADO_INVITADO },
        select: { email: true },
      });
      return fila === null ? null : { email: fila.email };
    });
  }

  public async reinvitar(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly tokenHash: string;
    readonly expiraEn: Date;
    readonly correo: CorreoAEncolar;
  }): Promise<ResultadoDeReinvitacion> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      // `status: INVITED` en el WHERE: si activo entre la lectura del caso de
      // uso y esta escritura, no se toca nada y no se encola nada. Sustituir
      // el token es lo que invalida el enlace anterior — el indice unico de
      // `invitation_token_hash` no admite dos vivos.
      const resultado = await tx.appUser.updateMany({
        where: { id: entrada.userId, companyId: entrada.companyId, status: ESTADO_INVITADO },
        data: { invitationTokenHash: entrada.tokenHash, invitationExpiresAt: entrada.expiraEn },
      });
      if (resultado.count === 0) {
        return 'no_pendiente';
      }

      await escribirEnOutbox(tx, { companyId: entrada.companyId, userId: entrada.userId, correo: entrada.correo });
      return 'reinvitado';
    });
  }

  public async invitacionPorToken(tokenHash: string): Promise<InvitacionPendiente | null> {
    const filas = await this.transaccion.runWithoutTenant(MOTIVO_INVITACION, async (tx) =>
      tx.$queryRaw`SELECT user_id, company_id, email, expires_at, status
                   FROM invitation_lookup(${tokenHash})`,
    );

    const [fila] = FILA_DE_INVITACION.parse(filas);
    if (fila === undefined) {
      return null;
    }

    return {
      userId: aUserId(fila.user_id),
      companyId: aCompanyId(fila.company_id),
      email: fila.email,
      expiraEn: fila.expires_at,
      estado: fila.status,
    };
  }

  public async activarConContrasena(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly hash: string;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      // `status: INVITED` en el WHERE hace la activacion IRREPETIBLE: el mismo
      // enlace usado dos veces no cambia nada la segunda. Sin eso, un token
      // filtrado seguiria sirviendo para reescribir la contrasena despues.
      await tx.appUser.updateMany({
        where: { id: entrada.userId, companyId: entrada.companyId, status: ESTADO_INVITADO },
        data: {
          passwordHash: entrada.hash,
          status: ESTADO_ACTIVO,
          invitationTokenHash: null,
          invitationExpiresAt: null,
        },
      });
    });
  }

  public async listarUsuarios(entrada: {
    readonly companyId: CompanyId;
    readonly ubicaciones: readonly LocationId[] | 'todas';
  }): Promise<readonly UsuarioListado[]> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const deLasUbicaciones = entrada.ubicaciones === 'todas' ? {} : { locationId: { in: [...entrada.ubicaciones] } };
      const filas = await tx.appUser.findMany({
        where: {
          companyId: entrada.companyId,
          ...(entrada.ubicaciones === 'todas' ? {} : { roles: { some: deLasUbicaciones } }),
        },
        select: {
          id: true,
          email: true,
          status: true,
          invitationExpiresAt: true,
          roles: { where: deLasUbicaciones, select: { roleCode: true, locationId: true }, orderBy: { roleCode: 'asc' } },
        },
        orderBy: { email: 'asc' },
      });

      const correos = await ultimosCorreosDeInvitacion(
        tx,
        entrada.companyId,
        filas.filter((f) => f.status === ESTADO_INVITADO).map((f) => f.id),
      );

      return filas.map((f) => ({
        id: aUserId(f.id),
        email: f.email,
        estado: f.status,
        roles: f.roles.map((r): AsignacionListada => ({
          rol: r.roleCode,
          locationId: r.locationId === null ? null : aLocationId(r.locationId),
        })),
        invitacionCaducaEn: f.invitationExpiresAt,
        correoInvitacion: correos.get(f.id) ?? null,
      }));
    });
  }

  public async listarRoles(companyId: CompanyId): Promise<readonly RolDelCatalogo[]> {
    return this.transaccion.run(companyId, async (tx) => {
      const filas = await tx.role.findMany({
        select: { code: true, requiresLocation: true, permisos: { select: { permissionCode: true } } },
        orderBy: { code: 'asc' },
      });
      return filas.map((f) => ({
        codigo: f.code,
        requiereUbicacion: f.requiresLocation,
        permisos: f.permisos.map((p) => p.permissionCode).sort(),
      }));
    });
  }

  public async actualizarUbicacion(entrada: {
    readonly companyId: CompanyId;
    readonly locationId: LocationId;
    readonly nombre: string;
    readonly tipo: TipoDeUbicacion;
  }): Promise<ResultadoDeActualizacionDeUbicacion> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      try {
        // `updateMany` con el tenant en el WHERE: cero filas es «no existe en tu
        // company», sin `RETURNING` y sin excepción (INC-010).
        const { count } = await tx.location.updateMany({
          where: { id: entrada.locationId, companyId: entrada.companyId },
          data: { name: entrada.nombre, type: entrada.tipo },
        });
        return count === 0 ? 'no_encontrada' : 'actualizada';
      } catch (error) {
        if (esDuplicado(error)) return 'nombre_en_uso';
        throw error;
      }
    });
  }

  public async esOwner(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
  }): Promise<boolean | null> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const usuario = await tx.appUser.findFirst({
        where: { id: entrada.userId, companyId: entrada.companyId },
        select: { id: true },
      });
      if (usuario === null) {
        return null;
      }

      const owner = await tx.userRole.findFirst({
        where: { companyId: entrada.companyId, userId: entrada.userId, roleCode: ROL_OWNER },
        select: { id: true },
      });

      return owner !== null;
    });
  }

  public async asignarRol(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly rol: string;
    readonly locationId: LocationId | null;
  }): Promise<void> {
    await this.transaccion.run(entrada.companyId, async (tx) => {
      // `skipDuplicates`: asignar dos veces el mismo rol es una operacion
      // idempotente, no un error. Los dos indices unicos —el de Prisma y el
      // parcial para `location_id IS NULL`— son los que lo hacen cierto.
      await tx.userRole.createMany({
        data: [
          {
            companyId: entrada.companyId,
            userId: entrada.userId,
            roleCode: entrada.rol,
            locationId: entrada.locationId,
            hasLocation: entrada.locationId !== null,
          },
        ],
        skipDuplicates: true,
      });
    });
  }

  public async revocarRol(entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly rol: string;
    readonly locationId: LocationId | null;
  }): Promise<number> {
    return this.transaccion.run(entrada.companyId, async (tx) => {
      const resultado = await tx.userRole.deleteMany({
        where: {
          companyId: entrada.companyId,
          userId: entrada.userId,
          roleCode: entrada.rol,
          locationId: entrada.locationId,
        },
      });

      return resultado.count;
    });
  }

  /**
   * Toma el candado de la fila de la company y devuelve su limite de ubicaciones.
   *
   * El `FOR UPDATE` es la pieza entera: sin el, esto seria un `count` y un `if`
   * con una ventana de carrera en medio.
   *
   * DESDE P11 EL LIMITE VIVE EN EL PLAN, no en la company. El candado se sigue
   * tomando sobre la fila de `company` —que es la que decide cual es su plan— y
   * no sobre la de `plan`, que es un catalogo compartido: bloquear ahi serializaria
   * la creacion de ubicaciones de TODAS las companies del mismo plan.
   */
  private async limiteBloqueado(tx: ClienteDeTransaccion, company: CompanyId): Promise<number> {
    const filas = await tx.$queryRaw`SELECT p."max_locations"
                                       FROM "company" c
                                       JOIN "plan" p ON p."code" = c."plan_code"
                                      WHERE c."id" = ${company}::uuid
                                        FOR UPDATE OF c`;
    const [fila] = FILA_DE_LIMITE.parse(filas);

    if (fila === undefined) {
      // RLS filtra por tenant, asi que no verla significa que no es la suya. No
      // deberia poder ocurrir con una sesion valida.
      throw new Error('La company de la sesion no existe o no es visible.');
    }

    return fila.max_locations;
  }
}

/**
 * El último correo `INVITACION` de cada usuario, en UNA consulta para todos.
 *
 * `distinct` sobre `userId` con el orden descendente por fecha deja la fila más
 * reciente de cada uno; el índice `(user_id, created_at DESC)` de P16-A1 es el
 * de esta lectura. **El `select` nombra las columnas**, y no puede nombrar
 * `datos`: `costeo_app` no tiene `SELECT` sobre ella (ADR-025).
 */
async function ultimosCorreosDeInvitacion(
  tx: ClienteDeTransaccion,
  companyId: CompanyId,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, CorreoDeInvitacion>> {
  if (userIds.length === 0) return new Map();

  const filas = await tx.emailOutbox.findMany({
    where: { companyId, userId: { in: [...userIds] }, plantilla: PLANTILLA_DE_INVITACION },
    select: { userId: true, estado: true, error: true },
    orderBy: [{ userId: 'asc' }, { createdAt: 'desc' }],
    distinct: ['userId'],
  });

  return new Map(
    filas.flatMap((f) => (f.userId === null ? [] : [[f.userId, { estado: f.estado, error: f.error }] as const])),
  );
}
