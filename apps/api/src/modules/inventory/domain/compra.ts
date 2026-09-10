/**
 * El desglose de IVA de una COMPRA — D-16.9, D-16.10.
 *
 * El bodeguero teclea EL TOTAL DE LA FACTURA, con IVA. Lo que el libro guarda
 * como `total_cost` es el NETO, que es el número con el que se costea el mes
 * (SPEC §16), y al lado los tres datos que permiten reconstruirlo dentro de un
 * año: el bruto, la tarifa que aplicó y si el IVA se recuperaba ENTONCES.
 *
 * **LA FÓRMULA NO ESTÁ AQUÍ.** Está en `shared/domain/iva/neteo.ts`, que es
 * la misma que usa `pricing` para el precio de referencia (D-16.40). Aquí solo
 * se empaqueta el resultado en la forma que el puerto del libro persiste.
 *
 * **ES LA ÚNICA FORMA DE CONSTRUIR UN `DesgloseDeCompra`**, y por eso el
 * `CHECK inventory_movement_desglose_coherente` es ⚪ en
 * `docs/sistema/guardas-de-dominio.md`: los cuatro campos nacen juntos o no
 * nacen. La corrección de una compra copia el desglose del original entero.
 *
 * ES DOMINIO PURO.
 */

import type { MovementId } from '../../../shared/domain/identity/identificadores';
import { netear } from '../../../shared/domain/iva/neteo';
import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { CompraConImporteInvalidoError, CompraSinDesgloseError } from './errores';
import type { TipoDeMovimiento } from './movimiento';

const TIPO_COMPRA = 'COMPRA';

/** Lo que se guarda junto al neto para poder explicarlo después (D-16.42). */
export interface DesgloseDeCompra {
  /** El total de la factura, con IVA. Magnitud sin signo. */
  readonly totalBruto: string;
  /** Fracción: la tarifa con la que se neteó. */
  readonly ivaTarifaAplicada: string;
  /** El ajuste de la company EN EL MOMENTO de la compra. */
  readonly ivaRecuperableAplicado: boolean;
}

export interface CompraDesglosada {
  /** El NETO, a la escala de almacenamiento: es lo que va en `total_cost`. */
  readonly costoTotal: string;
  readonly desglose: DesgloseDeCompra;
}

/**
 * @throws {CompraConImporteInvalidoError} un bruto negativo no es una factura
 */
export function desglosarCompra(entrada: {
  readonly bruto: string;
  readonly tarifa: Ratio;
  readonly recuperable: boolean;
}): CompraDesglosada {
  const bruto = Money.fromDecimalString(entrada.bruto);
  if (bruto.isNegative()) throw new CompraConImporteInvalidoError(entrada.bruto);

  const neto = netear({ bruto, tarifa: entrada.tarifa, recuperable: entrada.recuperable });

  return {
    costoTotal: neto.toStorageString(),
    desglose: {
      totalBruto: bruto.toStorageString(),
      ivaTarifaAplicada: entrada.tarifa.toStorageString(),
      ivaRecuperableAplicado: entrada.recuperable,
    },
  };
}

/** Lo que la guarda necesita saber de una fila que va a entrar al libro. */
export interface FilaDelLibroPorEscribir {
  readonly tipo: TipoDeMovimiento;
  readonly desglose: DesgloseDeCompra | null;
  readonly reversesMovementId: MovementId | null;
}

/**
 * TODA COMPRA NUEVA NACE CON DESGLOSE (D-16.25), y lo garantiza la aplicación,
 * no la base: `desglose_conocido = false` con los tres campos `NULL` es el
 * estado legítimo de las compras anteriores a P16-A1, y un `CHECK` no puede
 * distinguir una fila vieja de una nueva que llegue mal. Por eso esta guarda
 * está en la puerta del repositorio, por donde pasa toda escritura del libro
 * que no sea SQL a mano: la ruta de mañana que construya una compra sin
 * `desglosarCompra` (§23 HACCP, back office) se para aquí, no en
 * `compras_del_mes` seis meses después.
 *
 * La única COMPRA sin desglose que se admite es la CORRECCIÓN de una anterior a
 * P16-A1: copia lo que el original tiene (D-16.41), y el original no tiene nada.
 *
 * @throws {CompraSinDesgloseError}
 */
export function exigirDesgloseEnCompra(fila: FilaDelLibroPorEscribir): void {
  if (fila.tipo !== TIPO_COMPRA || fila.desglose !== null || fila.reversesMovementId !== null) {
    return;
  }
  throw new CompraSinDesgloseError();
}
