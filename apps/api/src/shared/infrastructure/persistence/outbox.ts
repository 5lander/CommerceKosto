/**
 * La escritura en `email_outbox`, para llamarla DESDE DENTRO de la transaccion
 * de quien encola — ADR-025.
 *
 * RECIBE EL `tx` Y NO ABRE UNO: es la pieza entera. `InvitarUsuario` no llama a
 * ningun puerto de correo; es el repositorio de organizacion quien, en la misma
 * transaccion en que inserta al invitado, deja aqui su correo. Si el INSERT del
 * usuario falla, no hay correo; si el correo no se puede encolar, no hay
 * usuario. Con dos transacciones habria un hueco entre las dos, y en ese hueco
 * viven las invitaciones que existen sin correo y los correos que apuntan a
 * usuarios que no existen.
 *
 * `createMany` Y NO `create`: `costeo_app` no tiene SELECT sobre `datos` (solo
 * el despachador lo tiene), asi que un RETURNING fallaria con 42501; y nadie
 * necesita el id de un correo que no va a leer.
 *
 * Vive en `persistence/` porque toca un modelo de Prisma; no es un puerto: es
 * un detalle de como los repositorios escriben, y solo ellos lo llaman.
 */

import { datosParaGuardar, type CorreoAEncolar } from '../../application/correo/correo-a-encolar';
import type { CompanyId, UserId } from '../../domain/identity/identificadores';
import type { ClienteDeTransaccion } from './prisma-connection';

/** El unico estado que la aplicacion escribe; los otros dos son del despachador. */
const ESTADO_PENDIENTE = 'PENDIENTE';

export async function escribirEnOutbox(
  tx: ClienteDeTransaccion,
  entrada: {
    readonly companyId: CompanyId;
    readonly userId: UserId;
    readonly correo: CorreoAEncolar;
  },
): Promise<void> {
  const { companyId, userId, correo } = entrada;

  await tx.emailOutbox.createMany({
    data: [
      {
        companyId,
        userId,
        destinatario: correo.destinatario,
        plantilla: correo.plantilla,
        // Campo a campo, nunca el objeto entero: `datosParaGuardar` es la lista.
        datos: datosParaGuardar(correo),
        estado: ESTADO_PENDIENTE,
      },
    ],
  });
}
