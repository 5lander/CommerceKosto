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

import {
  companyId as aCompanyId,
  locationId as aLocationId,
  userId as aUserId,
  type CompanyId,
  type LocationId,
  type UserId,
} from '../../../shared/domain/identity/identificadores';
import type { ClienteDeTransaccion } from '../../../shared/infrastructure/persistence/prisma-connection';
import { TenantTransaction } from '../../../shared/infrastructure/persistence/tenant-transaction';
import type {
  InvitacionPendiente,
  RepositorioDeOrganizacion,
  ResultadoDeCreacion,
  ResultadoDeInvitacion,
  TipoDeUbicacion,
  Ubicacion,
} from '../application/ports/repositorio-de-organizacion.port';

const ESTADO_ACTIVO = 'ACTIVE';
const ESTADO_INVITADO = 'INVITED';
const ROL_OWNER = 'OWNER';

/** Violacion de restriccion unica en Prisma. */
const CODIGO_DE_DUPLICADO = 'P2002';

const MOTIVO_INVITACION = 'aceptar invitacion: ocurre sin sesion, asi que no hay tenant';

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

        return { clase: 'invitado', id: aUserId(fila.id) };
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
