/**
 * La producción de una preparación — R10.
 *
 * ```
 * R10. El ítem PRODUCIDO se costea con su precio de referencia fijo, no con el
 *      costo del último lote. El costo real del lote se registra en el
 *      movimiento de producción y genera varianza.
 * ```
 *
 * LAS DOS MITADES DE R10, Y POR QUÉ ESTÁN SEPARADAS:
 *
 *   · El movimiento que da de alta la preparación se valora al **costo
 *     estándar**. Es lo que impide que un plato cambie de costo según cuánto se
 *     produjo ese día — que es exactamente lo que R10 prohíbe, y la razón por
 *     la que un menú no se puede repreciar cada mañana.
 *   · El **costo real del lote** —lo que de verdad costaron los insumos que
 *     entraron— se guarda aparte, y su diferencia contra el estándar es la
 *     varianza. Es la señal de que la receta o el precio estándar se quedaron
 *     viejos, y se pierde entera si se valora al costo real.
 *
 * EFECTO SECUNDARIO ELEGANTE Y BUSCADO: como el alta lleva el costo estándar y
 * los consumos llevan el real, la suma de los importes de los movimientos
 * `PRODUCCION` de un lote **es** la varianza, con signo. No hay que reconstruirla
 * desde ningún sitio: está en el libro.
 *
 * UNA PRODUCCIÓN ES UN SOLO HECHO. Un alta positiva y N consumos negativos, con
 * el mismo `production_id`. Es lo que hace seguro que `PRODUCCION` sea
 * bidireccional: el signo no protege nada aquí, lo hace la agrupación.
 */

import { Money, type Quantity } from '../../../shared/domain/money/tipos-monetarios';
import type { ItemId, LocationId } from '../../../shared/domain/identity/identificadores';
import { exigirMagnitud, type MovimientoDelLibro } from './movimiento';
import { ProduccionSinInsumosError } from './errores';

/** Un insumo que entra al lote, con lo que costaba en ese momento. */
export interface InsumoDelLote {
  readonly itemId: ItemId;
  /** Magnitud positiva: lo que se consumió. */
  readonly cantidad: Quantity;
  /** `costo_neto_uso` del insumo (SPEC §12), por unidad de uso. */
  readonly costoNetoDeUso: Money;
}

export interface DatosDeProduccion {
  readonly locationId: LocationId;
  /** El ítem PRODUCIDO que se da de alta. */
  readonly itemId: ItemId;
  readonly cantidadProducida: Quantity;
  /** R10: el precio de referencia confirmado de la preparación, por unidad de uso. */
  readonly costoEstandarDeUso: Money;
  readonly insumos: readonly InsumoDelLote[];
  readonly ocurridoEn: Date;
}

/** Un movimiento con el importe que le corresponde. */
export interface MovimientoValorizado {
  readonly movimiento: MovimientoDelLibro;
  /** Magnitud en dinero, sin signo: el sentido lo lleva la cantidad. */
  readonly costoTotal: Money;
}

export interface LoteProducido {
  /** El alta primero, los consumos después. */
  readonly movimientos: readonly MovimientoValorizado[];
  readonly costoEstandarDelLote: Money;
  readonly costoRealDelLote: Money;
  /** `real − estándar`. Positiva = el lote salió más caro de lo previsto. */
  readonly varianza: Money;
}

function costoDelInsumo(insumo: InsumoDelLote): Money {
  return insumo.costoNetoDeUso.times(insumo.cantidad.magnitude());
}

function consumoDelInsumo(datos: DatosDeProduccion, insumo: InsumoDelLote): MovimientoValorizado {
  return {
    movimiento: {
      locationId: datos.locationId,
      itemId: insumo.itemId,
      tipo: 'PRODUCCION',
      // Negativo: el insumo SALE. Es el mismo tipo que el alta porque es el
      // mismo hecho; lo que los distingue es el signo y el ítem.
      cantidad: insumo.cantidad.negated(),
      ocurridoEn: datos.ocurridoEn,
    },
    costoTotal: costoDelInsumo(insumo),
  };
}

/**
 * @throws {ProduccionSinInsumosError} sin insumos no hay costo real que comparar
 * @throws {CantidadNulaError} @throws {SignoIncoherenteError}
 */
export function producirLote(datos: DatosDeProduccion): LoteProducido {
  if (datos.insumos.length === 0) throw new ProduccionSinInsumosError();

  const cantidad = exigirMagnitud(datos.cantidadProducida, 'PRODUCCION');
  const costoEstandarDelLote = datos.costoEstandarDeUso.times(cantidad.magnitude());
  const costoRealDelLote = Money.sum(datos.insumos.map(costoDelInsumo));

  const alta: MovimientoValorizado = {
    movimiento: {
      locationId: datos.locationId,
      itemId: datos.itemId,
      tipo: 'PRODUCCION',
      cantidad,
      ocurridoEn: datos.ocurridoEn,
    },
    // R10, la mitad que se ve en el saldo: al ESTÁNDAR, nunca al real.
    costoTotal: costoEstandarDelLote,
  };

  return {
    movimientos: [alta, ...datos.insumos.map((insumo) => consumoDelInsumo(datos, insumo))],
    costoEstandarDelLote,
    costoRealDelLote,
    varianza: costoRealDelLote.minus(costoEstandarDelLote),
  };
}
