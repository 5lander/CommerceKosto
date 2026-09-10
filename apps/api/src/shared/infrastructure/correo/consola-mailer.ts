/**
 * Adaptador de correo por consola — `MAIL_ADAPTER=consola` (D-16.16).
 *
 * PARA DESARROLLO Y PARA EL PRIMER ARRANQUE EN UNA MAQUINA NUEVA: el
 * despachador hace todo lo que haria con un proveedor de verdad —tomar,
 * escribir, marcar, sanear— y en vez de mandar el correo lo escribe por la
 * salida estandar, donde `docker compose logs correo` lo ensena.
 *
 * EL CUERPO SOLO SALE FUERA DE PRODUCCION. El cuerpo lleva el enlace con el
 * token en claro, y un log de produccion es lo que se copia a un ticket, se
 * manda por chat y se conserva meses. En produccion escribe destinatario y
 * asunto —lo que hace falta para ver que la cola avanza— y nada mas. Que
 * alguien ponga `consola` en produccion es un error de configuracion, pero
 * el adaptador no lo empeora.
 */

import type { MailerPort, OutgoingMail } from '../../application/ports/mailer.port';

export interface OpcionesDeConsola {
  /** `true` fuera de produccion: el cuerpo entero, con su enlace. */
  readonly conCuerpo: boolean;
  /** Por donde sale. Se inyecta para poder probarlo sin capturar `stdout`. */
  readonly escribir: (texto: string) => void;
}

const SEPARADOR = '----------------------------------------';

export class ConsolaMailer implements MailerPort {
  public constructor(private readonly opciones: OpcionesDeConsola) {}

  public async send(mail: OutgoingMail): Promise<void> {
    const lineas = [`[correo] para: ${mail.to}`, `[correo] asunto: ${mail.subject}`];
    if (this.opciones.conCuerpo) {
      lineas.push(SEPARADOR, mail.body, SEPARADOR);
    }
    this.opciones.escribir(`${lineas.join('\n')}\n`);
    await Promise.resolve();
  }
}
