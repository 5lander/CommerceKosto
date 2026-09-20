/**
 * El límite HTTP de `imports`. Hoy tiene una sola superficie: deshacer.
 *
 * **LA NOTA ES LO ÚNICO QUE ENTRA, Y VIAJA A CADA FILA CONTRARIA.** Es lo que
 * meses después explica por qué el libro tiene doscientas correcciones el mismo
 * día — «el archivo traía marzo con las cantidades de abril»—, que es
 * exactamente el dato que no está en ningún otro sitio.
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_NOTA = 500;

export const CUERPO_DE_ANULACION = z
  .object({ note: z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable() })
  .strict();

export type CuerpoDeAnulacion = z.infer<typeof CUERPO_DE_ANULACION>;

/**
 * Lo que devuelve anular.
 *
 * **NO LLEVA NI UN SALDO NI UNA CANTIDAD** (CLAUDE.md §4.3): `filasAnuladas`
 * cuenta movimientos, que es lo que el operador necesita para saber que se
 * deshizo lo que creía, y de ahí no se despeja ninguna receta.
 */
export interface AnulacionDto {
  readonly id: string;
  readonly estado: 'ANULADA';
  readonly filasAnuladas: number;
}
