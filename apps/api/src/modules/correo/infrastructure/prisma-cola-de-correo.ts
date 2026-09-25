/**
 * La cola de correo sobre PostgreSQL, con el rol del despachador — ADR-025.
 *
 * `FOR UPDATE SKIP LOCKED` Y UNA RESERVA, LAS DOS COSAS. El bloqueo de fila
 * impide que dos pasadas concurrentes tomen el mismo correo... mientras dura
 * la transaccion. Pero el envio ocurre FUERA de ella —una llamada HTTP de
 * hasta diez segundos no se hace con una transaccion abierta y una fila
 * bloqueada— y en cuanto se confirma, el bloqueo se va. Por eso, en la misma
 * transaccion que las lee, las filas tomadas se RESERVAN: `siguiente_intento_en`
 * pasa a unos minutos en el futuro, y una segunda pasada (un contenedor viejo
 * que todavia no murio mientras arranca el nuevo) no las ve. Si el proceso
 * muere con el correo a medias, la reserva caduca y el correo vuelve solo. Sin
 * esto, `SKIP LOCKED` habria sido una palabra que suena a garantia y no lo es.
 *
 * Y LA RESERVA SE RENUEVA FILA A FILA. La del lote se toma de una vez, pero el
 * lote se envia en serie: con `CORREO_LOTE` grande y un proveedor lento, las
 * filas del final perderian la reserva antes de que la pasada llegara a ellas.
 * `renovarReserva` vuelve a reservar UNA fila justo antes de su envio, con la
 * condicion de que `siguiente_intento_en` siga siendo el instante que ESTA
 * pasada escribio al tomarla: si otra instancia la volvio a tomar, el valor es
 * otro, el `UPDATE` no toca nada y el caso de uso la cede. Asi la reserva solo
 * tiene que cubrir un envio y su marca, no el lote entero, y `CORREO_LOTE`
 * puede ser lo que el operador quiera.
 *
 * `$queryRaw` ETIQUETADO, SIN `Prisma.raw`: cada valor viaja como parametro.
 * Las filas se validan con esquema, como en `prisma-autenticacion.repositorio.ts`:
 * `datos` lo escribieron la aplicacion y una funcion definer, y para este
 * proceso es un limite externo. Una fila que no cuadra con su plantilla llega
 * al caso de uso con `contenido: null`, que la marca como fallo y no bloquea a
 * las que vienen detras.
 *
 * LOS UPDATE REPITEN `estado = 'PENDIENTE'` EN EL WHERE. RLS no filtra por
 * estado; lo repite el codigo para que marcar dos veces —o marcar algo que
 * otro proceso ya cerro— no pise nada. `datos` se reemplaza por el saneado al
 * pasar a `ENVIADO` o `FALLIDO` (D-16.34): el enlace con el token deja de
 * existir en la base en la misma sentencia que cierra el correo.
 */

import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import type { ContenidoDeCorreo } from '../../../shared/application/correo/correo-a-encolar';
import type {
  ColaDeCorreo,
  CorreoPendiente,
  FalloDeEnvio,
  ReservaDeCorreo,
} from '../application/ports/cola-de-correo.port';
import type { DatosSaneados } from '../domain/saneado';
import { DespachadorConnection, type ClienteDelDespachador } from './despachador-connection';

/**
 * Cuanto queda reservado un correo: al tomar el lote, y otra vez justo antes
 * de su envio. Solo tiene que cubrir UN envio (diez segundos de timeout en
 * `resend-mailer.ts`) y su marca (`statement_timeout` de 30 s del rol), con
 * margen; y ser menos que lo que un correo puede esperar si el proceso murio
 * con el a medias.
 */
const MINUTOS_DE_RESERVA = 5;
const MILISEGUNDOS_POR_MINUTO = 60_000;
const RESERVA_MS = MINUTOS_DE_RESERVA * MILISEGUNDOS_POR_MINUTO;

const UNA_FILA = 1;

const FILAS = z.array(
  z.object({
    id: z.string(),
    destinatario: z.string(),
    plantilla: z.string(),
    datos: z.unknown(),
    intentos: z.number().int(),
  }),
);
type Fila = z.infer<typeof FILAS>[number];

const DATOS_DE_ENLACE = z.object({ enlace: z.string().min(1), caducaEn: z.string().min(1) });

function contenidoDe(fila: Fila): ContenidoDeCorreo | null {
  if (fila.plantilla === 'BLOQUEO') {
    return { plantilla: 'BLOQUEO', datos: {} };
  }
  if (fila.plantilla !== 'INVITACION' && fila.plantilla !== 'RESTABLECIMIENTO') {
    return null;
  }
  const datos = DATOS_DE_ENLACE.safeParse(fila.datos);
  return datos.success ? { plantilla: fila.plantilla, datos: datos.data } : null;
}

function comoPendiente(fila: Fila, reservadoHasta: Date): CorreoPendiente {
  return {
    id: fila.id,
    destinatario: fila.destinatario,
    plantilla: fila.plantilla,
    contenido: contenidoDe(fila),
    intentos: fila.intentos,
    reservadoHasta,
  };
}

function reservaDesde(ahora: Date): Date {
  return new Date(ahora.getTime() + RESERVA_MS);
}

async function reservar(tx: ClienteDelDespachador, ids: readonly string[], hasta: Date): Promise<void> {
  if (ids.length === 0) {
    return;
  }
  await tx.$executeRaw`UPDATE email_outbox
                          SET siguiente_intento_en = ${hasta}::timestamptz
                        WHERE id = ANY(${[...ids]}::uuid[])`;
}

@Injectable()
export class PrismaColaDeCorreo implements ColaDeCorreo {
  public constructor(private readonly conexion: DespachadorConnection) {}

  public async tomarPendientes(ahora: Date, lote: number): Promise<readonly CorreoPendiente[]> {
    return this.conexion.run(async (tx) => {
      const crudas = await tx.$queryRaw`SELECT id::text AS id, destinatario, plantilla, datos, intentos
                                          FROM email_outbox
                                         WHERE estado = 'PENDIENTE'
                                           AND (siguiente_intento_en IS NULL OR siguiente_intento_en <= ${ahora}::timestamptz)
                                         ORDER BY created_at
                                         LIMIT ${lote}
                                         FOR UPDATE SKIP LOCKED`;
      const filas = FILAS.parse(crudas);
      const hasta = reservaDesde(ahora);

      await reservar(
        tx,
        filas.map((fila) => fila.id),
        hasta,
      );

      return filas.map((fila) => comoPendiente(fila, hasta));
    });
  }

  public async renovarReserva(correo: ReservaDeCorreo, ahora: Date): Promise<boolean> {
    const hasta = reservaDesde(ahora);
    const tocadas = await this.conexion.run(
      async (tx) =>
        tx.$executeRaw`UPDATE email_outbox
                          SET siguiente_intento_en = ${hasta}::timestamptz
                        WHERE id = ${correo.id}::uuid
                          AND estado = 'PENDIENTE'
                          AND siguiente_intento_en = ${correo.reservadoHasta}::timestamptz`,
    );
    return tocadas === UNA_FILA;
  }

  public async marcarEnviado(id: string, ahora: Date, datos: DatosSaneados): Promise<void> {
    const saneado = JSON.stringify(datos);
    await this.conexion.run(async (tx) => {
      await tx.$executeRaw`UPDATE email_outbox
                              SET estado = 'ENVIADO',
                                  sent_at = ${ahora}::timestamptz,
                                  intentos = intentos + 1,
                                  error = NULL,
                                  siguiente_intento_en = NULL,
                                  datos = ${saneado}::jsonb
                            WHERE id = ${id}::uuid AND estado = 'PENDIENTE'`;
    });
  }

  public async marcarFallo(id: string, fallo: FalloDeEnvio): Promise<void> {
    const { decision } = fallo;
    await this.conexion.run(async (tx) => {
      if (decision.estado === 'FALLIDO') {
        const saneado = JSON.stringify(fallo.datosSaneados);
        await tx.$executeRaw`UPDATE email_outbox
                                SET estado = 'FALLIDO',
                                    intentos = ${decision.intentos},
                                    error = ${fallo.error},
                                    siguiente_intento_en = NULL,
                                    datos = ${saneado}::jsonb
                              WHERE id = ${id}::uuid AND estado = 'PENDIENTE'`;
        return;
      }
      await tx.$executeRaw`UPDATE email_outbox
                              SET intentos = ${decision.intentos},
                                  error = ${fallo.error},
                                  siguiente_intento_en = ${decision.siguienteIntentoEn}::timestamptz
                            WHERE id = ${id}::uuid AND estado = 'PENDIENTE'`;
    });
  }

  public async purgarLimites(antesDe: Date): Promise<number> {
    return this.conexion.run(async (tx) =>
      tx.$executeRaw`DELETE FROM rate_limit_hit WHERE "at" < ${antesDe}::timestamptz`,
    );
  }
}
