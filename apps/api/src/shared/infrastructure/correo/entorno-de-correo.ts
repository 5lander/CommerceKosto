/**
 * Las variables de correo, UNA sola vez, para los dos esquemas de entorno que
 * las leen: el de la API (`config/environment.ts`) y el del despachador
 * (`modules/correo/infrastructure/entorno-del-despachador.ts`) — D-16.16.
 *
 * El `.env` es uno y lo leen dos procesos. Si cada esquema declarara las suyas,
 * un dia aceptarian valores distintos y el mismo archivo arrancaria uno y no el
 * otro. Aqui esta la forma; cada esquema la extiende con lo suyo.
 *
 * `RESEND_*` SON OPCIONALES EN EL ESQUEMA Y OBLIGATORIAS EN LA ELECCION: la
 * regla «con `resend` sin clave o sin remitente no se arranca» vive en
 * `mailer.provider.ts`, que es el unico sitio que sabe que adaptador se pidio.
 * Una cadena vacia cuenta como ausente: compose pasa `${RESEND_API_KEY:-}` y
 * un `.env` sin la variable produce `""`, no `undefined`.
 */

import { z } from 'zod';

const opcionalNoVacio = z
  .string()
  .optional()
  .transform((valor) => {
    const limpio = valor?.trim() ?? '';
    return limpio === '' ? undefined : limpio;
  });

export const VARIABLES_DE_CORREO = {
  /**
   * `fake` guarda en memoria (pruebas); `consola` escribe por la salida
   * estandar; `resend` envia de verdad (ADR-025).
   */
  MAIL_ADAPTER: z.enum(['fake', 'consola', 'resend']).default('fake'),
  RESEND_API_KEY: opcionalNoVacio,
  /** Quien firma: `Nombre <correo@dominio>` o solo el correo, verificado en Resend. */
  RESEND_REMITENTE: opcionalNoVacio,
};

export type AdaptadorDeCorreo = 'fake' | 'consola' | 'resend';

export interface ConfiguracionDeResend {
  readonly apiKey: string | undefined;
  readonly remitente: string | undefined;
}

export function resendDe(valores: {
  readonly RESEND_API_KEY: string | undefined;
  readonly RESEND_REMITENTE: string | undefined;
}): ConfiguracionDeResend {
  return { apiKey: valores.RESEND_API_KEY, remitente: valores.RESEND_REMITENTE };
}
