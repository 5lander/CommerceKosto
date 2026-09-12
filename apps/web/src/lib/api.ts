/**
 * El cliente de la API. `fetch` y nada más.
 *
 * **CERO LÓGICA DE NEGOCIO** (CLAUDE.md §10). Este archivo transporta y traduce
 * errores; no calcula ni un número. Si una pantalla necesita un cálculo que la
 * API no da, **se añade a la API**, no aquí.
 *
 * **LOS DECIMALES SON `string` Y SE QUEDAN COMO `string`.** No hay ni un
 * `parseFloat` en todo `apps/web`, y no es purismo: `0.1 + 0.2` da
 * `0.30000000000000004`, y el producto de este sistema es la exactitud del
 * número. La API los manda a escala de almacenamiento como texto; la pantalla
 * los enseña como texto.
 *
 * **LA SESIÓN VIAJA EN UNA COOKIE `HttpOnly`**, que el navegador manda solo con
 * `credentials: 'include'`. El token no se toca desde JavaScript ni se guarda en
 * `localStorage`: si un XSS pudiera leerlo, la sesión sería robable.
 *
 * **Y TODA MUTACIÓN LLEVA ADEMÁS `X-CSRF-Token`** (ADR-021). Es lo contrario de
 * la cookie y por eso funciona: la cookie la manda el navegador solo, incluso
 * en una petición que provocó otro sitio; la cabecera la pone este código, y
 * otro sitio no puede ponerla. Si no está en memoria —porque la pestaña se
 * recargó— se pide con `GET /auth/sesion` antes de mutar, que es una lectura y
 * por tanto no necesita token. Y si el que había **dejó de valer** —dos pestañas,
 * dos sesiones—, la mutación se reintenta **una sola vez** con uno nuevo: ver
 * `llamar`.
 */

import { csrfEnMemoria, guardarCsrf } from './csrf';

/** La URL de la API. Sin valor por defecto: si falta, se ve al arrancar. */
const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';

const SIN_CONTENIDO = 204;

/**
 * Un error que la API devolvió, con su código de dominio.
 *
 * El backend contesta `{ code, message }` en todos los fallos —un solo formato,
 * puesto por `ErrorFilter`— y `message` **está escrito para leerse**: sale del
 * dominio y ya viene en español y sin nombres de tabla. Reescribirlo aquí sería
 * inventar; lo que sí hace la pantalla es decidir dónde ponerlo.
 */
export class ErrorDeApi extends Error {
  public constructor(
    public readonly codigo: string,
    mensaje: string,
    public readonly estado: number,
  ) {
    super(mensaje);
    this.name = 'ErrorDeApi';
  }
}

interface CuerpoDeError {
  readonly code?: unknown;
  readonly message?: unknown;
}

/** El mensaje cuando ni siquiera se pudo hablar con la API. */
const SIN_RED =
  'No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.';

const SIN_DETALLE = 'Algo salió mal. Vuelve a intentarlo en un momento.';

/** El código con el que la API dice «ese token no es el de esta sesión». */
const CSRF_INVALIDO = 'CSRF_INVALIDO';

async function comoError(respuesta: Response): Promise<ErrorDeApi> {
  const cuerpo = (await respuesta.json().catch(() => ({}))) as CuerpoDeError;

  const codigo = typeof cuerpo.code === 'string' ? cuerpo.code : 'ERROR';
  const mensaje = typeof cuerpo.message === 'string' ? cuerpo.message : SIN_DETALLE;

  return new ErrorDeApi(codigo, mensaje, respuesta.status);
}

type Metodo = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface Peticion {
  readonly ruta: string;
  readonly metodo?: Metodo;
  readonly cuerpo?: unknown;
}

/** Lo que devuelve `GET /auth/sesion`. Aquí solo interesa el token. */
interface SesionDeLaApi {
  readonly csrf: string;
}

/**
 * El token que firma la mutación.
 *
 * **NO HAY RECURSIÓN**: `GET /auth/sesion` es una lectura, y las lecturas no
 * piden token. Si la llamada falla, el error sube tal cual — un 401 aquí
 * significa que la sesión caducó, y esconderlo detrás de un fallo de CSRF
 * mandaría al usuario a recargar una página que va a volver a fallar.
 */
async function tokenDeMutacion(): Promise<string> {
  const enMemoria = csrfEnMemoria();
  if (enMemoria !== null) return enMemoria;

  const sesion = await llamar<SesionDeLaApi>({ ruta: '/auth/sesion' });
  guardarCsrf(sesion.csrf);
  return sesion.csrf;
}

async function cabecerasDe(metodo: Metodo, cuerpo: unknown): Promise<HeadersInit> {
  const cabeceras: Record<string, string> = {};
  if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
  if (metodo !== 'GET') cabeceras['X-CSRF-Token'] = await tokenDeMutacion();
  return cabeceras;
}

/**
 * Una llamada a la API, con **un solo** reintento cuando el token no vale.
 *
 * EL CASO SE DA SIN NINGÚN ATACANTE DE POR MEDIO. Pestaña A abierta, el usuario
 * vuelve a entrar en la pestaña B: el login de B sobrescribe la cookie `sesion`
 * del sitio —mismo nombre, mismo `Path`— y la pestaña A pasa a navegar con la
 * sesión de B conservando en memoria el token de A. Como `csrfEnMemoria()` no es
 * `null`, sin esto A no volvería a pedir el token nunca y **toda** mutación suya
 * daría 403 hasta que alguien recargue, sin una sola pista de que recargar es la
 * solución. `GET /auth/sesion` existe precisamente para esto.
 *
 * UNA VEZ, Y ESCRITO DE FORMA QUE NO PUEDA SER DOS: el reintento llama a
 * `intentar`, no a `llamar`, así que no hay camino por el que se repita —no es
 * un contador que alguien pueda subir, es un bucle que no existe—. Reintentar
 * contra un 403 es una denegación de servicio contra el propio servidor. Si el
 * segundo intento vuelve a fallar, el error sube con el mensaje del backend.
 */
export async function llamar<T>(peticion: Peticion): Promise<T> {
  try {
    return await intentar<T>(peticion);
  } catch (error) {
    if (!esTokenQueYaNoVale(error, peticion.metodo)) throw error;

    guardarCsrf(null);
    return await intentar<T>(peticion);
  }
}

/**
 * Solo en mutaciones: una lectura no manda token, así que un `CSRF_INVALIDO` en
 * un `GET` no lo arreglaría pedir uno nuevo — sería un bucle con otro nombre.
 */
function esTokenQueYaNoVale(error: unknown, metodo: Metodo | undefined): boolean {
  if (metodo === undefined || metodo === 'GET') return false;
  return error instanceof ErrorDeApi && error.codigo === CSRF_INVALIDO;
}

/**
 * `credentials: 'include'` es lo que manda la cookie de sesión. Sin eso, cada
 * petición sale sin autenticar y la API contesta 401 — que es el fallo que más
 * tiempo cuesta la primera vez, porque en el navegador «parece» que la cookie
 * está.
 */
async function intentar<T>({ ruta, metodo = 'GET', cuerpo }: Peticion): Promise<T> {
  const cabeceras = await cabecerasDe(metodo, cuerpo);
  let respuesta: Response;

  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      credentials: 'include',
      headers: cabeceras,
      body: cuerpo === undefined ? null : JSON.stringify(cuerpo),
      cache: 'no-store',
    });
  } catch {
    // Se convierte en un error de dominio y NO se silencia: sin esto, el
    // `TypeError: Failed to fetch` de `fetch` llega a la pantalla tal cual, y a
    // un dueño de restaurante eso no le dice nada.
    throw new ErrorDeApi('SIN_RED', SIN_RED, 0);
  }

  if (!respuesta.ok) throw await comoError(respuesta);
  if (respuesta.status === SIN_CONTENIDO) return undefined as T;

  return (await respuesta.json()) as T;
}
