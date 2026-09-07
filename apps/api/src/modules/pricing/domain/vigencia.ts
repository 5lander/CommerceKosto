/**
 * Qué precio estaba vigente en una fecha — R5 y criterio E8.
 *
 * DOS REGLAS, Y LAS DOS SON LA MISMA IDEA VISTA DESDE DOS LADOS:
 *
 *   1. **Solo cuenta lo CONFIRMADO.** Un precio sugerido no es vigente por
 *      mucho que su fecha haya pasado. «Ningún precio se mueve solo» (SPEC §6)
 *      no es una frase sobre la interfaz: es esta línea de código.
 *
 *   2. **Solo cuenta lo que YA empezó.** Se elige el confirmado con la vigencia
 *      más reciente que no sea posterior a la fecha preguntada. Un precio con
 *      vigencia futura existe, es visible, y no afecta a nada hasta que llega
 *      su día.
 *
 * DE AHÍ SALE E8 SIN ESCRIBIR NADA MÁS: «cambiar el precio hoy no altera el
 * costo de un mes anterior». Un precio nuevo es una fila nueva con vigencia de
 * hoy, y esta función nunca la mira cuando le preguntan por el mes pasado. La
 * alternativa —un campo `precio` que se sobrescribe— reescribiría la historia
 * de todos los costos ya calculados, en silencio y sin forma de deshacerlo.
 *
 * ES DOMINIO PURO: entra una lista y una fecha, sale una fila o `null`.
 */

export const ESTADO_CONFIRMADO = 'CONFIRMED';

export interface PrecioConVigencia {
  readonly validFrom: Date;
  readonly estado: string;
  /** Desempata dos confirmados con la misma vigencia: gana el último capturado. */
  readonly createdAt: Date;
}

/**
 * @returns el precio vigente en `fecha`, o `null` si no había ninguno
 *   confirmado todavía — que es distinto de que valga cero.
 */
export function precioVigenteA<T extends PrecioConVigencia>(
  precios: readonly T[],
  fecha: Date,
): T | null {
  const candidatos = precios.filter(
    (p) => p.estado === ESTADO_CONFIRMADO && p.validFrom.getTime() <= fecha.getTime(),
  );

  if (candidatos.length === 0) {
    return null;
  }

  return candidatos.reduce((mejor, actual) => (esMasReciente(actual, mejor) ? actual : mejor));
}

function esMasReciente(candidato: PrecioConVigencia, actual: PrecioConVigencia): boolean {
  const diferencia = candidato.validFrom.getTime() - actual.validFrom.getTime();

  // Con la misma vigencia gana el capturado después: es la corrección de quien
  // se equivocó al escribir el primero. Sin este desempate el resultado
  // dependería del orden en que la base devolviera las filas, que es la clase
  // de no-determinismo que hace que un costo cambie entre dos corridas
  // idénticas.
  return diferencia === 0 ? candidato.createdAt.getTime() > actual.createdAt.getTime() : diferencia > 0;
}

/**
 * De donde sale un precio de referencia — D8.
 *
 * **VIVE EN EL DOMINIO Y NO EN EL PUERTO**, donde estaba antes. `EXTERNO` esta
 * reservado para una fuente que D8 deja fuera de alcance y `ULTIMA_COMPRA` lo
 * pone el sistema al registrar una compra: son tres origenes de negocio, no
 * tres valores de una columna. Lo destapo `audit:arch` cuando el dominio del
 * lote tuvo que mirar hacia `application` para encontrarlo.
 */
export type OrigenDePrecio = 'MANUAL' | 'ULTIMA_COMPRA' | 'EXTERNO';
