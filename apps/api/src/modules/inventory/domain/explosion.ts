/**
 * El interruptor de stock por preparación — SPEC §5, entregable de P6.
 *
 * ```
 * llevaStock = true   la preparación se produce en lote y ESTÁ en el
 *                     inventario. Vender el plato consume la preparación.
 * llevaStock = false  la preparación no pasa por inventario. Vender el plato
 *                     EXPLOTA su receta y consume los insumos de abajo.
 * ```
 *
 * LA EXPLOSIÓN PARA EN CUANTO ENCUENTRA ALGO CON STOCK PROPIO, y ese es todo el
 * contenido del interruptor. Una salsa madre que se produce los lunes y se
 * cuenta en la bodega es un ítem del inventario: descender por su receta al
 * vender un plato descontaría dos veces lo mismo, una al producirla y otra al
 * venderla. Una salsa que se hace al momento no está en ninguna estantería:
 * consumirla es consumir su cebolla y su aceite.
 *
 * LA CANTIDAD CONSUMIDA ES LA DE LA RECETA POR LAS UNIDADES VENDIDAS, sin
 * corregir por rendimiento. No es un olvido: el SPEC lo fija explícitamente al
 * explicar por qué el consumo teórico es confidencial (§4.3) —«`consumo ÷
 * unidades vendidas` = cantidad de la receta»—, y esa identidad solo se cumple
 * si no hay ningún factor por medio. El rendimiento vive en el COSTO (§12), no
 * en la cantidad física. **Queda anotado como duda para el usuario**: afecta al
 * stock teórico de P8, y merece confirmarse contra el Excel.
 *
 * ES DOMINIO PURO: recibe el grafo entero y devuelve cantidades. No consulta
 * nada, igual que la cascada de costos de P5 — y por la misma razón, que es
 * poder probarlo con la base apagada.
 */

import { Ratio } from '../../../shared/domain/money/tipos-monetarios';
import type { ItemId } from '../../../shared/domain/identity/identificadores';
import { CicloEnConsumoError } from './errores';

/** Una línea de receta reducida a lo que el consumo necesita saber. */
export interface LineaDeConsumo {
  readonly itemId: ItemId;
  /** En la unidad de uso del ítem, por UNA unidad del destino. */
  readonly cantidad: Ratio;
}

/**
 * Lo que hay que saber de un ítem para decidir si se explota o se consume.
 *
 * `receta` nula significa que no hay por dónde bajar: es una hoja, se consuma
 * como se consuma. Es el caso de todo ítem `COMPRADO`.
 */
export interface ItemConsumible {
  readonly llevaStock: boolean;
  readonly receta: readonly LineaDeConsumo[] | null;
}

export type CatalogoDeConsumo = ReadonlyMap<ItemId, ItemConsumible>;

/** Cuánto se consume de cada ítem, en su unidad de uso. */
export type ConsumoPorItem = ReadonlyMap<ItemId, Ratio>;

interface Estado {
  readonly catalogo: CatalogoDeConsumo;
  readonly consumo: Map<ItemId, Ratio>;
  /** El camino en curso, para cortar un ciclo que se coló pese a R9. */
  readonly camino: Set<ItemId>;
}

function acumular(estado: Estado, itemId: ItemId, cantidad: Ratio): void {
  const previo = estado.consumo.get(itemId);
  estado.consumo.set(itemId, previo === undefined ? cantidad : previo.plus(cantidad));
}

/**
 * ¿Hay que bajar por este ítem, o se consume tal cual?
 *
 * Se baja solo si tiene receta Y no lleva stock propio. Cualquiera de las dos
 * cosas que falte lo convierte en hoja.
 */
function subrecetaDe(estado: Estado, itemId: ItemId): readonly LineaDeConsumo[] | null {
  const item = estado.catalogo.get(itemId);
  if (item === undefined || item.llevaStock || item.receta === null) return null;
  return item.receta;
}

function descender(estado: Estado, lineas: readonly LineaDeConsumo[], multiplicador: Ratio): void {
  for (const linea of lineas) {
    const cantidad = multiplicador.times(linea.cantidad);
    const subreceta = subrecetaDe(estado, linea.itemId);

    if (subreceta === null) {
      acumular(estado, linea.itemId, cantidad);
      continue;
    }

    // R9 rechaza los ciclos AL GUARDAR, así que llegar aquí significa que algo
    // entró por otra vía. Se corta con error en vez de desbordar la pila: un
    // `RangeError` no dice qué receta mirar.
    if (estado.camino.has(linea.itemId)) throw new CicloEnConsumoError(linea.itemId);

    estado.camino.add(linea.itemId);
    descender(estado, subreceta, cantidad);
    estado.camino.delete(linea.itemId);
  }
}

/**
 * Explota la receta de un producto vendido en consumo de ítems.
 *
 * @throws {CicloEnConsumoError} si el grafo tiene un ciclo pese a R9.
 */
export function explotarConsumo(entrada: {
  readonly receta: readonly LineaDeConsumo[];
  readonly unidadesVendidas: Ratio;
  readonly catalogo: CatalogoDeConsumo;
}): ConsumoPorItem {
  const estado: Estado = {
    catalogo: entrada.catalogo,
    consumo: new Map<ItemId, Ratio>(),
    camino: new Set<ItemId>(),
  };

  descender(estado, entrada.receta, entrada.unidadesVendidas);
  return estado.consumo;
}
