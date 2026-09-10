/**
 * Adaptador de correo sobre Resend — `MAIL_ADAPTER=resend` (D-16.16, ADR-025).
 *
 * UNA LLAMADA HTTP Y NADA MAS. `POST /emails` con la clave en `Authorization`
 * y un cuerpo de cuatro campos (`from`, `to`, `subject`, `text`). No se usa el
 * SDK del proveedor: es una dependencia mas —con sus propias dependencias— para
 * envolver un `fetch` de diez lineas (OPTIMIZACION.md §1).
 *
 * `fetch` LLEGA POR CONSTRUCTOR. Es lo que permite probar este archivo con un
 * `fetch` falso —2xx, 5xx, y un timeout de verdad— sin red y sin una clave. En
 * el proceso real se le pasa el `fetch` global de Node.
 *
 * DIEZ SEGUNDOS Y SE CORTA. Sin timeout, un proveedor que no responde deja la
 * pasada colgada con la fila reservada, y el resto de la cola espera detras.
 * Con `AbortSignal.timeout` el envio falla, se registra y se reintenta mas
 * tarde como cualquier otro fallo.
 *
 * EL ERROR LLEVA EL ESTADO HTTP Y NUNCA EL CUERPO DE LA RESPUESTA. Ese error
 * acaba en `email_outbox.error`, que leen la aplicacion (P16-C) y el back
 * office. Un cuerpo de respuesta puede repetir el destinatario, la clave que se
 * mando o una pagina entera de HTML; el estado dice lo mismo que hace falta
 * saber —autenticacion, limite, caida— sin nada de eso.
 */

import type { MailerPort, OutgoingMail } from '../../application/ports/mailer.port';

export const URL_DE_RESEND = 'https://api.resend.com/emails';

const TIMEOUT_POR_DEFECTO_MS = 10_000;

export interface OpcionesDeResend {
  readonly apiKey: string;
  /** `Nombre <correo@dominio>` o el correo a secas, verificado en Resend. */
  readonly remitente: string;
  readonly fetch: typeof fetch;
  readonly timeoutMs?: number;
}

export class ResendError extends Error {
  public constructor(public readonly estado: number) {
    super(`Resend respondio ${String(estado)} al enviar el correo.`);
    this.name = 'ResendError';
  }
}

export class ResendSinRespuestaError extends Error {
  public constructor(timeoutMs: number) {
    super(`Resend no respondio en ${String(timeoutMs)} ms.`);
    this.name = 'ResendSinRespuestaError';
  }
}

function esTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === 'TimeoutError';
}

export class ResendMailer implements MailerPort {
  private readonly timeoutMs: number;

  public constructor(private readonly opciones: OpcionesDeResend) {
    this.timeoutMs = opciones.timeoutMs ?? TIMEOUT_POR_DEFECTO_MS;
  }

  public async send(mail: OutgoingMail): Promise<void> {
    const respuesta = await this.llamar(mail);
    if (!respuesta.ok) {
      throw new ResendError(respuesta.status);
    }
  }

  private async llamar(mail: OutgoingMail): Promise<Response> {
    try {
      return await this.opciones.fetch(URL_DE_RESEND, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.opciones.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.opciones.remitente,
          to: [mail.to],
          subject: mail.subject,
          text: mail.body,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error: unknown) {
      if (esTimeout(error)) {
        throw new ResendSinRespuestaError(this.timeoutMs);
      }
      throw error;
    }
  }
}
