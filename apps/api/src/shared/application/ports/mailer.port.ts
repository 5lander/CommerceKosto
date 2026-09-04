/**
 * Puerto de correo transaccional — CLAUDE.md §12.
 *
 * En P0 no hay ningun emisor: el primero llega en P1 (invitacion de usuario).
 * Existe ya, con su falso, porque el criterio de aceptacion de P0 es que el
 * sistema levante de punta a punta SIN UNA SOLA CREDENCIAL REAL, y eso solo se
 * puede demostrar si el hueco esta cableado desde el principio.
 *
 * La superficie es deliberadamente minima: una sola operacion. Cuando P1
 * necesite plantillas o adjuntos, se anaden entonces (OPTIMIZACION.md §1).
 */

export const MAILER_PORT = 'MAILER_PORT';

export interface OutgoingMail {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface MailerPort {
  send(mail: OutgoingMail): Promise<void>;
}
