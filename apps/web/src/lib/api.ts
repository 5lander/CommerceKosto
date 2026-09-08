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
 */

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

async function comoError(respuesta: Response): Promise<ErrorDeApi> {
  const cuerpo = (await respuesta.json().catch(() => ({}))) as CuerpoDeError;

  const codigo = typeof cuerpo.code === 'string' ? cuerpo.code : 'ERROR';
  const mensaje = typeof cuerpo.message === 'string' ? cuerpo.message : SIN_DETALLE;

  return new ErrorDeApi(codigo, mensaje, respuesta.status);
}

interface Peticion {
  readonly ruta: string;
  readonly metodo?: 'GET' | 'POST' | 'PUT' | 'PATCH';
  readonly cuerpo?: unknown;
}

/**
 * Una llamada a la API.
 *
 * `credentials: 'include'` es lo que manda la cookie de sesión. Sin eso, cada
 * petición sale sin autenticar y la API contesta 401 — que es el fallo que más
 * tiempo cuesta la primera vez, porque en el navegador «parece» que la cookie
 * está.
 */
export async function llamar<T>({ ruta, metodo = 'GET', cuerpo }: Peticion): Promise<T> {
  let respuesta: Response;

  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      credentials: 'include',
      headers: cuerpo === undefined ? {} : { 'content-type': 'application/json' },
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
