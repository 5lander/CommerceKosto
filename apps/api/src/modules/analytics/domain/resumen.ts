/**
 * El resumen gerencial: los seis números que se miran primero.
 *
 * **NO ES UNA VISTA NUEVA, ES UNA LECTURA DE LAS OTRAS.** No calcula ningún
 * indicador que no exista ya en `food-cost-real.ts`, `punto-de-equilibrio.ts`
 * o `inventario-valorizado.ts`: los recibe y les pone un semáforo. Recalcular
 * aquí un food cost sería abrir un segundo sitio donde el mismo número puede
 * salir distinto, que es el fallo que este proyecto persigue en todas partes.
 *
 * **LOS UMBRALES SON CONFIGURACIÓN POR COMPANY** (D3), no constantes. Llegan
 * por parámetro: `umbral_verde` 0.28, `food_cost_maximo` 0.32, `prime_cost
 * maximo` 0.65 son las semillas del Excel, no la ley.
 *
 * **UN INDICADOR SIN DATO SE DICE, NO SE PINTA DE VERDE.** `SIN_DATO` existe
 * porque un mes sin ventas produce un food cost `null`, y un semáforo verde
 * sobre un `null` es la peor lectura posible: dice «todo en orden» donde lo
 * que pasa es que nadie ha cargado las ventas.
 */

import { semaforoPorBandas, type Semaforo } from '../../../shared/domain/indicadores/semaforo';
import type { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

// El tipo y las bandas viven en `shared/domain/indicadores/semaforo.ts` desde
// P16-B: el costeo del plato los necesita igual que el resumen (D-16.105).
export type { Semaforo };

export interface UmbralesDelResumen {
  /** Por debajo de esto, verde. D3: `0.28`. */
  readonly umbralVerde: Ratio;
  /** Por encima de esto, rojo. D3: `0.32`. */
  readonly foodCostMaximo: Ratio;
  /** Por encima de esto, rojo. D3: `0.65`. */
  readonly primeCostMaximo: Ratio;
  /** Varianza relativa que SPEC §16 marca como problema de proceso: `0.05`. */
  readonly varianzaMaxima: Ratio;
}

export interface EntradaDelResumen {
  readonly ventaNetaMes: Money;
  readonly foodCostTeoricoPct: Ratio | null;
  readonly foodCostRealPct: Ratio | null;
  readonly brechaEnPuntos: Ratio | null;
  readonly varianzaUsd: Money;
  readonly varianzaPct: Ratio | null;
  readonly utilidadOperativa: Money;
  readonly primeCostPct: Ratio | null;
  readonly margenDeSeguridad: Ratio | null;
  /** Del conteo físico del período (D7). `null` si no hubo conteo. */
  readonly coberturaDelConteo: Ratio | null;
  readonly itemsPorReponer: number;
  readonly itemsSinCosto: number;
}

/**
 * El resumen es la entrada **mas** sus semaforos.
 *
 * `extends` y no una copia de los campos: con la copia, anadir un indicador
 * obligaba a tocar dos listas, y `audit:duplication` lo detecto como clon.
 */
export interface Resumen extends EntradaDelResumen {
  readonly semaforoFoodCost: Semaforo;
  readonly semaforoVarianza: Semaforo;
  readonly semaforoPrimeCost: Semaforo;
  readonly semaforoUtilidad: Semaforo;
}

export function resumir(entrada: {
  readonly datos: EntradaDelResumen;
  readonly umbrales: UmbralesDelResumen;
}): Resumen {
  const { datos, umbrales } = entrada;

  return {
    ...datos,
    semaforoFoodCost: semaforoPorBandas({
      valor: datos.foodCostRealPct,
      verde: umbrales.umbralVerde,
      rojo: umbrales.foodCostMaximo,
    }),
    // La varianza se mira en VALOR ABSOLUTO: consumir un 8 % menos de lo
    // teórico es tan sospechoso como un 8 % más. Significa que la receta, el
    // conteo o las unidades vendidas están mal, y ninguna de las tres es una
    // buena noticia.
    semaforoVarianza: sobreUmbral(datos.varianzaPct?.abs() ?? null, umbrales.varianzaMaxima),
    semaforoPrimeCost: sobreUmbral(datos.primeCostPct, umbrales.primeCostMaximo),
    semaforoUtilidad: porSigno(datos.utilidadOperativa),
  };
}

/** Dos bandas: dentro del umbral o fuera. No hay ámbar donde no hay margen. */
function sobreUmbral(valor: Ratio | null, maximo: Ratio): Semaforo {
  if (valor === null) return 'SIN_DATO';
  return valor.lessThanOrEqual(maximo) ? 'VERDE' : 'ROJO';
}

/**
 * La utilidad operativa no tiene bandas: o el mes dio dinero o no lo dio.
 * Cero exacto es ámbar —se cubrieron los costos y nada más—, que es
 * información distinta de ganar y de perder.
 */
function porSigno(utilidad: Money): Semaforo {
  if (utilidad.isPositive()) return 'VERDE';
  return utilidad.isZero() ? 'AMBAR' : 'ROJO';
}
