/**
 * LA RED DE LOS LOTES: un choque de nombres que se le escapa al pre-chequeo
 * deja de ser un **500**.
 *
 * Los lotes miran antes qué nombres ya existen, y eso cubre el caso normal.
 * Lo que no cubre es la CARRERA: entre esa lectura y el `createMany` cabe otra
 * transacción escribiendo el mismo nombre. El índice único la para —esa es la
 * garantía—, pero el `P2002` que devuelve solo nombra la restricción, y quien
 * migra doscientas filas necesita la lista, no el código del driver. Es la
 * tercera cara de **INC-012**: la base garantiza, el dominio explica.
 *
 * **EL RESCATE RELEE FUERA, EN UNA TRANSACCIÓN NUEVA**, y no puede ser de otra
 * forma: en PostgreSQL un error aborta la transacción y ninguna consulta más
 * corre dentro de ella. Por eso lo que se envuelve es la llamada entera y no el
 * `createMany`, y por eso `releer` es un callback y no un cliente: quien lo
 * pasa es el único que sabe abrir la transacción nueva.
 *
 * **VIVE FUERA DEL REPOSITORIO A PROPÓSITO.** Tiene tres ramas —el error que no
 * es de duplicado, el choque encontrado y la relectura vacía— y ninguna se
 * puede provocar a voluntad contra PostgreSQL: la carrera es, por definición,
 * lo que no ocurre cuando uno mira. Aquí, sin Prisma delante, las tres se
 * prueban con la base apagada (`rescate-de-choque.spec.ts`).
 *
 * NO IMPORTA NADA DE PRISMA: reconoce el código de error por su forma, que es
 * lo único que necesita saber de él.
 */

import { nombresQueChocan } from '../../domain/lote/problemas';

/** Violación de restricción única en Prisma. */
const CODIGO_DE_DUPLICADO = 'P2002';

/**
 * Si el error es una violación de restricción única.
 *
 * Se mira la FORMA del objeto y no su clase: importar el error de Prisma aquí
 * metería el cliente generado en un archivo que no lo necesita, y la regla
 * `prisma-client-solo-en-persistence` existe para que eso se piense dos veces.
 */
export function esViolacionDeUnico(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === CODIGO_DE_DUPLICADO
  );
}

/**
 * Escribe el lote y, si el índice único lo para, dice QUÉ nombres sobran.
 *
 * Las tres ramas, en orden de aparición:
 *
 *   1. el error no es de duplicado → **se relanza tal cual**. No es asunto de
 *      esta función y taparlo convertiría un fallo real en un 409 mentiroso;
 *   2. la relectura encuentra los que chocan → `alChocar` con la lista;
 *   3. **la relectura no encuentra ninguno → se relanza el error ORIGINAL.**
 *      Ese `P2002` no era de estos nombres —otro índice, otra columna— y un
 *      «estos ya existen: » con la lista vacía manda a buscar donde no hay
 *      nada, que es peor que el 500 honesto.
 *
 * Los nombres se comparan con `nombresQueChocan`, es decir **sin distinguir
 * mayúsculas ni espacios de sobra**: es más estricto que el índice único de la
 * base, a propósito y como en el resto de los lotes (ver `clavePorNombre`).
 */
export async function aPruebaDeChoques<T>(lote: {
  /** Los nombres que el lote intenta escribir. */
  readonly entrantes: readonly string[];
  readonly escribir: () => Promise<T>;
  /** Los nombres que la company YA tiene, releídos en una transacción nueva. */
  readonly releer: () => Promise<readonly string[]>;
  readonly alChocar: (nombres: readonly string[]) => T;
}): Promise<T> {
  try {
    return await lote.escribir();
  } catch (error) {
    if (!esViolacionDeUnico(error)) throw error;

    const chocan = nombresQueChocan(lote.entrantes, await lote.releer());
    if (chocan.length === 0) throw error;

    return lote.alChocar(chocan);
  }
}
