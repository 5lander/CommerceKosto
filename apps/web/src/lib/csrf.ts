/**
 * El token anti-CSRF del navegador — ADR-021.
 *
 * **QUÉ ES.** Un valor que la API entrega al iniciar sesión y que hay que
 * devolverle en la cabecera `X-CSRF-Token` de toda mutación. Sirve para que la
 * API distinga una petición hecha por ESTA página de una que provocó otro
 * sitio: un sitio cruzado puede hacer que el navegador envíe una petición con
 * la cookie, pero no puede leer este token ni ponerle una cabecera.
 *
 * **POR QUÉ VIVE AQUÍ Y NO EN `sesion.tsx`.** `sesion.tsx` es un contexto de
 * React, y `api.ts` —que es quien necesita el token— no es un componente: se
 * llama desde manejadores de eventos y desde funciones sueltas, donde no hay
 * contexto que leer. Un módulo con una variable es lo que las dos partes
 * pueden compartir sin que la capa de transporte dependa de React.
 *
 * **POR QUÉ EN MEMORIA Y NO EN `localStorage`.** Porque no hace falta: una
 * recarga lo pierde, y `recuperar()` lo vuelve a pedir con `GET /auth/sesion`,
 * que la cookie —esa sí sobrevive— autentica. Guardarlo en disco solo añadiría
 * un sitio donde encontrarlo, y la pantalla ya lo recupera sola.
 *
 * **NO ES LA CREDENCIAL.** La credencial es la cookie `HttpOnly` que este
 * código no puede leer. Este token sin esa cookie no sirve para nada, y por eso
 * es aceptable —y necesario— que JavaScript lo tenga delante.
 */

let token: string | null = null;

/** Lo llama el login con lo que devolvió la API, y el cierre de sesión con `null`. */
export function guardarCsrf(valor: string | null): void {
  token = valor;
}

export function csrfEnMemoria(): string | null {
  return token;
}
