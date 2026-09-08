/**
 * El motivo de un acceso cross-tenant. Dominio puro: no sabe de HTTP ni de base.
 *
 * **ES LA PIEZA QUE CONVIERTE EL RIESGO ASUMIDO EN RIESGO GESTIONADO.** SPEC §1
 * eligió la conexión privilegiada por encima de la alternativa —una cuenta
 * dentro de cada tenant— y puso tres condiciones. Esta es la tercera: todo
 * acceso queda en un registro con usuario, company, motivo, hora e IP. Sin
 * motivo, el registro dice *que* alguien miró y no *por qué*, que es la única
 * pregunta que ese registro existe para responder.
 *
 * **VEINTE CARACTERES.** No impide escribir veinte letras sin sentido, y no
 * pretende: impide el `-`, el `.` y el `soporte` que es exactamente lo que se
 * teclea cuando el campo admite cualquier cosa. La cifra está también en un
 * `CHECK` de la base, y las dos tienen que coincidir — la base garantiza, el
 * dominio explica (INC-012).
 *
 * **SE COMPRUEBA EN EL CAMPO, NO EN UN REFINAMIENTO DE OBJETO.** Un refinamiento
 * no se ejecuta si otro campo falló antes, y entonces un error de formato en
 * cualquier otro sitio desactivaría en silencio el control de auditoría
 * (INC-008).
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/** El mismo número que el CHECK `backoffice_access_log_motivo_con_sustancia`. */
export const MINIMO_DEL_MOTIVO = 20;

export const MAXIMO_DEL_MOTIVO = 1000;

export class MotivoInsuficienteError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(faltan: number) {
    super(
      `El motivo del acceso necesita al menos ${String(MINIMO_DEL_MOTIVO)} caracteres; ` +
        `faltan ${String(faltan)}. Escribe para qué necesitas ver estos datos: ` +
        `queda registrado y lo va a leer alguien.`,
      { minimo: MINIMO_DEL_MOTIVO, faltan },
    );
  }
}

export class MotivoDemasiadoLargoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor() {
    super(`El motivo no puede pasar de ${String(MAXIMO_DEL_MOTIVO)} caracteres.`, {
      maximo: MAXIMO_DEL_MOTIVO,
    });
  }
}

/**
 * Normaliza y valida el motivo.
 *
 * Devuelve el motivo **recortado**, que es el que se guarda: los espacios de los
 * bordes no cuentan para el mínimo —el `CHECK` de la base usa `btrim` por lo
 * mismo— y guardarlos sería guardar ruido.
 *
 * @throws {MotivoInsuficienteError} · {@link MotivoDemasiadoLargoError}
 */
export function exigirMotivoSuficiente(crudo: string): string {
  const motivo = crudo.trim();

  if (motivo.length < MINIMO_DEL_MOTIVO) {
    throw new MotivoInsuficienteError(MINIMO_DEL_MOTIVO - motivo.length);
  }
  if (motivo.length > MAXIMO_DEL_MOTIVO) {
    throw new MotivoDemasiadoLargoError();
  }

  return motivo;
}
