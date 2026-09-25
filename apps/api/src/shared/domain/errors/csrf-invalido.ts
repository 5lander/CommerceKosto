/**
 * La mutacion no trae token anti-CSRF, o el que trae no es el de su sesion.
 *
 * VIVE EN `shared` Y NO EN `iam` PORQUE LO LANZAN DOS PROCESOS. La app cliente
 * y el back office tienen sesiones distintas, tablas distintas y guards
 * distintos, pero la regla rota es la misma; duplicar el error habria dado dos
 * clases con el mismo `codigo` y el mismo texto, que es justo lo que
 * `audit:duplication` persigue.
 *
 * ES 403 Y NO 401. La sesion es valida —por eso se llego hasta aqui—; lo que
 * no vale es la PETICION. Un 401 mandaria al cliente a la pantalla de login,
 * donde no hay nada que arreglar, y le haria perder lo que estaba escribiendo.
 *
 * EL MOTIVO REAL NO SALE AL CLIENTE, va en `detalle`. No es porque sea secreto
 * —quien monta un CSRF sabe perfectamente si mando cabecera o no— sino porque
 * un mensaje distinto por motivo se convierte en tres textos que mantener para
 * un usuario que solo puede hacer una cosa: recargar y reintentar.
 */

import { ErrorDeDominio, type CodigoDeDominio } from './error-de-dominio';

/**
 * `ausente`            la mutacion no trajo `X-CSRF-Token`.
 * `no_coincide`        lo trajo, y no es el de esta sesion (o es el de otra).
 */
export type MotivoDeCsrf = 'ausente' | 'no_coincide';

export class CsrfInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CSRF_INVALIDO';

  public constructor(motivo: MotivoDeCsrf) {
    super(
      'La peticion no trae un token de seguridad valido. Recarga la pagina y vuelve a intentarlo.',
      { motivo },
    );
  }
}
