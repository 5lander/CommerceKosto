/**
 * Errores de `periods`. Todos de dominio: no saben de HTTP.
 *
 * **`PeriodoCerradoError` ES EL QUE IMPORTA.** Es la guarda de INC-012 para el
 * trigger que la base pone sobre el libro de inventario: sin ella, escribir un
 * movimiento con fecha dentro de un mes cerrado sube como `P0001` sin traducir
 * y sale al cliente como `INTERNAL_ERROR 500`. La base garantiza; el dominio
 * explica. Su clasificación está en `docs/sistema/guardas-de-dominio.md`.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../../../shared/domain/errors/error-de-dominio';

/** Un mes fuera de 1..12, o un año fuera del rango que el sistema admite. */
export class MesInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(anio: number, mes: number) {
    super('El período debe ser un mes calendario real, entre enero de 2000 y diciembre de 2100.', {
      anio,
      mes,
    });
  }
}

/**
 * Cerrar un mes que todavía no ha terminado.
 *
 * Bloquearía el resto del propio mes: quien cerrara el 10 dejaría el libro sin
 * poder registrar los otros veinte días, y la única salida sería una reapertura
 * que solo el `OWNER` puede hacer.
 */
export class PeriodoNoTerminadoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(etiqueta: string) {
    super(
      `El período ${etiqueta} todavía no ha terminado. Un mes se cierra cuando ya no puede ` +
        'recibir movimientos, no antes.',
      { periodo: etiqueta },
    );
  }
}

export class PeriodoYaCerradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(etiqueta: string) {
    super(`El período ${etiqueta} ya está cerrado.`, { periodo: etiqueta });
  }
}

/** Reabrir lo que nunca se cerró. */
export class PeriodoNoCerradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(etiqueta: string) {
    super(`El período ${etiqueta} está abierto: no hay nada que reabrir.`, { periodo: etiqueta });
  }
}

export class PeriodoNoEncontradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor() {
    super('Ese período no existe en esta company.');
  }
}

/**
 * La guarda del libro: la fecha cae dentro de un mes ya cerrado.
 *
 * **INCLUYE LA CORRECCIÓN, Y ESO NO ES UN EFECTO COLATERAL.** Una corrección
 * conserva la fecha del movimiento que anula (R3), así que corregir dentro de
 * un mes cerrado también se detiene aquí. Es lo que «cerrado es de solo
 * lectura» significa (D6): para arreglar algo de un mes sellado hay que
 * reabrirlo, y reabrir es un acto del `OWNER` que queda registrado.
 */
export class PeriodoCerradoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(etiqueta: string) {
    super(
      `El período ${etiqueta} de esa ubicación está cerrado y no admite movimientos. ` +
        'Para modificarlo hay que reabrirlo primero.',
      { periodo: etiqueta },
    );
  }
}
