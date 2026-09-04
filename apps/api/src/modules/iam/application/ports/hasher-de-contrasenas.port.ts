/**
 * Verificacion de contrasenas — CLAUDE.md §4.5, SEGURIDAD.md §2.1 y §2.2.
 *
 * LA FIRMA DE `verificar` ACEPTA `null` A PROPOSITO, y es la decision de diseno
 * mas importante de este archivo.
 *
 * Cuando el correo no existe no hay hash contra el que comparar. Lo natural es
 * escribir `if (usuario === null) return fallo;` — y eso abre un canal de
 * tiempo: la respuesta para un correo inexistente tarda microsegundos y la de
 * uno existente, decenas de milisegundos. Con esa diferencia se enumera el
 * padron de usuarios sin necesidad de acertar una sola contrasena.
 *
 * Al aceptar `null`, el adaptador SIEMPRE hace el trabajo: si no hay hash,
 * verifica contra uno ficticio y devuelve `false`. Quien llama no puede
 * saltarselo porque no tiene la rama donde hacerlo.
 */

export const HASHER_DE_CONTRASENAS = 'HASHER_DE_CONTRASENAS';

export interface HasherDeContrasenas {
  /** @returns el hash codificado, con sus parametros dentro. */
  hash(plana: string): Promise<string>;

  /**
   * @param hash `null` cuando el usuario no existe o aun no tiene contrasena.
   *   El adaptador verifica igualmente contra un hash ficticio, para que el
   *   tiempo de respuesta no distinga un caso del otro.
   */
  verificar(hash: string | null, plana: string): Promise<boolean>;

  /**
   * `true` si el hash se creo con parametros mas debiles que los actuales.
   *
   * Los parametros de Argon2 se endurecen con los anos. Sin esta comprobacion,
   * una contrasena hasheada en 2026 seguiria con los parametros de 2026 en
   * 2031, y el unico momento en que se puede rehashear —cuando el usuario
   * acaba de escribirla en claro— pasaria de largo en cada login.
   */
  necesitaRehash(hash: string): boolean;
}
