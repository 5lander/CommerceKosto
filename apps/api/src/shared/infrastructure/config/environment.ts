/**
 * Esquema de entorno — validacion por esquema en un limite externo
 * (CLAUDE.md §3) y configuracion del sistema (docs/sistema/configuracion.md).
 *
 * LA APLICACION NO ARRANCA SI ESTO NO PASA. Es preferible no arrancar a
 * arrancar mal configurada: una variable ausente que se resuelve con un valor
 * por defecto silencioso es como se llega a produccion apuntando a la base
 * equivocada.
 *
 * TRES COMPROBACIONES QUE NO SON DE FORMATO, SINO DE SEGURIDAD:
 *
 *   1. El usuario de `DATABASE_URL` tiene que ser EXACTAMENTE `costeo_app`.
 *      El fallo mas probable de todo el proyecto es copiar aqui la cadena del
 *      migrator "para que funcione la migracion". `costeo_migrator` es dueno de
 *      las tablas, y el dueno esquiva RLS salvo `FORCE`: toda la Barrera 1 se
 *      volveria decorativa sin que nada avisara (CLAUDE.md §4.1).
 *
 *   2. En produccion, `MIGRATION_DATABASE_URL` y `SHADOW_DATABASE_URL` NO
 *      pueden existir en el entorno del proceso. Un proceso que no tiene la
 *      credencial no puede usarla por accidente ni cederla bajo RCE.
 *
 *   3. Ningun mensaje de error repite el VALOR de la variable. Las cadenas de
 *      conexion llevan contrasena dentro, y un fallo de arranque acaba en un
 *      log, en una captura de pantalla o en un ticket.
 */

import { z } from 'zod';

const PUERTO_MINIMO = 1;
const PUERTO_MAXIMO = 65_535;
const TIMEOUT_PETICION_POR_DEFECTO_MS = 15_000;
const TIMEOUT_MINIMO_MS = 1_000;
const TIMEOUT_MAXIMO_MS = 120_000;
const VENTANA_RATE_LIMIT_POR_DEFECTO_MS = 60_000;
const PETICIONES_POR_VENTANA_POR_DEFECTO = 300;
const PUERTO_POR_DEFECTO = 3_000;

/** El rol con el que la aplicacion —y solo la aplicacion— se conecta. */
const ROL_DE_APLICACION = 'costeo_app';

export class InvalidEnvironmentError extends Error {
  public constructor(public readonly problems: readonly string[]) {
    super(
      `Configuracion de entorno invalida:\n${problems.map((p) => `  - ${p}`).join('\n')}\n\n` +
        'Revisa `.env` contra `.env.example`. La aplicacion no arranca mal configurada.',
    );
    this.name = 'InvalidEnvironmentError';
  }
}

/**
 * Extrae el usuario de una cadena de conexion sin exponerla.
 * @returns el usuario, o `null` si la cadena no es una URL valida.
 */
function usuarioDeLaConexion(cadena: string): string | null {
  try {
    return decodeURIComponent(new URL(cadena).username);
  } catch {
    return null;
  }
}

/**
 * LA COMPROBACION DEL ROL VA EN EL CAMPO, NO EN UN `superRefine` DEL OBJETO, y
 * la diferencia se descubrio con una prueba: `superRefine` solo se ejecuta si
 * TODOS los campos han pasado su propia validacion. Con un `PORT` invalido a la
 * vez, la comprobacion del rol no llegaba a correr y el informe salia
 * incompleto — se arreglaba el puerto, se reiniciaba, y aparecia un segundo
 * fallo que ya estaba ahi desde el principio. En el campo se evalua siempre,
 * independientemente de lo que pase con el resto del entorno.
 */
const cadenaDeConexionDeLaAplicacion = z
  .string()
  .min(1)
  .superRefine((valor, ctx) => {
    const usuario = usuarioDeLaConexion(valor);

    if (usuario === null) {
      ctx.addIssue({
        code: 'custom',
        // El ejemplo se describe en palabras y no se escribe como cadena de
        // conexion: `audit:secrets` reconoce el patron y marcaria este archivo.
        // Un check que hay que silenciar a mano deja de servir para lo que es.
        message: 'no es una URL de conexion valida: falta el esquema postgresql, el usuario, el host o la base',
      });
      return;
    }

    if (usuario !== ROL_DE_APLICACION) {
      ctx.addIssue({
        code: 'custom',
        message:
          `el usuario es "${usuario}" y tiene que ser "${ROL_DE_APLICACION}". ` +
          'La aplicacion NUNCA se conecta con el rol de migraciones: es dueno de las tablas ' +
          'y eso deja la Barrera 1 en decorativa (CLAUDE.md §4.1).',
      });
    }
  });

const puerto = z.coerce.number().int().min(PUERTO_MINIMO).max(PUERTO_MAXIMO);

const esquema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: puerto.default(PUERTO_POR_DEFECTO),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

    DATABASE_URL: cadenaDeConexionDeLaAplicacion,
    MIGRATION_DATABASE_URL: z.string().optional(),
    SHADOW_DATABASE_URL: z.string().optional(),

    REQUEST_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(TIMEOUT_MINIMO_MS)
      .max(TIMEOUT_MAXIMO_MS)
      .default(TIMEOUT_PETICION_POR_DEFECTO_MS),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(TIMEOUT_MINIMO_MS).default(VENTANA_RATE_LIMIT_POR_DEFECTO_MS),
    RATE_LIMIT_MAX: z.coerce.number().int().min(PUERTO_MINIMO).default(PETICIONES_POR_VENTANA_POR_DEFECTO),

    MAIL_ADAPTER: z.enum(['fake', 'real']).default('fake'),
    STORAGE_ADAPTER: z.enum(['fake', 'real']).default('fake'),
  })
  .superRefine((valores, ctx) => {
    if (valores.NODE_ENV !== 'production') {
      return;
    }

    for (const variable of ['MIGRATION_DATABASE_URL', 'SHADOW_DATABASE_URL'] as const) {
      if (valores[variable] !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: [variable],
          message:
            'no puede existir en el entorno del proceso de la aplicacion en produccion. ' +
            'Las migraciones corren en su propio paso de despliegue, con su propia credencial ' +
            '(docs/runbooks/despliegue.md).',
        });
      }
    }
  });

export interface Configuration {
  readonly nodeEnv: 'development' | 'test' | 'production';
  readonly isProduction: boolean;
  readonly port: number;
  readonly logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly databaseUrl: string;
  readonly requestTimeoutMs: number;
  readonly rateLimit: { readonly windowMs: number; readonly max: number };
  readonly mailAdapter: 'fake' | 'real';
  readonly storageAdapter: 'fake' | 'real';
}

/** Token de inyeccion de la configuracion ya validada. */
export const CONFIGURATION = 'CONFIGURATION';

/**
 * @throws {InvalidEnvironmentError} con la lista de problemas, sin valores.
 */
export function loadConfiguration(source: NodeJS.ProcessEnv): Configuration {
  const resultado = esquema.safeParse(source);

  if (!resultado.success) {
    // Se construye el mensaje a mano: `z.prettifyError` y `treeifyError` son
    // seguros hoy, pero nada garantiza que una version futura no incluya el
    // valor recibido, y ese valor lleva la contrasena de la base dentro.
    throw new InvalidEnvironmentError(
      resultado.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  const valores = resultado.data;

  return {
    nodeEnv: valores.NODE_ENV,
    isProduction: valores.NODE_ENV === 'production',
    port: valores.PORT,
    logLevel: valores.LOG_LEVEL,
    databaseUrl: valores.DATABASE_URL,
    requestTimeoutMs: valores.REQUEST_TIMEOUT_MS,
    rateLimit: { windowMs: valores.RATE_LIMIT_WINDOW_MS, max: valores.RATE_LIMIT_MAX },
    mailAdapter: valores.MAIL_ADAPTER,
    storageAdapter: valores.STORAGE_ADAPTER,
  };
}
