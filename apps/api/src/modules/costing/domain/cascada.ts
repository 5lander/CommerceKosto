/**
 * La cascada de costo de las subpreparaciones — R10, SPEC §5 y §6.
 *
 * **QUÉ PROBLEMA RESUELVE.** El LEEME del Excel declara su propia deuda: las 24
 * filas `SUB` *«tienen costo escrito a mano y no se recalculan si sube un
 * insumo. Cada una debería tener su propia receta.»* La cascada es eso: un ítem
 * `PRODUCIDO` con receta propia cuesta lo que cuestan sus líneas, y cuando el
 * queso sube, el plato que lleva la salsa sube con él.
 *
 * **LA PRECEDENCIA: SI HAY RECETA, MANDA LA RECETA.** El precio de referencia
 * de un ítem `PRODUCIDO` es su costo estándar (SPEC §6, R10) y sigue siendo el
 * costo de una preparación que todavía no tiene receta capturada —que es
 * exactamente cómo llegan las 24 filas `SUB` al migrar el Excel. En cuanto
 * alguien escribe la receta, el número deja de estar escrito a mano. El
 * razonamiento completo, con lo que la decisión cuesta, está en **ADR-008**.
 *
 * **R10 SIGUE ENTERA.** Lo que R10 prohíbe es costear la preparación con el
 * costo del ÚLTIMO LOTE producido —«que el plato no cambie de costo según
 * cuánto se produjo ese día»—. La cascada no usa lotes: usa precios de
 * referencia confirmados, que es un costo estándar por construcción. El costo
 * real de cada lote vive en el movimiento de producción (P6) y su diferencia es
 * varianza, no costo del plato.
 *
 * **LA RECETA DE UNA SUBPREPARACIÓN SE EXPRESA POR UNIDAD DE USO**, no por
 * lote. `item` no tiene columna de rendimiento por lote y P5 no se la inventa:
 * el rendimiento por lote es de P6, donde existe el movimiento de producción
 * que lo hace significar algo. Queda anotado como pregunta abierta.
 *
 * **EL RECORRIDO ESTÁ MEMORIZADO Y NO SE CUELGA.** R9 impide los ciclos al
 * guardar (P4), así que en teoría aquí no puede haber ninguno. En la práctica
 * una carga inicial o una migración de datos podría traer uno, y colgarse no es
 * una forma aceptable de descubrirlo.
 *
 * ES DOMINIO PURO: entra un catálogo en memoria, salen costos.
 */

import {
  ErrorDeDominio,
  type CodigoDeDominio,
} from '../../../shared/domain/errors/error-de-dominio';
import type { ItemId } from '../../../shared/domain/identity/identificadores';
import { Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';
import { costoDelItem } from '../../pricing/domain/cadena-de-costo';
import {
  costoDeLinea,
  type BaseDeLinea,
  type CostosDelItem,
  type EstadoDeLinea,
} from '../../recipes/domain/linea-de-receta';

export interface LineaDeSubpreparacion {
  readonly itemId: ItemId;
  readonly cantidad: Ratio;
  readonly base: BaseDeLinea;
  readonly estado: EstadoDeLinea;
}

/**
 * Un ítem tal como el motor lo necesita: o tiene costo de precio, o tiene
 * receta, o ninguna de las dos y entonces cuesta cero y se avisa.
 */
export interface ItemCosteable {
  /** Rendimiento del ítem (SPEC §12). Entre 0 y 1. */
  readonly rendimiento: Ratio;
  /** Lo que produce la cadena de SPEC §12 desde su precio vigente. */
  readonly costosDePrecio: CostosDelItem | null;
  /** Su receta vigente, por unidad de uso. `null` si no tiene ninguna. */
  readonly receta: readonly LineaDeSubpreparacion[] | null;
}

export type CatalogoCosteable = ReadonlyMap<ItemId, ItemCosteable>;

export interface CostosResueltos {
  readonly porItem: ReadonlyMap<ItemId, CostosDelItem>;
  /**
   * Ítems que acabaron costando cero porque no tienen ni precio confirmado ni
   * receta.
   *
   * **SE DEVUELVEN, NO SE CALLAN.** Un insumo sin precio hace el plato más
   * barato de lo que es, y ése es exactamente el fallo que no se ve en
   * pantalla: el número sale plausible. Quien pregunta por un costeo tiene
   * derecho a saber sobre cuántos huecos está construido.
   */
  readonly sinCosto: readonly ItemId[];
}

export class ItemFueraDelCatalogoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'RECURSO_NO_ENCONTRADO';

  public constructor(itemId: ItemId) {
    super(
      `Una línea de receta apunta al ítem ${itemId}, que no está en el catálogo cargado. ` +
        'Es un fallo de carga, no un dato del usuario: la clave foránea lo hace imposible en la base.',
      { itemId },
    );
  }
}

export class CicloEnCascadaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'CONFLICTO';

  public constructor(public readonly camino: readonly ItemId[]) {
    super(
      `No se puede costear: hay un ciclo entre subpreparaciones (${camino.join(' → ')}). ` +
        'R9 lo impide al guardar, así que este dato entró por otra vía.',
      { camino: camino.join(' → ') },
    );
  }
}

/**
 * Resuelve el costo por unidad de uso de TODOS los ítems del catálogo.
 *
 * Se resuelve el catálogo entero de una vez y no ítem a ítem porque costear una
 * carta de 200 productos toca los mismos insumos una y otra vez: sin memorizar,
 * la salsa de queso se recalcularía por cada plato que la lleve.
 */
export function resolverCostos(catalogo: CatalogoCosteable): CostosResueltos {
  const resueltos = new Map<ItemId, CostosDelItem>();
  const sinCosto = new Set<ItemId>();
  const estado: EstadoDeResolucion = { catalogo, resueltos, sinCosto, enCurso: [] };

  for (const itemId of catalogo.keys()) {
    resolver(itemId, estado);
  }

  return { porItem: resueltos, sinCosto: [...sinCosto] };
}

interface EstadoDeResolucion {
  readonly catalogo: CatalogoCosteable;
  readonly resueltos: Map<ItemId, CostosDelItem>;
  readonly sinCosto: Set<ItemId>;
  /** La rama en curso: lo que convierte un ciclo en un error en vez de un cuelgue. */
  readonly enCurso: ItemId[];
}

function resolver(itemId: ItemId, estado: EstadoDeResolucion): CostosDelItem {
  const yaResuelto = estado.resueltos.get(itemId);
  if (yaResuelto !== undefined) {
    return yaResuelto;
  }
  if (estado.enCurso.includes(itemId)) {
    throw new CicloEnCascadaError([...estado.enCurso, itemId]);
  }

  const item = estado.catalogo.get(itemId);
  if (item === undefined) {
    throw new ItemFueraDelCatalogoError(itemId);
  }

  estado.enCurso.push(itemId);
  const costos = costosDe(itemId, item, estado);
  estado.enCurso.pop();

  estado.resueltos.set(itemId, costos);
  return costos;
}

function costosDe(
  itemId: ItemId,
  item: ItemCosteable,
  estado: EstadoDeResolucion,
): CostosDelItem {
  // La receta se lee UNA vez. No es cosmética: leerla dos —una para preguntar
  // si existe y otra para recorrerla— duplica el trabajo por nodo, y la prueba
  // del rombo, que cuenta lecturas para demostrar la memorización, lo destapó.
  const receta = item.receta;
  if (receta !== null) {
    return desdeLaReceta({ lineas: receta, rendimiento: item.rendimiento }, estado);
  }
  if (item.costosDePrecio !== null) {
    return item.costosDePrecio;
  }

  estado.sinCosto.add(itemId);
  return SIN_COSTO;
}

const SIN_COSTO: CostosDelItem = { costoBrutoDeUso: Money.CERO, costoNetoDeUso: Money.CERO };

/**
 * El costo derivado entra por la MISMA cadena de SPEC §12 que un precio.
 *
 * No es un atajo: el costo de la receta de una preparación es, literalmente,
 * lo que a esa preparación le cuesta una unidad de uso antes de su propia
 * merma —el equivalente exacto de un precio neto con factor de conversión 1—.
 * Pasarlo por `costoDelItem` garantiza que las dos rutas, precio y receta,
 * hacen la misma aritmética; es lo que CC-005 comprueba al reproducir con la
 * cascada el `0.20` que el Excel tenía escrito a mano.
 */
function desdeLaReceta(
  preparacion: {
    readonly lineas: readonly LineaDeSubpreparacion[];
    readonly rendimiento: Ratio;
  },
  estado: EstadoDeResolucion,
): CostosDelItem {
  const derivado = Money.sum(
    preparacion.lineas.map((linea) =>
      costoDeLinea({
        cantidad: linea.cantidad,
        base: linea.base,
        estado: linea.estado,
        costos: resolver(linea.itemId, estado),
      }),
    ),
  );

  const { costoBrutoDeUso, costoNetoDeUso } = costoDelItem({
    precioDeCompra: derivado,
    ivaCompra: Ratio.CERO,
    // Un costo derivado ya viene neto de IVA: sus líneas se costearon con
    // precios que ya pasaron por la cadena. Volver a descontarlo sería
    // descontarlo dos veces.
    ivaRecuperable: false,
    factorDeConversion: Ratio.UNO,
    rendimiento: preparacion.rendimiento,
  });

  return { costoBrutoDeUso, costoNetoDeUso };
}
