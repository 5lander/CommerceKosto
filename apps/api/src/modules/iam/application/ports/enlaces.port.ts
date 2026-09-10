/**
 * Los enlaces que van dentro de los correos, como puerto.
 *
 * `APP_URL` es configuracion, y `application` no lee `process.env` ni conoce
 * el esquema de entorno (CLAUDE.md §2). Lo que un caso de uso necesita no es
 * la URL: es «dame el enlace de activacion para este token». Eso es lo que
 * este puerto ofrece, y la infraestructura lo cumple con la URL publica del
 * frontend delante.
 *
 * Las rutas —`/activacion`, `/restablecer`— son las paginas publicas de
 * `apps/web` (PLAN P16, «Rutas publicas fuera de `(app)`»). Cambiar una de
 * ellas es cambiar una linea aqui y una alla, y nada en los casos de uso.
 */

export const ENLACES = 'ENLACES';

export interface Enlaces {
  deActivacion(token: string): string;
  deRestablecimiento(token: string): string;
}
