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

// Con extensión: es lo que deja probar este archivo con `node --test` (ADR-027).
import { csrfEnMemoria, guardarCsrf } from './csrf.ts';

/** La URL de la API. Sin valor por defecto: si falta, se ve al arrancar. */
const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? '';


/**
 * Un error que la API devolvió, con su código de dominio.
 *
 * El backend contesta `{ code, message }` en todos los fallos —un solo formato,
 * puesto por `ErrorFilter`— y `message` **está escrito para leerse**: sale del
 * dominio y ya viene en español y sin nombres de tabla. Reescribirlo aquí sería
 * inventar; lo que sí hace la pantalla es decidir dónde ponerlo.
 */
export class ErrorDeApi extends Error {
  public readonly codigo: string;
  public readonly estado: number;

  // Campos explícitos y no `public readonly` en los parámetros: esa forma no es
  // sintaxis borrable, y Node la rechaza al correr las pruebas (ADR-027).
  public constructor(codigo: string, mensaje: string, estado: number) {
    super(mensaje);
    this.name = 'ErrorDeApi';
    this.codigo = codigo;
    this.estado = estado;
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

/**
 * El código de una sesión caducada, revocada o inexistente. **No es cualquier
 * 401**: el login fallido también lo es (`CREDENCIALES_INVALIDAS`), y mandar a
 * «entrar» a quien está entrando sería un bucle.
 */
const SESION_INVALIDA = 'SESION_INVALIDA';

/**
 * Qué hacer cuando la sesión se cae a mitad de uso — lo registra el armazón.
 *
 * **ES TRANSPORTE, NO NEGOCIO**, y vive aquí para no copiar el mismo `if` en
 * treinta pantallas (el clon que `audit:duplication` cazaría). Una sola: la
 * registra quien sabe navegar (`useEntrarAlCaducar`).
 *
 * **DEVUELVE CÓMO QUITARLO, Y SOLO QUITA EL SUYO**: al pasar de `/sucursal` al
 * armazón, el que se desmonta no debe borrar el que acaba de registrar el otro.
 */
let alCaducar: (() => void) | null = null;

export function alCaducarSesion(manejador: () => void): () => void {
  alCaducar = manejador;
  return () => {
    if (alCaducar === manejador) alCaducar = null;
  };
}

async function comoError(respuesta: Response): Promise<ErrorDeApi> {
  const cuerpo = (await respuesta.json().catch(() => ({}))) as CuerpoDeError;

  const codigo = typeof cuerpo.code === 'string' ? cuerpo.code : 'ERROR';
  const mensaje = typeof cuerpo.message === 'string' ? cuerpo.message : SIN_DETALLE;

  return new ErrorDeApi(codigo, mensaje, respuesta.status);
}

/**
 * El texto que una pantalla enseña cuando algo falló: el `message` del backend,
 * que ya viene escrito para leerse, o el genérico si ni siquiera hubo respuesta.
 */
export function mensajeDe(fallo: unknown): string {
  return fallo instanceof Error ? fallo.message : SIN_DETALLE;
}

/** El código de dominio de un fallo, o `null` si no vino de la API. */
export function codigoDe(fallo: unknown): string | null {
  return fallo instanceof ErrorDeApi ? fallo.codigo : null;
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
 * El token que firma la mutación, o `null` si no hay sesión.
 *
 * **SIN SESIÓN NO HAY TOKEN, Y LA MUTACIÓN SALE SIN ÉL.** Hasta el armazón, un
 * 401 aquí subía tal cual, y eso rompió «Entrar» desde P16-A2 sin que nada lo
 * dijera: sin cookie, `GET /auth/sesion` da 401, el login no llegaba a salir y la
 * pantalla lo pintaba como «el correo o la contraseña no coinciden» (INC-023).
 * Las cuatro rutas públicas —login, activación, olvido, restablecimiento— no
 * piden token porque nace CON la sesión. Y no se marca cuáles son aquí: una
 * lista en el cliente es la que alguien olvida al añadir la quinta. Sin sesión
 * la API decide: la ruta pública funciona y la protegida contesta
 * `SESION_INVALIDA`, que es el error verdadero y no uno de CSRF que mandaría a
 * recargar una página que va a volver a fallar.
 *
 * **NO HAY RECURSIÓN**: `GET /auth/sesion` es una lectura, y las lecturas no
 * piden token.
 */
async function tokenDeMutacion(): Promise<string | null> {
  const enMemoria = csrfEnMemoria();
  if (enMemoria !== null) return enMemoria;

  try {
    const sesion = await intentar<SesionDeLaApi>({ ruta: '/auth/sesion' });
    guardarCsrf(sesion.csrf);
    return sesion.csrf;
  } catch (fallo) {
    if (codigoDe(fallo) === SESION_INVALIDA) return null;
    throw fallo;
  }
}

async function cabecerasDe(metodo: Metodo, cuerpo: unknown): Promise<HeadersInit> {
  const cabeceras: Record<string, string> = {};
  if (cuerpo !== undefined) cabeceras['content-type'] = 'application/json';
  const token = metodo === 'GET' ? null : await tokenDeMutacion();
  if (token !== null) cabeceras['X-CSRF-Token'] = token;
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

  if (!respuesta.ok) {
    const error = await comoError(respuesta);
    if (error.codigo === SESION_INVALIDA) alCaducar?.();
    throw error;
  }
  return cuerpoDe<T>(respuesta);
}

/**
 * El cuerpo de una respuesta que salió bien, o `undefined` si no trae.
 *
 * **NO SOLO EL 204 VIENE VACÍO.** Hasta la pantalla 1b solo se trataba así el
 * 204, y `POST /auth/password/olvido` responde **202 sin cuerpo** —siempre, para
 * no delatar si el correo existe—: `respuesta.json()` reventaba con «Unexpected
 * end of JSON input» y la pantalla enseñaba ese texto a quien acababa de pedir su
 * enlace, que sí se había encolado (INC-025). Se lee el texto y se decide por lo
 * que trae, no por el código de estado.
 */
async function cuerpoDe<T>(respuesta: Response): Promise<T> {
  const texto = await respuesta.text();
  return (texto === '' ? undefined : JSON.parse(texto)) as T;
}
