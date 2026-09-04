/**
 * Tokens opacos de sesion — SEGURIDAD.md §2.2.
 *
 * EN LA BASE VIVE EL HASH, NUNCA EL TOKEN. Un volcado de `session` —una copia
 * de seguridad mal guardada, un `SELECT` de soporte, una fuga— no permite
 * suplantar a nadie: lo que hay dentro no sirve como credencial.
 *
 * SHA-256 Y NO ARGON2, Y ES DELIBERADO. Argon2 es lento a proposito para que
 * probar millones de contrasenas cueste. Un token de sesion no se adivina
 * probando: son 256 bits de un generador criptografico, y no hay diccionario
 * de tokens. Lo unico que compraria un hash lento aqui es gastar 64 MiB y
 * decenas de milisegundos EN CADA PETICION, que es una denegacion de servicio
 * autoinfligida. La propiedad que hace falta —que del hash no se vuelva al
 * token— la da SHA-256 de sobra cuando la entrada tiene 256 bits de entropia.
 */

export const GENERADOR_DE_TOKENS = 'GENERADOR_DE_TOKENS';

export interface TokenDeSesion {
  /** Va al cliente UNA sola vez, en la cookie. No se guarda en ningun sitio. */
  readonly token: string;
  /** Lo que se guarda. */
  readonly hash: string;
}

export interface GeneradorDeTokens {
  generar(): TokenDeSesion;

  /**
   * Hash del token que presenta el cliente, para buscarlo en la base.
   *
   * La busqueda es por igualdad sobre un indice unico, asi que no hay
   * comparacion en la aplicacion y no hay canal de tiempo que cerrar: el motor
   * compara indices, no cadenas byte a byte.
   */
  hashDe(token: string): string;
}
