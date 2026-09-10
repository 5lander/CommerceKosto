/**
 * El IVA de compra de una PREPARACIÓN es cero, y no es «una tarifa más».
 *
 * **UNA PREPARACIÓN NO SE COMPRA.** Su precio de referencia es el costo
 * estándar por unidad de uso (R10), y ese costo ya es NETO: sale de sumar
 * insumos que se netearon uno a uno. `produccion.ts` lo dice al dar de alta
 * el lote —«PRODUCCION no se netea»— y el costeo tiene que decir lo mismo. Si
 * la precedencia cuerpo > artículo > grupo se aplicara también aquí, una salsa
 * en un grupo con tarifa 0.15 nacería con 0.15 y `CostosDeItems` dividiría su
 * costo estándar entre 1.15: platos subcosteados un 13 % sin que nada avise.
 * Con la company como default (antes de P16-A1) ya pasaba; con la precedencia
 * era además obligatorio. D-16.51 lo cierra.
 *
 * Por eso una preparación **ignora el artículo (no tiene) y el grupo**, y solo
 * admite del cuerpo `null` o un cero: cualquier otra cosa es un error de quien
 * captura, y se dice con su motivo en vez de aceptarse y costear mal.
 *
 * ES DOMINIO PURO.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { PreparacionConIvaError } from './errores';

/** La única tarifa con la que puede nacer el precio de una preparación. */
export const TARIFA_DE_PREPARACION = '0';

/**
 * `null` si el cuerpo no contradice la regla (no trae tarifa, o trae cero); si
 * no, el motivo, en la forma que un lote pone junto a su fila. La FORMA del
 * decimal ya la comprobó quien llama: aquí solo se mira el contenido.
 */
export function motivoDeIvaEnPreparacion(cuerpo: string | null): string | null {
  if (cuerpo === null || Ratio.fromDecimalString(cuerpo).isZero()) return null;
  return (
    'Una preparación producida no lleva IVA de compra: su precio es el costo estándar por ' +
    `unidad de uso, ya neto (R10). Omite la tarifa o manda «0»; llegó «${cuerpo}».`
  );
}

/** @throws {PreparacionConIvaError} */
export function tarifaDePreparacion(cuerpo: string | null): string {
  const motivo = motivoDeIvaEnPreparacion(cuerpo);
  if (motivo !== null) throw new PreparacionConIvaError(motivo);
  return TARIFA_DE_PREPARACION;
}
