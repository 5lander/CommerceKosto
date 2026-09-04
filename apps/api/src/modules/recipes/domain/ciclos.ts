/**
 * Validación de referencias circulares — R9, criterio E14.
 *
 * **SE RECHAZA AL GUARDAR, NO AL CALCULAR.** La diferencia no es de estilo: un
 * ciclo detectado al calcular es un costo que no se puede producir —recursión
 * infinita, pila desbordada, o peor, un número que sale de un corte arbitrario—
 * y ocurre en el momento en que alguien pide un reporte, lejos de quien lo
 * causó. Detectado al guardar, el mensaje llega a quien acaba de escribir la
 * línea y sabe qué quería poner.
 *
 * **EL GRAFO ES DE ÍTEMS, NO DE PRODUCTOS.** Las líneas de receta apuntan a
 * ítems sin distinguir tipo (SPEC §5), y un ítem `PRODUCIDO` tiene su propia
 * receta: ahí está la recursión. Un producto de venta no es referenciable por
 * ninguna línea, así que no puede formar parte de un ciclo — es siempre una
 * raíz.
 *
 * **EL RECORRIDO ES MEMORIZADO Y CORTA AL PRIMER CICLO.** Sin memorizar, un
 * grafo en rombo —A usa B y C, y los dos usan D— visita D dos veces, y con
 * profundidad n el coste es exponencial. Con memorización cada ítem se visita
 * una vez: el coste es lineal en aristas, que es lo que sostiene el presupuesto
 * de 150 ms de CLAUDE.md §5 para guardar una receta.
 *
 * ES DOMINIO PURO: entra un grafo, sale un camino o `null`.
 */

import {
  ErrorDeDominio,
  type CodigoDeDominio,
} from '../../../shared/domain/errors/error-de-dominio';
import type { ItemId } from '../../../shared/domain/identity/identificadores';

/**
 * El grafo de subpreparaciones: por cada ítem con receta, los ítems que su
 * receta usa. Un ítem `COMPRADO` simplemente no está en el mapa.
 */
export type GrafoDeItems = ReadonlyMap<ItemId, readonly ItemId[]>;

export interface CicloDetectado {
  /**
   * El camino que cierra el ciclo, empezando y terminando en el ítem que se
   * está guardando. Sale en el mensaje: sin él, «hay un ciclo» obliga a buscarlo
   * a mano entre docenas de subpreparaciones.
   */
  readonly camino: readonly ItemId[];
}

export interface EntradaDeValidacion {
  /** El ítem cuya receta se está guardando. */
  readonly destino: ItemId;
  /** Los ítems que la receta NUEVA referencia. Todavía no están en el grafo. */
  readonly referencias: readonly ItemId[];
  /** El grafo tal como está hoy en la base, sin la receta que se guarda. */
  readonly grafo: GrafoDeItems;
}

/**
 * @returns el ciclo, o `null` si guardar esta receta no crea ninguno.
 */
export function cicloAlGuardar(entrada: EntradaDeValidacion): CicloDetectado | null {
  const { destino, referencias, grafo } = entrada;

  // El caso directo: la receta se usa a sí misma. Se comprueba aparte porque el
  // recorrido de abajo empieza EN las referencias, no en el destino.
  if (referencias.includes(destino)) {
    return { camino: [destino, destino] };
  }

  /**
   * Ítems ya explorados que NO llevan al destino. Es la memorización: sin ella
   * un grafo en rombo visita las mismas ramas una y otra vez.
   */
  const seguros = new Set<ItemId>();

  for (const referencia of referencias) {
    const camino = buscar({ desde: referencia, destino, grafo, seguros, enCurso: [] });
    if (camino !== null) {
      return { camino: [destino, ...camino] };
    }
  }

  return null;
}

/**
 * Recorrido en profundidad que corta al primer ciclo.
 *
 * `enCurso` es la rama actual, y sirve para dos cosas: construir el camino que
 * se devuelve, y **no colgarse en un ciclo que ya existía** en el grafo y que
 * no pasa por el destino. Ese caso no debería darse —cada guardado lo
 * impide— pero un dato heredado o una carga inicial podrían traerlo, y colgarse
 * no es una forma aceptable de descubrirlo.
 */
function buscar(entrada: {
  readonly desde: ItemId;
  readonly destino: ItemId;
  readonly grafo: GrafoDeItems;
  readonly seguros: Set<ItemId>;
  readonly enCurso: readonly ItemId[];
}): readonly ItemId[] | null {
  const { desde, destino, grafo, seguros, enCurso } = entrada;

  if (desde === destino) {
    return [desde];
  }
  if (seguros.has(desde) || enCurso.includes(desde)) {
    return null;
  }

  const rama = [...enCurso, desde];

  for (const siguiente of grafo.get(desde) ?? []) {
    const camino = buscar({ desde: siguiente, destino, grafo, seguros, enCurso: rama });
    if (camino !== null) {
      return [desde, ...camino];
    }
  }

  // Solo se marca seguro lo que se exploró ENTERO sin encontrar el destino.
  seguros.add(desde);
  return null;
}

/**
 * ES UN ERROR DE DOMINIO, no un `Error` a secas, y la diferencia se vio en la
 * primera prueba de integración: como `Error` salía por el filtro como
 * `INTERNAL_ERROR` 500 — un fallo del servidor— cuando lo que hay es una receta
 * mal escrita, que es un 400 con el camino del ciclo dentro. El `Record`
 * exhaustivo de códigos hace lo suyo solo si el error entra por la puerta.
 */
export class CicloEnRecetaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(public readonly ciclo: CicloDetectado) {
    super(
      'Esa receta se referencia a sí misma: ' +
        `${ciclo.camino.join(' → ')}. Una preparación no puede llevarse a sí misma como ingrediente.`,
      { camino: ciclo.camino.join(' → ') },
    );
  }
}
