/**
 * Una tarifa de IVA es una FRACCIÓN: `0.15`, no `15`.
 *
 * Es la guarda de dominio de los `CHECK` `purchase_article_iva_tarifa_es_fraccion`
 * e `item_group_iva_tarifa_es_fraccion` (INC-012: la base garantiza, el dominio
 * explica). Un 15 escrito donde va 0.15 dividiría el bruto entre 16 y el costo
 * del plato saldría a un dieciseisavo, plausible en pantalla y ruinoso.
 *
 * El esquema del endpoint ya rechaza la forma en el campo; esto rechaza el
 * contenido, y es lo que protege al importador y a cualquier llamante que no
 * pase por HTTP. Dos cerraduras, ninguna en un refinamiento de objeto (INC-008).
 *
 * **LA REGLA EXISTE EN DOS FORMAS Y UNA SOLA VEZ.** `motivoDeTarifaInvalida`
 * la devuelve como MOTIVO, que es lo que un lote necesita para recoger todos
 * los problemas con su fila en vez de parar en el primero (D-16.44: «se rechaza
 * en el análisis con su número»). `exigirTarifaValida` la lanza, y es la guarda
 * de última línea de los casos de uso que ya validaron antes. Las dos leen la
 * misma comprobación: la primera versión tenía tres —una por módulo— y solo
 * una ponía el techo de 1.
 *
 * ES DOMINIO PURO.
 */

import { Ratio } from '../money/tipos-monetarios';
import { TarifaDeIvaInvalidaError } from './errores';

/** Decimal sin signo: la FORMA de una tarifa, antes de mirar su contenido. */
const DECIMAL = /^\d+(?:\.\d+)?$/u;

/** `null` cuando la tarifa es una fracción válida; si no, el motivo, listo para una fila. */
export function motivoDeTarifaInvalida(tarifa: string): string | null {
  if (!DECIMAL.test(tarifa)) return `La tarifa de IVA «${tarifa}» no es un número.`;
  if (Ratio.fromDecimalString(tarifa).greaterThan(Ratio.UNO)) {
    return `La tarifa de IVA «${tarifa}» no es una fracción: un IVA se escribe 0.15, no 15.`;
  }
  return null;
}

/** @throws {TarifaDeIvaInvalidaError} */
export function exigirTarifaValida(tarifa: string): Ratio {
  if (motivoDeTarifaInvalida(tarifa) !== null) throw new TarifaDeIvaInvalidaError(tarifa);
  return Ratio.fromDecimalString(tarifa);
}
