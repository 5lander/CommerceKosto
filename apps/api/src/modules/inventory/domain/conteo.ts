/**
 * El conteo físico — SPEC §3, §7 y D7.
 *
 * **UN CONTEO NO AJUSTA EL LIBRO, Y ESA ES LA DECISIÓN QUE LO SOSTIENE TODO.**
 * La tentación es emitir un `AJUSTE` por la diferencia para que el saldo del
 * libro coincida con lo que hay en la estantería. Hacerlo destruiría
 * exactamente la señal que el conteo existe para producir: SPEC §18 calcula
 * `diferencia = conteo_fisico − stock_teorico`, y si el ajuste ya se hubiera
 * aplicado, esa resta daría cero siempre. El libro es lo que *debería* haber;
 * el conteo es lo que *hay*; la diferencia es el hallazgo.
 *
 * **EL CONTEO PUEDE SER PARCIAL** (D7). Un ítem sin línea no vale cero: vale
 * «sin verificar», no genera diferencia, y su valor teórico se arrastra tal
 * cual al inventario final. Lo que mide la calidad del dato no es cuántos ítems
 * se contaron sino **qué porcentaje del valor** se verificó, y eso es la
 * cobertura de `conciliacion.ts`.
 *
 * **SE CUENTA A CIEGAS.** La hoja de conteo no lleva el stock teórico —ni
 * ningún derivado suyo— porque quien conoce el número esperado tiende a ajustar
 * el conteo hacia él. Es CLAUDE.md §4.3 y es, además, la práctica correcta de
 * control interno: la restricción de confidencialidad mejora el dato.
 */

import type { ItemId } from '../../../shared/domain/identity/identificadores';
import type { Quantity } from '../../../shared/domain/money/tipos-monetarios';
import {
  CantidadDeConteoNegativaError,
  ConteoYaConfirmadoError,
  ItemRepetidoEnConteoError,
} from './errores';

export type EstadoDeConteo = 'BORRADOR' | 'CONFIRMADO';

export const BORRADOR: EstadoDeConteo = 'BORRADOR';
export const CONFIRMADO: EstadoDeConteo = 'CONFIRMADO';

export interface LineaDeConteo {
  readonly itemId: ItemId;
  /** Lo que se contó. **Cero es un dato**: significa «miré y no había». */
  readonly cantidad: Quantity;
}

/**
 * Las líneas que se van a guardar, comprobadas.
 *
 * @throws {ItemRepetidoEnConteoError} @throws {CantidadDeConteoNegativaError}
 */
export function exigirLineasValidas(lineas: readonly LineaDeConteo[]): readonly LineaDeConteo[] {
  const vistos = new Set<ItemId>();

  for (const linea of lineas) {
    if (vistos.has(linea.itemId)) {
      throw new ItemRepetidoEnConteoError();
    }
    // Un conteo negativo no es un hallazgo: es un error de captura. Lo que sí
    // puede ser negativo es el stock teórico, y ahí el dato es interesante.
    if (linea.cantidad.isNegative()) {
      throw new CantidadDeConteoNegativaError();
    }
    vistos.add(linea.itemId);
  }

  return lineas;
}

/**
 * Un conteo confirmado ya no se toca.
 *
 * Confirmar congela el stock teórico y el costo de cada línea, que es lo que
 * hace que la diferencia siga significando lo mismo dentro de un año. Editarlo
 * después movería un número que ya se informó.
 *
 * @throws {ConteoYaConfirmadoError}
 */
export function exigirBorrador(estado: EstadoDeConteo): void {
  if (estado !== BORRADOR) {
    throw new ConteoYaConfirmadoError();
  }
}
