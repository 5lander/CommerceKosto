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

import { resendDe, VARIABLES_DE_CORREO, type ConfiguracionDeResend } from '../correo/entorno-de-correo';
import { esProxyDeConfianzaValido } from '../http/ip-del-cliente';

const PUERTO_MINIMO = 1;
const PUERTO_MAXIMO = 65_535;
const TIMEOUT_PETICION_POR_DEFECTO_MS = 15_000;
const TIMEOUT_MINIMO_MS = 1_000;
const TIMEOUT_MAXIMO_MS = 120_000;
const VENTANA_RATE_LIMIT_POR_DEFECTO_MS = 60_000;
const PETICIONES_POR_VENTANA_POR_DEFECTO = 300;
const PUERTO_POR_DEFECTO = 3_000;

/** Donde vive el frontend en desarrollo (`apps/web`, puerto 3001). */
const APP_URL_DE_DESARROLLO = 'http://localhost:3001';
const HORAS_DE_RESTABLECIMIENTO_POR_DEFECTO = 1;
/** Un dia entero de enlace vivo ya es demasiado: el tope existe para que un cero de mas no lo convierta en diez dias. */
const HORAS_DE_RESTABLECIMIENTO_MAXIMAS = 24;

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
 *
 * ES UNA FABRICA porque el despachador (P16-A1) tiene la misma regla con otro
 * rol: su esquema la construye con `costeo_despachador` en vez de repetirla.
 */
export function cadenaDeConexionConRol(rolEsperado: string, porQue: string): z.ZodType<string> {
  return z
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

      if (usuario !== rolEsperado) {
        ctx.addIssue({
          code: 'custom',
          message: `el usuario es "${usuario}" y tiene que ser "${rolEsperado}". ${porQue}`,
        });
      }
    });
}

const cadenaDeConexionDeLaAplicacion = cadenaDeConexionConRol(
  ROL_DE_APLICACION,
  'La aplicacion NUNCA se conecta con el rol de migraciones: es dueno de las tablas ' +
    'y eso deja la Barrera 1 en decorativa (CLAUDE.md §4.1).',
);

const puerto = z.coerce.number().int().min(PUERTO_MINIMO).max(PUERTO_MAXIMO);

/**
 * Una variable con lista separada por comas: se recorta cada entrada y se
 * descartan las vacias, asi `a, b,` es `['a', 'b']`. Vacia o ausente = `[]`.
 * El back office la lee a mano con la misma funcion (no tiene esquema).
 */
export function partirLista(cruda: string): string[] {
  return cruda
    .split(',')
    .map((entrada) => entrada.trim())
    .filter((entrada) => entrada !== '');
}

const listaSeparadaPorComas = z.string().default('').transform(partirLista);

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

    /**
     * `MAIL_ADAPTER` y `RESEND_*`, con la forma de `entorno-de-correo.ts`:
     * `consola` y `resend` los usa el despachador (ADR-025). La API solo
     * encola, asi que para ella los tres valores son equivalentes; se validan
     * igual porque el `.env` es uno y lo leen los dos procesos.
     */
    ...VARIABLES_DE_CORREO,
    STORAGE_ADAPTER: z.enum(['fake', 'real']).default('fake'),

    /**
     * La URL publica del frontend, SIN barra final: de aqui salen los enlaces
     * de los correos (`APP_URL/activacion?token=...`). En desarrollo se
     * resuelve sola; en produccion es obligatoria (ver el `superRefine` del
     * objeto: es una regla de produccion, como la de las credenciales de
     * migracion, no un control de seguridad — INC-008 no aplica).
     */
    APP_URL: z
      .url({ message: 'tiene que ser una URL completa, con http:// o https://' })
      .refine((url) => !url.endsWith('/'), {
        message: 'sin barra final: los enlaces se construyen como APP_URL/ruta',
      })
      .optional(),

    /** Cuanto vive un enlace de restablecimiento (D-16.34). */
    HORAS_DE_RESTABLECIMIENTO: z.coerce
      .number()
      .int()
      .min(HORAS_DE_RESTABLECIMIENTO_POR_DEFECTO)
      .max(HORAS_DE_RESTABLECIMIENTO_MAXIMAS)
      .default(HORAS_DE_RESTABLECIMIENTO_POR_DEFECTO),

    /**
     * Los origenes que pueden llamar a esta API desde un navegador, separados
     * por comas. **Vacio significa NINGUNO**, que es lo que valia hasta que
     * existio el frontend.
     *
     * `SEGURIDAD.md` §4.4: lista blanca exacta, jamas `*`, y `credentials` solo
     * con origen verificado. La validacion va EN EL CAMPO —cada origen tiene
     * que ser una URL con esquema y sin barra final— y no en un refinamiento
     * del objeto: un refinamiento no corre si otra variable fallo antes, y
     * entonces esta comprobacion desapareceria del informe sin que nada avise
     * (INC-008).
     */
    CORS_ORIGENES: listaSeparadaPorComas.pipe(
      z.array(
        z
          .url({ message: 'cada origen tiene que ser una URL completa, con http:// o https://' })
          .refine((origen) => !origen.endsWith('/'), {
            message: 'un origen no lleva barra final: el navegador nunca la manda',
          }),
      ),
    ),

    /**
     * Las direcciones desde las que se cree `X-Forwarded-For` (D-16.49,
     * INC-022): IPv4, IPv4 con prefijo CIDR o IPv6 exacta, separadas por
     * comas. **Vacia significa NINGUNA**: la IP es la del socket, que en
     * desarrollo es la verdad. En produccion es la IP fija de Caddy en la red
     * de compose (`172.28.0.10`), y solo esa: la subred entera incluiria la
     * pasarela y los demas contenedores.
     *
     * ES UN CONTROL DE SEGURIDAD, y por eso se valida EN EL CAMPO (INC-008):
     * una entrada que no es una direccion —`caddy`, `172.28.0.0/64`— no
     * "confia en nadie" en silencio, tumba el arranque con su posicion.
     */
    PROXY_DE_CONFIANZA: listaSeparadaPorComas.pipe(
      z.array(
        z.string().refine(esProxyDeConfianzaValido, {
          message: 'cada entrada tiene que ser una IPv4, una red IPv4 en CIDR (a.b.c.d/n) o una IPv6 exacta',
        }),
      ),
    ),
  })
  .superRefine((valores, ctx) => {
    if (valores.NODE_ENV !== 'production') {
      return;
    }

    if (valores.APP_URL === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['APP_URL'],
        message:
          'es obligatoria en produccion: sin ella los enlaces de los correos apuntarian a localhost, ' +
          'y ese fallo lo descubre el cliente al abrir su invitacion.',
      });
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
  readonly mailAdapter: 'fake' | 'consola' | 'resend';
  /** Solo la mira `mailerProvider` cuando el selector es `resend`. */
  readonly resend: ConfiguracionDeResend;
  readonly storageAdapter: 'fake' | 'real';
  /** Lista blanca exacta. Vacia = ningun navegador puede llamar a la API. */
  readonly corsOrigenes: readonly string[];
  /** Desde donde se cree `X-Forwarded-For`. Vacia = la IP es la del socket (D-16.49). */
  readonly proxiesDeConfianza: readonly string[];
  /** URL publica del frontend, sin barra final. Base de los enlaces de los correos. */
  readonly appUrl: string;
  readonly horasDeRestablecimiento: number;
}

/** Token de inyeccion de la configuracion ya validada. */
export const CONFIGURATION = 'CONFIGURATION';

/**
 * Valida un entorno contra su esquema o muere con la lista de problemas.
 *
 * Lo comparten este esquema y el del despachador. Se construye el mensaje a
 * mano: `z.prettifyError` y `treeifyError` son seguros hoy, pero nada
 * garantiza que una version futura no incluya el valor recibido, y ese valor
 * lleva la contrasena de la base dentro.
 *
 * @throws {InvalidEnvironmentError} con la lista de problemas, sin valores.
 */
export function validarEntorno<T>(esquemaDelProceso: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const resultado = esquemaDelProceso.safeParse(source);

  if (!resultado.success) {
    throw new InvalidEnvironmentError(
      resultado.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    );
  }

  return resultado.data;
}

/**
 * @throws {InvalidEnvironmentError} con la lista de problemas, sin valores.
 */
export function loadConfiguration(source: NodeJS.ProcessEnv): Configuration {
  const valores = validarEntorno(esquema, source);

  return {
    nodeEnv: valores.NODE_ENV,
    isProduction: valores.NODE_ENV === 'production',
    port: valores.PORT,
    logLevel: valores.LOG_LEVEL,
    databaseUrl: valores.DATABASE_URL,
    requestTimeoutMs: valores.REQUEST_TIMEOUT_MS,
    rateLimit: { windowMs: valores.RATE_LIMIT_WINDOW_MS, max: valores.RATE_LIMIT_MAX },
    mailAdapter: valores.MAIL_ADAPTER,
    resend: resendDe(valores),
    storageAdapter: valores.STORAGE_ADAPTER,
    corsOrigenes: valores.CORS_ORIGENES,
    proxiesDeConfianza: valores.PROXY_DE_CONFIANZA,
    appUrl: valores.APP_URL ?? APP_URL_DE_DESARROLLO,
    horasDeRestablecimiento: valores.HORAS_DE_RESTABLECIMIENTO,
  };
}
