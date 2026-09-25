/**
 * La escritura condicionada a la versión, y la relectura que distingue por qué
 * no escribió — D-16.100, ADR-023.
 *
 * ============================================================================
 * LA CONDICIÓN VA EN EL `WHERE`, NO EN UN `if` PREVIO
 * ============================================================================
 *
 * Leer la versión, compararla en JavaScript y escribir después deja una ventana
 * entre las dos sentencias: dos peticiones con la misma versión leen las dos
 * «5», las dos pasan la comparación y las dos escriben. La segunda pisa a la
 * primera, que es exactamente el cambio perdido que esto existe para impedir.
 *
 * `UPDATE … SET version = version + 1 WHERE id = … AND version = 5` no tiene
 * ventana: PostgreSQL bloquea la fila, la primera sentencia la escribe y la
 * sube a 6, y la segunda —que esperaba el bloqueo— vuelve a evaluar su `WHERE`
 * contra la fila ya escrita y afecta a CERO filas. Es el mismo razonamiento que
 * `resolver` de precios en P3 y `marcarRevertida` en P4.
 *
 * ============================================================================
 * CERO FILAS NO DICE POR QUÉ
 * ============================================================================
 *
 * Por eso, solo en ese caso, se relee: si la fila no existe (o es de otra
 * company, que bajo RLS es lo mismo) es `no_encontrado`; si existe, alguien la
 * cambió. La relectura corre en la misma transacción que la escritura fallida:
 * no hay nada que deshacer, porque no se escribió nada.
 *
 * ES INFRAESTRUCTURA Y NO DOMINIO porque es la forma de hablar con la base; la
 * regla —«la versión tiene que ser la leída»— es trivial y no necesita casa.
 */

import type { DesenlaceVersionado } from '../../application/concurrencia';

export async function escribirConVersion(entrada: {
  /** La sentencia condicionada: `updateMany` con `version: esperada` en el `where` y `version: { increment: 1 }` en `data`. */
  readonly escribir: () => Promise<{ readonly count: number }>;
  /** Solo se llama si `escribir` no afectó a ninguna fila. */
  readonly existe: () => Promise<boolean>;
  readonly esperada: number;
}): Promise<DesenlaceVersionado> {
  const { count } = await entrada.escribir();
  if (count > 0) {
    return { clase: 'escrito', version: entrada.esperada + 1 };
  }
  return (await entrada.existe()) ? { clase: 'conflicto_de_version' } : { clase: 'no_encontrado' };
}
