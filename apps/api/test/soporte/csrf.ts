/**
 * El unico helper de pruebas de P16-A2: el token anti-CSRF de cada sesion.
 *
 * POR QUE EXISTE, SI ESTE PROYECTO NO TIENE HELPERS DE INTEGRACION. Porque el
 * problema que resuelve no es la comodidad, es la CORRESPONDENCIA. Desde
 * P16-A2 toda mutacion necesita DOS cosas emparejadas —la cookie de una sesion
 * y el token de ESA sesion— y las suites manejan hasta cuatro sesiones a la vez
 * (dos companies, un admin, un bodeguero). Hacer que cada `entrar()` devolviera
 * un par obligaria a tocar 205 llamadas para desempaquetarlo; un registro
 * indexado por la cookie convierte cada llamada en un `.set()` mas y deja
 * imposible el error de mandar el token de otra sesion sin darse cuenta.
 *
 * SIGUE SIN HABER HELPER DE SERVIDOR NI DE SIEMBRA, que es lo que la regla
 * protege: `servidor()`, `sembrarTenant()` y `entrar()` se copian en cada
 * archivo como hasta ahora, y cada suite sigue leyendose entera sin saltar a
 * otro fichero para entender que datos tiene delante.
 *
 * ES DE PRUEBAS Y NO SE COMPILA EN LA APLICACION: vive bajo `test/`.
 */

/** Lo minimo de una respuesta de login. Encaja con la `Response` de supertest. */
interface RespuestaDeLogin {
  readonly headers: Record<string, unknown>;
  readonly body: unknown;
}

const tokens = new Map<string, string>();

/**
 * Saca la cookie de una respuesta de login, apunta su token y devuelve la
 * cookie — que es lo que las suites ya usaban.
 *
 * Sirve para los DOS logins del sistema: `POST /auth/login` de la app cliente y
 * `POST /sesion` del back office. Los dos devuelven `{ csrf }` en el cuerpo.
 */
export function cookieConCsrf(respuesta: RespuestaDeLogin): string {
  const cookie = primerPar(respuesta.headers['set-cookie']);
  const csrf = tokenDelCuerpo(respuesta.body);

  if (cookie !== '' && csrf !== null) {
    tokens.set(cookie, csrf);
  }
  return cookie;
}

/**
 * El token que le toca a esa cookie.
 *
 * DEVUELVE CADENA VACIA CUANDO NO LO CONOCE, y no lanza, a proposito: las
 * suites mandan a posta cookies inventadas o manipuladas para comprobar que
 * dan 401, y ahi el guard de sesion corta ANTES que el de CSRF. Lanzar aqui
 * convertiria esas pruebas en un fallo del helper.
 */
export function csrfDe(cookie: string): string {
  return tokens.get(cookie) ?? '';
}

function primerPar(bruto: unknown): string {
  const valor = Array.isArray(bruto) ? (bruto as readonly unknown[])[0] : bruto;
  return typeof valor === 'string' ? (valor.split(';')[0] ?? '') : '';
}

function tokenDelCuerpo(cuerpo: unknown): string | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('csrf' in cuerpo)) {
    return null;
  }
  const csrf: unknown = cuerpo.csrf;
  return typeof csrf === 'string' ? csrf : null;
}
