/**
 * `RegistroDeLimites` sobre `rate_limit_hit` — D-16.28, D-16.50.
 *
 * LEER Y ESCRIBIR EN LA MISMA TRANSACCION, BAJO UN BLOQUEO CONSULTIVO POR
 * CLAVE. Un limite hecho de "leer el recuento, decidir, escribir el golpe" en
 * transacciones separadas no limita nada bajo peticiones simultaneas: todas
 * leen el mismo recuento y todas pasan (la revision adversarial lo midio:
 * treinta a la vez desde una IP, treinta aceptadas). Aqui la transaccion toma
 * primero `pg_advisory_xact_lock(hashtext(kind), hashtext(clave))`, que
 * serializa SOLO a las peticiones de la misma clave y muere al confirmar; la
 * lectura que sigue ve, con su propio snapshot (READ COMMITTED), lo que la
 * anterior confirmo. Una colision de `hashtext` entre dos claves solo las
 * serializa de mas; nunca deja pasar de mas.
 *
 * LA LECTURA VA ACOTADA: `ORDER BY at DESC LIMIT maximo` sobre el indice
 * `(kind, clave, at DESC)`. Quien insiste bloqueado sigue dejando golpes, y
 * sin tope cada peticion suya cargaria todos los de la hora.
 *
 * VA SIN TENANT, COMO `login_attempt`, Y POR LA MISMA RAZON: quien pide un
 * restablecimiento no tiene sesion, y un golpe por IP no pertenece a ninguna
 * company. La tabla tiene RLS `ENABLE + FORCE` con politica permisiva para
 * `costeo_app` (es una exencion de AMBITO registrada en SEGURIDAD.md, no una
 * exencion de RLS), y `runWithoutTenant` exige el motivo por firma para que
 * `grep runWithoutTenant` siga listando todas las excepciones.
 *
 * `createMany` Y NO `create`: no hace falta el id, y un `RETURNING` bajo RLS
 * exige tambien la politica de SELECT (INC-010). Aqui la politica es
 * `FOR ALL`, asi que pasaria; se escribe igual que en el resto de la capa
 * para que la forma no dependa de que politica tenga cada tabla.
 *
 * LA APLICACION NO BORRA: `costeo_app` tiene `INSERT` y `SELECT` sobre esta
 * tabla y nada mas. La purga la hace el despachador en cada pasada.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { GolpeALimitar, RegistroDeLimites } from '../../application/ports/registro-de-limites.port';
import { TenantTransaction } from './tenant-transaction';

const MOTIVO = 'rate_limit_hit no tiene tenant a proposito: cuenta por IP y por destinatario antes de saber quien es (D-16.28)';

/**
 * `pg_advisory_xact_lock` devuelve `void`, que el motor de Prisma no sabe leer
 * («Failed to deserialize column of type 'void'»); se pide `::text` y se
 * valida que llego su unica fila, como con `password_reset_request`.
 */
const BLOQUEO_TOMADO = z.tuple([z.object({ bloqueo: z.string() })]);

@Injectable()
export class PrismaRegistroDeLimites implements RegistroDeLimites {
  public constructor(private readonly transaccion: TenantTransaction) {}

  public async golpear(golpe: GolpeALimitar): Promise<readonly Date[]> {
    const { kind, clave } = golpe;

    return this.transaccion.runWithoutTenant(MOTIVO, async (tx) => {
      const bloqueo = await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${kind}), hashtext(${clave}))::text AS bloqueo`;
      BLOQUEO_TOMADO.parse(bloqueo);

      const previos = await tx.rateLimitHit.findMany({
        where: { kind, clave, at: { gte: golpe.desde } },
        select: { at: true },
        orderBy: { at: 'desc' },
        take: golpe.maximo,
      });
      await tx.rateLimitHit.createMany({ data: [{ kind, clave, at: golpe.at }] });

      return previos.map((fila) => fila.at);
    });
  }
}
