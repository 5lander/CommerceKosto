/**
 * La cadena de costo del insumo — SPEC §12, textual.
 *
 * ```
 * precio_neto      = iva_recuperable ? precio_compra / (1 + iva_compra) : precio_compra
 * costo_bruto_uso  = factor_conversion = 0 ? 0 : precio_neto / factor_conversion
 * costo_neto_uso   = rendimiento = 0 ? 0 : costo_bruto_uso / rendimiento
 * sobrecosto_merma = costo_neto_uso - costo_bruto_uso
 * ```
 *
 * ESTAS CUATRO LÍNEAS SON EL PRODUCTO. Todo lo demás —la UI, la velocidad, las
 * integraciones— está al servicio de que este número sea correcto. Por eso van
 * copiadas del SPEC y no derivadas de memoria, y por eso el módulo entero se
 * prueba con la base apagada.
 *
 * LA PRIMERA LÍNEA NO VIVE AQUÍ SINO EN `shared/domain/iva/neteo.ts` (D-16.40):
 * desde P16-A1 la necesita también el libro de inventario, que netea el total
 * de la factura que teclea el bodeguero. Una sola fórmula para los dos, o el
 * costo del plato y el food cost real dejarían de hablar del mismo número.
 *
 * **DIVIDIR POR EL RENDIMIENTO ENCARECE**, y es lo que más se lee al revés. No
 * es un descuento: es el costo de comprar producto que se pierde al limpiarlo.
 * Con rendimiento 0.8, cada gramo aprovechable cuesta lo de 1.25 gramos
 * comprados. `sobrecosto_merma` es exactamente esa diferencia, y por eso nunca
 * es negativa cuando el rendimiento está en su rango.
 *
 * LOS DOS CEROS SON GUARDAS DEL SPEC, NO DEFENSAS INVENTADAS. `factor = 0` y
 * `rendimiento = 0` devuelven cero en vez de lanzar porque significan «esto
 * todavía no se capturó», y un catálogo a medio llenar tiene que poder
 * mostrarse. Lo que **no** puede pasar es que produzcan `NaN` o `Infinity` y
 * viajen hasta un margen: `Money.dividedBy` lanza ante el cero, así que la
 * guarda tiene que estar aquí, delante.
 *
 * ES DOMINIO PURO: entran valores, salen valores. Ni base de datos ni reloj.
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import { netear } from '../../../shared/domain/iva/neteo';
import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

export interface EntradaDeCostoDeItem {
  /** El precio tal como se paga, con IVA incluido si lo lleva. */
  readonly precioDeCompra: Money;
  /** La tasa que aplicó a ESE precio. La factura la dice. */
  readonly ivaCompra: Ratio;
  /** Configuración de la company (R13). Si el IVA no se recupera, es costo. */
  readonly ivaRecuperable: boolean;
  /** Cuántas unidades de uso salen de un artículo de compra (P2). */
  readonly factorDeConversion: Ratio;
  /** Fracción aprovechable tras limpiar. Entre 0 y 1. */
  readonly rendimiento: Ratio;
}

export interface CostoDelItem {
  /** El precio sin el IVA que se recupera. */
  readonly precioNeto: Money;
  /** Lo que cuesta una unidad de uso ANTES de contar la merma. */
  readonly costoBrutoDeUso: Money;
  /** Lo que cuesta una unidad de uso APROVECHABLE. Es el que usa la receta. */
  readonly costoNetoDeUso: Money;
  /** Lo que la merma añade al costo. Nunca negativo con rendimiento ≤ 1. */
  readonly sobrecostoDeMerma: Money;
}

export function costoDelItem(entrada: EntradaDeCostoDeItem): CostoDelItem {
  const precioNeto = netear({
    bruto: entrada.precioDeCompra,
    tarifa: entrada.ivaCompra,
    recuperable: entrada.ivaRecuperable,
  });

  // El cero significa «sin capturar», no «gratis». Devolverlo es lo que permite
  // que un catálogo a medio llenar se pueda mirar sin que reviente.
  const costoBrutoDeUso = entrada.factorDeConversion.isZero()
    ? Money.CERO
    : precioNeto.dividedBy(entrada.factorDeConversion, DIVISION);

  const costoNetoDeUso = entrada.rendimiento.isZero()
    ? Money.CERO
    : costoBrutoDeUso.dividedBy(entrada.rendimiento, DIVISION);

  return {
    precioNeto,
    costoBrutoDeUso,
    costoNetoDeUso,
    sobrecostoDeMerma: costoNetoDeUso.minus(costoBrutoDeUso),
  };
}
