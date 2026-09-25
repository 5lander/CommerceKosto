/**
 * Puerto del registro de golpes al limite de tasa — D-16.50.
 *
 * UNA OPERACION Y NINGUNA MAS: anotar un golpe y, en el mismo acto, devolver
 * los anteriores de esa clave. Antes eran dos (`hitsDesde` y `registrar`) y
 * por eso el limite no limitaba: dos peticiones simultaneas de la misma clave
 * leian el mismo recuento en transacciones distintas, las dos pasaban, y las
 * dos escribian despues. Diez por hora eran diez por hora solo en serie. La
 * implementacion tiene que hacer lectura y escritura ATOMICAS POR CLAVE: dos
 * golpes simultaneos de la misma clave se ven el uno al otro.
 *
 * No hay borrado —la purga es del despachador, con su propio rol (D-16.28)—
 * ni lectura de claves: la aplicacion nunca necesita saber QUE claves existen,
 * solo cuantos golpes tiene la suya.
 *
 * `clave` es `ip:<ip>` o `correo:<sha256 del correo normalizado>` y la forma
 * la fija `LimitadorDeTasa`; el registro la guarda como texto opaco.
 */

import type { KindDeLimite } from '../../domain/limite-de-tasa/politicas';

export const REGISTRO_DE_LIMITES = 'REGISTRO_DE_LIMITES';

export interface GolpeALimitar {
  readonly kind: KindDeLimite;
  readonly clave: string;
  /** El instante del golpe que se anota. */
  readonly at: Date;
  /** Desde cuando cuentan los anteriores. */
  readonly desde: Date;
  /** Cuantos anteriores hacen falta como mucho: los mas recientes. */
  readonly maximo: number;
}

export interface RegistroDeLimites {
  /**
   * Anota el golpe y devuelve los ANTERIORES de esa clave desde `desde`, del
   * mas reciente al mas antiguo y como mucho `maximo`, sin contar el que se
   * acaba de anotar. Atomico por clave.
   */
  golpear(golpe: GolpeALimitar): Promise<readonly Date[]>;
}
