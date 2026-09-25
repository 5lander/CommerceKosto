/**
 * Invitar, reenviar y aceptar, empaquetados como una sola dependencia.
 *
 * Misma razon que `RolesDeUsuario`: el controlador de usuarios tendria cinco
 * colaboradores y el limite son tres (CLAUDE.md §3), y estas tres son la
 * misma operacion en tres momentos —el primer correo, el siguiente, y el
 * enlace que se acepta—. Aceptar se sumo en P16-A1, cuando el controlador
 * necesito la configuracion para resolver la IP del cliente (D-16.49). Y vive
 * en su propio archivo por lo mismo que aquella: `emitDecoratorMetadata`
 * evalua los tipos del constructor al definir la clase decorada, y una clase
 * declarada despues en el mismo archivo explota al arrancar.
 */

import { AceptarInvitacion, InvitarUsuario, ReenviarInvitacion } from '../../application/casos-de-uso/usuarios';

export class InvitacionesDeUsuario {
  public constructor(
    public readonly invitar: InvitarUsuario,
    public readonly reenviar: ReenviarInvitacion,
    public readonly aceptar: AceptarInvitacion,
  ) {}
}
