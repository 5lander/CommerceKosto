/**
 * El esquema de entorno del DESPACHADOR — su propio proceso, su propio rol,
 * sus propias variables (D-16.23, ADR-025).
 *
 * NO REUTILIZA `loadConfiguration`, y es la razon de que exista este archivo:
 * aquel exige `DATABASE_URL` con el usuario `costeo_app`, y este proceso NO
 * DEBE TENER esa cadena. Un despachador que arrancara con el esquema de la API
 * seria un despachador que tiene en su entorno la credencial de la aplicacion
 * sin necesitarla — la contraria de la separacion que D-16.23 pide.
 *
 * LO QUE SI SE COMPARTE es la forma de las variables de correo
 * (`entorno-de-correo.ts`), la fabrica «cadena con rol» y el validador que
 * construye el mensaje sin repetir valores (`environment.ts`): el `.env` es uno,
 * y las contrasenas de dentro no deben acabar en un log ni aqui ni alla.
 *
 * LA COMPROBACION DEL ROL VA EN EL CAMPO (INC-008): con `CORREO_LOTE` invalido
 * a la vez, la del rol tiene que salir igual en el informe.
 *
 * EN PRODUCCION `fake` NO ARRANCA. `fake` guarda los correos en memoria y los
 * marca `ENVIADO`: en la maquina de un desarrollador es lo que se quiere para
 * probar; en produccion es un despachador que da por entregado lo que nadie
 * recibio, sin un solo error en ningun log. Es la unica regla del `superRefine`
 * del objeto —una regla de produccion, como la de `APP_URL` en la API—, no un
 * control de seguridad.
 */

import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import { z } from 'zod';

import { cadenaDeConexionConRol, validarEntorno } from '../../../shared/infrastructure/config/environment';
import {
  resendDe,
  VARIABLES_DE_CORREO,
  type AdaptadorDeCorreo,
  type ConfiguracionDeResend,
} from '../../../shared/infrastructure/correo/entorno-de-correo';

/** El rol del despachador, y ningun otro. */
const ROL_DEL_DESPACHADOR = 'costeo_despachador';

const INTERVALO_POR_DEFECTO_MS = 5_000;
const INTERVALO_MINIMO_MS = 500;
/** Diez minutos: mas que eso y una invitacion tarda en llegar lo que tarda en olvidarse. */
const INTERVALO_MAXIMO_MS = 600_000;
const LOTE_POR_DEFECTO = 20;
const LOTE_MINIMO = 1;
const LOTE_MAXIMO = 500;

/** Donde el proceso deja su latido si nadie dice otra cosa (`CORREO_LATIDO`). */
const LATIDO_POR_DEFECTO = resolve(tmpdir(), 'costeo-correo.latido');

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    DESPACHADOR_DATABASE_URL: cadenaDeConexionConRol(
      ROL_DEL_DESPACHADOR,
      'El despachador solo ve `email_outbox` y `rate_limit_hit`, y lo ve por su rol: con cualquier ' +
        'otro, o no arranca o ve de mas (ADR-025).',
    ),

    ...VARIABLES_DE_CORREO,

    /** Cada cuanto se hace una pasada por la cola. */
    CORREO_INTERVALO_MS: z.coerce
      .number()
      .int()
      .min(INTERVALO_MINIMO_MS)
      .max(INTERVALO_MAXIMO_MS)
      .default(INTERVALO_POR_DEFECTO_MS),

    /** Cuantos correos como maximo por pasada. */
    CORREO_LOTE: z.coerce.number().int().min(LOTE_MINIMO).max(LOTE_MAXIMO).default(LOTE_POR_DEFECTO),

    /** El archivo del latido que mira el healthcheck del contenedor. */
    CORREO_LATIDO: z.string().trim().min(1).default(LATIDO_POR_DEFECTO),
  })
  .superRefine((valores, ctx) => {
    if (valores.NODE_ENV === 'production' && valores.MAIL_ADAPTER === 'fake') {
      ctx.addIssue({
        code: 'custom',
        path: ['MAIL_ADAPTER'],
        message:
          'en produccion no puede ser `fake`: marcaria ENVIADO lo que nadie recibio. ' +
          'Usa `resend` (con RESEND_API_KEY y RESEND_REMITENTE) o, mientras no haya cuenta, `consola`.',
      });
    }
  });

export interface ConfiguracionDelDespachador {
  readonly isProduction: boolean;
  readonly databaseUrl: string;
  readonly mailAdapter: AdaptadorDeCorreo;
  readonly resend: ConfiguracionDeResend;
  readonly intervaloMs: number;
  readonly lote: number;
  readonly latido: string;
}

/** Token de inyeccion de la configuracion del despachador, ya validada. */
export const CONFIGURACION_DEL_DESPACHADOR = 'CONFIGURACION_DEL_DESPACHADOR';

/** @throws {InvalidEnvironmentError} con la lista de problemas, sin valores. */
export function cargarConfiguracionDelDespachador(source: NodeJS.ProcessEnv): ConfiguracionDelDespachador {
  const valores = validarEntorno(esquema, source);

  return {
    isProduction: valores.NODE_ENV === 'production',
    databaseUrl: valores.DESPACHADOR_DATABASE_URL,
    mailAdapter: valores.MAIL_ADAPTER,
    resend: resendDe(valores),
    intervaloMs: valores.CORREO_INTERVALO_MS,
    lote: valores.CORREO_LOTE,
    latido: valores.CORREO_LATIDO,
  };
}
