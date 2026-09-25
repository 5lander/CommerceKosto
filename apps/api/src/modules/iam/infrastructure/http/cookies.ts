/**
 * La cookie de sesion — SEGURIDAD.md §2.2.
 *
 * SE ESCRIBE A MANO Y NO CON `cookie-parser`. Son quince lineas contra una
 * dependencia mas en la superficie de ataque de un proyecto que ya declara
 * "sin dependencias para 10 lineas" (OPTIMIZACION.md §1). Ademas, escribir el
 * `Set-Cookie` aqui hace que los atributos de seguridad esten a la vista en vez
 * de repartidos por opciones de una libreria.
 *
 * LOS CUATRO ATRIBUTOS, Y QUE ATAQUE CIERRA CADA UNO:
 *
 *   HttpOnly           el JavaScript de la pagina no puede leer el token. Es lo
 *                      que convierte un XSS en "puede actuar mientras la
 *                      victima mira" en vez de "se lleva la sesion y vuelve
 *                      cuando quiera".
 *
 *   SameSite=Strict    el navegador no manda la cookie en peticiones venidas de
 *                      otro sitio. Es la PRIMERA defensa contra CSRF, y desde
 *                      P16-A2 no es la unica: ver abajo.
 *
 *   Secure             la cookie no viaja por HTTP en claro.
 *
 *   Path=/             una sola sesion para toda la API.
 *
 * POR QUE HAY ADEMAS UN TOKEN ANTI-CSRF, AUNQUE LA COOKIE SEA `Strict`
 * (U4, ADR-021). Hasta P16-A1 este comentario decia que el token no hacia
 * falta «porque no hay peticion cruzada que lleve credencial». Era cierto
 * SUPONIENDO que el navegador cumpla, y esa suposicion es justo la que no se
 * puede comprobar desde el servidor:
 *
 *   1. `SameSite` LO APLICA EL CLIENTE. Un navegador antiguo que no lo
 *      entienda ignora el atributo entero y manda la cookie: la defensa
 *      desaparece sin que la API se entere. El token lo comprueba el servidor,
 *      que es la unica parte de esta conversacion que controlamos.
 *
 *   2. `SameSite` MIRA EL SITIO, NO EL ORIGEN. `otro.midominio.com` es el
 *      MISMO sitio que `app.midominio.com`: un subdominio comprometido —una
 *      pagina de marketing, un `wildcard` de DNS mal cerrado— manda la cookie
 *      con toda normalidad. El token no viaja solo, asi que ese subdominio
 *      sigue sin poder hacer nada.
 *
 *   3. Y NO SE ARGUMENTA POR REDUNDANCIA. «Dos defensas por si una falla» es
 *      una excusa comoda; lo que sostiene esta es que las dos fallan por
 *      motivos DISTINTOS y que ninguna cubre el hueco de la otra. Una cookie
 *      `Strict` no protege de un subdominio; un token no protege de un XSS en
 *      la propia pagina. Juntas dejan menos hueco que cualquiera de las dos.
 *
 * EL TOKEN NO VIAJA EN NINGUNA COOKIE, y por eso no aparece en este archivo:
 * sale en el cuerpo del login y de `GET /auth/sesion`, y vuelve en la cabecera
 * `X-CSRF-Token`. Una cookie la manda el navegador sola, incluso en la
 * peticion cruzada, que es exactamente lo que se esta intentando cortar.
 *
 * `Secure` SE OMITE FUERA DE PRODUCCION, y solo ahi: en desarrollo la
 * aplicacion habla por `http://localhost` y el navegador descartaria la cookie
 * sin decir nada, de modo que "no puedo entrar en local" se convertiria en una
 * tarde perdida. La decision es explicita y depende de una unica bandera.
 */

export const COOKIE_DE_SESION = 'sesion';

const MILISEGUNDOS_POR_SEGUNDO = 1000;

/**
 * @param cabecera el valor crudo de `Cookie`, tal cual llega.
 * @returns el valor de la cookie, o `null` si no esta.
 */
export function leerCookie(cabecera: string | undefined, nombre: string): string | null {
  if (cabecera === undefined) {
    return null;
  }

  for (const parte of cabecera.split(';')) {
    const separador = parte.indexOf('=');
    if (separador === -1) {
      continue;
    }
    if (parte.slice(0, separador).trim() === nombre) {
      return decodeURIComponent(parte.slice(separador + 1).trim());
    }
  }

  return null;
}

/**
 * `nombre` existe desde P11, y por una razon de seguridad y no de comodidad.
 *
 * El back office corre en OTRO PROCESO pero, en desarrollo, en el mismo host que
 * la aplicacion cliente. Dos cookies con el mismo nombre en el mismo host se
 * pisan: entrar al back office cerraria la sesion de la app y al reves. Peor: la
 * cookie de un sistema viajaria a las peticiones del otro. Nombres distintos son
 * lo que mantiene separadas dos identidades que NO deben tocarse.
 */
export function cookieDeSesion(entrada: {
  readonly token: string;
  readonly expiraEn: Date;
  readonly ahora: Date;
  readonly seguro: boolean;
  readonly nombre?: string;
}): string {
  const segundos = Math.max(
    0,
    Math.floor((entrada.expiraEn.getTime() - entrada.ahora.getTime()) / MILISEGUNDOS_POR_SEGUNDO),
  );

  return atributos([
    `${entrada.nombre ?? COOKIE_DE_SESION}=${encodeURIComponent(entrada.token)}`,
    `Max-Age=${String(segundos)}`,
    entrada.seguro,
  ]);
}

/** La misma cookie, vaciada y caducada: es como se cierra sesion en el cliente. */
export function cookieBorrada(seguro: boolean, nombre: string = COOKIE_DE_SESION): string {
  return atributos([`${nombre}=`, 'Max-Age=0', seguro]);
}

function atributos(partes: readonly [string, string, boolean]): string {
  const [valor, vida, seguro] = partes;
  const comunes = [valor, 'Path=/', 'HttpOnly', 'SameSite=Strict', vida];

  return (seguro ? [...comunes, 'Secure'] : comunes).join('; ');
}
