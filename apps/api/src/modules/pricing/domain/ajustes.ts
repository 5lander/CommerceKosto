/**
 * Qué parámetros de costeo son válidos — SPEC §11, D3.
 *
 * ES DOMINIO PURO y es redundante con los `CHECK` de la migración, por la misma
 * razón de siempre: la base garantiza, esto explica. Un `23514` del driver no
 * le dice a nadie que puso el IVA en 15 en vez de 0.15.
 *
 * **LOS UMBRALES TIENEN QUE ESTAR ORDENADOS** —objetivo ≤ verde ≤ máximo— o el
 * semáforo de food cost no puede pintar los tres colores. Es la clase de regla
 * que nadie viola a propósito y que alguien rompe cambiando un número suelto.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';

export interface AjustesCapturados {
  readonly ivaVenta: string;
  readonly ivaCompra: string;
  readonly ivaCompraRecuperable: boolean;
  readonly provisionMerma: string;
  readonly foodCostObjetivo: string;
  readonly foodCostMaximo: string;
  readonly foodCostUmbralVerde: string;
  readonly primeCostMaximo: string;
  readonly reglaPopularidad: string;
  readonly diasOperativosMes: number;
  readonly diasCobertura: number;
}

const DIAS_MAXIMOS_DEL_MES = 31;

/** Los ocho valores que son fracciones entre 0 y 1. */
const FRACCIONES = [
  'ivaVenta',
  'ivaCompra',
  'provisionMerma',
  'foodCostObjetivo',
  'foodCostMaximo',
  'foodCostUmbralVerde',
  'primeCostMaximo',
  'reglaPopularidad',
] as const;

export function problemaDeAjustes(ajustes: AjustesCapturados): string | null {
  for (const campo of FRACCIONES) {
    const valor = Ratio.fromDecimalString(ajustes[campo]);
    if (valor.isNegative() || valor.greaterThan(Ratio.UNO)) {
      return `"${campo}" es una fracción: va entre 0 y 1. Un IVA se escribe 0.15, no 15.`;
    }
  }

  const objetivo = Ratio.fromDecimalString(ajustes.foodCostObjetivo);
  const verde = Ratio.fromDecimalString(ajustes.foodCostUmbralVerde);
  const maximo = Ratio.fromDecimalString(ajustes.foodCostMaximo);

  if (objetivo.greaterThan(verde) || verde.greaterThan(maximo)) {
    return 'Los umbrales de food cost van en orden: objetivo ≤ umbral verde ≤ máximo aceptable. Si no, el semáforo no puede pintar los tres colores.';
  }

  if (ajustes.diasOperativosMes < 1 || ajustes.diasOperativosMes > DIAS_MAXIMOS_DEL_MES) {
    return `Los días operativos del mes van entre 1 y ${String(DIAS_MAXIMOS_DEL_MES)}.`;
  }

  if (ajustes.diasCobertura < 1) {
    return 'Los días de cobertura objetivo tienen que ser al menos 1: definen el punto de reorden.';
  }

  return null;
}
