/**
 * AQUI, Y SOLO AQUI, SE ELIGE EL ADAPTADOR DE CORREO — CLAUDE.md §12, D-16.16.
 *
 * Lo comparten los dos procesos que tienen `MailerPort` en su contenedor:
 * `SharedModule` (la API, que desde P16-A1 no envia nada y solo honra el
 * selector) y `CorreoModule` (el despachador, que es quien envia). Una sola
 * tabla de decision para que `MAIL_ADAPTER=resend` signifique lo mismo en los
 * dos y para que las condiciones de arranque no diverjan.
 *
 * FALLO RUIDOSO ANTES QUE FALLO SILENCIOSO. `resend` sin `RESEND_API_KEY` o
 * sin `RESEND_REMITENTE` NO ARRANCA. La alternativa —caer a `consola` con un
 * aviso— es una configuracion equivocada que en produccion se traga los
 * correos y nadie lo sabe hasta que un cliente escribe. Es el mismo criterio
 * que `STORAGE_ADAPTER=real` sin adaptador y que los DEFAULT PRIVILEGES.
 */

import type { Provider } from '@nestjs/common';

import { MAILER_PORT } from '../../application/ports/mailer.port';
import { FakeMailer } from '../fakes/fake-mailer';
import { ConsolaMailer } from './consola-mailer';
import type { AdaptadorDeCorreo, ConfiguracionDeResend } from './entorno-de-correo';
import { ResendMailer } from './resend-mailer';

export interface EleccionDeMailer {
  readonly mailAdapter: AdaptadorDeCorreo;
  readonly resend: ConfiguracionDeResend;
  /** `consola` escribe el cuerpo entero solo fuera de produccion. */
  readonly isProduction: boolean;
}

export class ConfiguracionDeCorreoIncompletaError extends Error {
  public constructor(variable: string) {
    super(
      `MAIL_ADAPTER=resend exige ${variable}, y no esta. ` +
        'Ponla, o elige `consola` mientras no haya cuenta: el proceso no arranca con un selector que no puede cumplir.',
    );
    this.name = 'ConfiguracionDeCorreoIncompletaError';
  }
}

function resendVerificado(resend: ConfiguracionDeResend): { readonly apiKey: string; readonly remitente: string } {
  if (resend.apiKey === undefined) {
    throw new ConfiguracionDeCorreoIncompletaError('RESEND_API_KEY');
  }
  if (resend.remitente === undefined) {
    throw new ConfiguracionDeCorreoIncompletaError('RESEND_REMITENTE');
  }
  return { apiKey: resend.apiKey, remitente: resend.remitente };
}

function escribirEnSalida(texto: string): void {
  process.stdout.write(texto);
}

export function mailerProvider(eleccion: EleccionDeMailer): Provider {
  switch (eleccion.mailAdapter) {
    case 'fake':
      return { provide: MAILER_PORT, useClass: FakeMailer };
    case 'consola':
      return {
        provide: MAILER_PORT,
        useFactory: (): ConsolaMailer =>
          new ConsolaMailer({ conCuerpo: !eleccion.isProduction, escribir: escribirEnSalida }),
      };
    case 'resend': {
      // Se verifica AL ELEGIR, no al primer envio: el proceso muere al arrancar
      // y no cinco segundos despues, con la primera fila ya reservada.
      const credenciales = resendVerificado(eleccion.resend);
      return {
        provide: MAILER_PORT,
        useFactory: (): ResendMailer => new ResendMailer({ ...credenciales, fetch: globalThis.fetch }),
      };
    }
  }
}
