/**
 * El semáforo de un indicador por bandas — y el único sitio que lo decide.
 *
 * **VIVE EN `shared` DESDE P16-B (D-16.105).** Nació privado en
 * `analytics/domain/resumen.ts` y la pantalla de costeo tenía su propia copia
 * en el navegador, con los umbrales escritos a mano. Esa copia es INC-020: un
 * food cost del 40 % pintado de verde porque el cliente comparaba decimales
 * como texto. D-16.3 dice que el color lo decide la API, y para que lo decidan
 * igual el resumen del mes y el costeo del plato, la regla tiene que estar en un
 * sitio al que los dos lleguen sin depender el uno del otro.
 *
 * **LOS UMBRALES SON CONFIGURACIÓN POR COMPANY** (D3): llegan por parámetro.
 * `0.28` y `0.32` son las semillas del Excel, no la ley.
 *
 * **LOS BORDES SON DEL LADO BUENO.** Exactamente en el umbral verde es verde, y
 * exactamente en el máximo es ámbar: «máximo aceptable» incluye al máximo. Es lo
 * que `resumen.ts` hacía desde P8 y lo que la pantalla replicaba en el navegador
 * hasta P16-B; cambiarlo movería el color de platos que hoy están en el borde.
 *
 * ES DOMINIO PURO: tres `Ratio` entran, una etiqueta sale.
 */

import type { Ratio } from '../money/tipos-monetarios';

/**
 * `SIN_DATO` no es un cuarto nivel de gravedad: es la ausencia de medición. Va
 * aparte para que ninguna interfaz pueda pintarlo como un estado del negocio —un
 * verde sobre un `null` dice «todo en orden» donde lo que pasa es que falta un
 * dato—.
 */
export type Semaforo = 'VERDE' | 'AMBAR' | 'ROJO' | 'SIN_DATO';

/**
 * Tres bandas: hasta `verde` es verde, hasta `rojo` es ámbar, por encima es rojo.
 * `valor = null` es `SIN_DATO`.
 */
export function semaforoPorBandas(entrada: {
  readonly valor: Ratio | null;
  readonly verde: Ratio;
  readonly rojo: Ratio;
}): Semaforo {
  if (entrada.valor === null) return 'SIN_DATO';
  if (entrada.valor.lessThanOrEqual(entrada.verde)) return 'VERDE';
  return entrada.valor.lessThanOrEqual(entrada.rojo) ? 'AMBAR' : 'ROJO';
}
