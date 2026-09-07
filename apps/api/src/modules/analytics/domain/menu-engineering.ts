/**
 * Menu engineering Kasavana-Smith — SPEC §15, textual.
 *
 * ```
 * popularidad        = unidades_producto / total_unidades_todos
 * indice_popularidad = popularidad / (1 / n_productos_activos) / regla_popularidad
 * ```
 *
 * Con `regla_popularidad = 0.70`, el índice ya viene normalizado:
 * **`índice ≥ 1` significa popular.**
 *
 * | | MC ≥ MC promedio | MC < MC promedio |
 * |---|---|---|
 * | **índice ≥ 1** | ESTRELLA | CABALLO |
 * | **índice < 1** | ROMPECABEZAS | PERRO |
 *
 * **EL ÍNDICE SE CALCULA CON UNA SOLA DIVISIÓN, Y NO DESDE `popularidad`.** La
 * fórmula del SPEC encadena tres operaciones y cada una redondea a la escala
 * 12; escrita así, un producto que debería dar un índice de **1 exacto** da
 * `0.999999999999` y cae en el cuadrante de al lado. El criterio de aceptación
 * de este paquete es justamente ese caso, y `indiceDe` explica la
 * reordenación.
 *
 * **EL MC PROMEDIO ES PONDERADO, NO LA MEDIA SIMPLE**, y el SPEC lo dice: «el
 * MC promedio es el del total de la vista de costeo». Es
 * `Σ(mc × unidades) / Σ(unidades)`, no `Σ(mc) / n`. La diferencia no es
 * cosmética: con la media simple, un plato caro que se vende una vez al mes
 * empuja el promedio hacia arriba y convierte en «perros» a los que sostienen
 * el negocio.
 *
 * **Y SE DEVUELVEN SUS DOS OPERANDOS, NO SOLO EL RESULTADO.** El Excel del que
 * viene este modelo usa `AVERAGE`, que **es** la media simple, así que un
 * cliente que compare las dos hojas va a ver dos números distintos y va a
 * llamar. `mcTotal` y `unidadesConMargen` le permiten reproducir el de aquí sin
 * llamar a nadie: `mcTotal / unidadesConMargen = mcPromedio`, exacto. Ver
 * ADR-015.
 *
 * ES DOMINIO PURO: entran productos con sus unidades y su margen, salen
 * cuadrantes. La regla de popularidad llega por parámetro porque es
 * configuración por company (D3).
 */

import { DIVISION } from '../../../shared/domain/decimal/escalas';
import type { ProductId } from '../../../shared/domain/identity/identificadores';
import { Count, Money, Ratio } from '../../../shared/domain/money/tipos-monetarios';

/**
 * Los cuatro cuadrantes, más los dos estados que no son un cuadrante.
 *
 * `SIN_DATOS` e `INACTIVO` son parte del SPEC, no casos de borde inventados:
 * «producto inactivo → `—`; producto activo con 0 unidades → `SIN DATOS`».
 * Modelarlos como cuadrante evita que quien consuma esto tenga que mirar
 * también `activo` y `unidades` para saber si el cuadrante significa algo.
 */
export type Cuadrante = 'ESTRELLA' | 'CABALLO' | 'ROMPECABEZAS' | 'PERRO' | 'SIN_DATOS' | 'INACTIVO';

export interface ProductoParaClasificar {
  readonly productId: ProductId;
  readonly activo: boolean;
  readonly unidades: Count;
  /** `null` si el producto no tiene PVP: sin venta neta no hay margen. */
  readonly margenContribucion: Money | null;
}

export interface ProductoClasificado {
  readonly productId: ProductId;
  readonly unidades: Count;
  /** Cuota sobre el total de unidades vendidas. `null` si no se vendió nada. */
  readonly popularidad: Ratio | null;
  readonly indicePopularidad: Ratio | null;
  readonly margenContribucion: Money | null;
  readonly cuadrante: Cuadrante;
}

/**
 * Cómo se calculó el MC de referencia.
 *
 * Viaja pegado al número y no escrito en el frontend: el día que cambie el
 * método, la etiqueta cambia con él y no se queda una pantalla mintiendo.
 */
export type MetodoDeMcPromedio = 'PONDERADO_POR_UNIDADES';

export interface Menu {
  readonly productos: readonly ProductoClasificado[];
  /** Ponderado por unidades. `null` si no se vendió nada. */
  readonly mcPromedio: Money | null;
  /** El numerador: `Σ(mc × unidades)`. `null` cuando no hay promedio. */
  readonly mcTotal: Money | null;
  /**
   * El denominador REAL del promedio, que **no es `unidadesTotales`**.
   *
   * Un producto sin PVP no entra ni en el numerador ni en el denominador —no
   * tiene margen que promediar—, así que dividir el total entre las unidades
   * totales NO reproduce `mcPromedio` cuando hay algún producto sin precio. Es
   * exactamente la clase de diferencia que hace que un cliente crea que el
   * número está mal.
   */
  readonly unidadesConMargen: Count;
  readonly metodoMcPromedio: MetodoDeMcPromedio;
  readonly unidadesTotales: Count;
  readonly productosActivos: number;
}

const METODO: MetodoDeMcPromedio = 'PONDERADO_POR_UNIDADES';

export function clasificarMenu(entrada: {
  readonly productos: readonly ProductoParaClasificar[];
  readonly reglaPopularidad: Ratio;
}): Menu {
  // El universo son los ACTIVOS: la popularidad de un plato se mide contra lo
  // que hoy está en la carta, no contra lo que se vendió el año pasado. Un
  // producto retirado con ventas históricas inflaría el total y haría parecer
  // impopulares a todos los demás.
  return construir({ ...entrada, activos: entrada.productos.filter((p) => p.activo) });
}

interface Contexto {
  readonly productos: readonly ProductoParaClasificar[];
  readonly reglaPopularidad: Ratio;
  readonly activos: readonly ProductoParaClasificar[];
}

function construir(contexto: Contexto): Menu {
  const unidadesTotales = sumarUnidades(contexto.activos);
  const referencia = mcDeReferencia(contexto.activos);

  return {
    productos: contexto.productos.map((producto) =>
      clasificarUno({ producto, contexto, unidadesTotales, mcPromedio: referencia.promedio }),
    ),
    mcPromedio: referencia.promedio,
    mcTotal: referencia.total,
    unidadesConMargen: referencia.unidades,
    metodoMcPromedio: METODO,
    unidadesTotales,
    productosActivos: contexto.activos.length,
  };
}

function sumarUnidades(productos: readonly ProductoParaClasificar[]): Count {
  return productos.reduce((total, producto) => total.plus(producto.unidades), Count.CERO);
}

interface McDeReferencia {
  readonly promedio: Money | null;
  readonly total: Money | null;
  readonly unidades: Count;
}

/**
 * `Σ(mc × unidades) / Σ(unidades)` — el MC promedio del SPEC, **con sus dos
 * operandos**.
 *
 * Un producto sin PVP no aporta ni al numerador ni al denominador: no tiene
 * margen que promediar, y contarlo como cero bajaría el promedio de todos. Por
 * eso se devuelve `unidades` y no se deja que el llamante use
 * `unidadesTotales`: son distintas en cuanto hay un producto sin precio, y la
 * división no daría el mismo número.
 */
function mcDeReferencia(productos: readonly ProductoParaClasificar[]): McDeReferencia {
  const conMargen = productos.filter((producto) => producto.margenContribucion !== null);
  const unidades = sumarUnidades(conMargen);
  if (unidades.isZero()) return { promedio: null, total: null, unidades };

  const total = Money.sum(conMargen.map((producto) => margenDe(producto).times(producto.unidades)));

  return { promedio: total.dividedBy(unidades.asRatio(), DIVISION), total, unidades };
}

function margenDe(producto: ProductoParaClasificar): Money {
  return producto.margenContribucion ?? Money.CERO;
}

interface Clasificacion {
  readonly producto: ProductoParaClasificar;
  readonly contexto: Contexto;
  readonly unidadesTotales: Count;
  readonly mcPromedio: Money | null;
}

function clasificarUno(datos: Clasificacion): ProductoClasificado {
  const { producto } = datos;
  const popularidad = producto.unidades.ratioTo(datos.unidadesTotales);
  const indice = indiceDe(datos);

  return {
    productId: producto.productId,
    unidades: producto.unidades,
    popularidad,
    indicePopularidad: indice,
    margenContribucion: producto.margenContribucion,
    cuadrante: cuadranteDe({ ...datos, indice }),
  };
}

/**
 * `(unidades × n_activos) / (total × regla)` — **una sola división.**
 *
 * **NO SE CALCULA DESDE `popularidad`, Y ESA ES LA DIFERENCIA ENTRE CUMPLIR EL
 * CRITERIO DE ACEPTACIÓN Y NO CUMPLIRLO.** La forma obvia —`popularidad × n /
 * regla`— redondea a escala 12 en medio: con 210 unidades de 900 y tres
 * productos activos, `210/900` da `0.233333333333`, y de ahí el índice sale
 * **`0.999999999999`** en vez de `1`.
 *
 * Ese producto está exactamente en la frontera de popularidad, y con
 * `0.999999999999` cae en `CABALLO` en vez de `ESTRELLA`: un plato que sostiene
 * la carta clasificado como uno que hay que rediseñar, por un residuo en el
 * decimal doce.
 *
 * Reordenando los factores hay una única división al final —`630 / 630`— y el
 * índice sale `1` exacto. La `popularidad` se sigue devolviendo porque es un
 * dato del SPEC, pero **no participa** en este cálculo.
 *
 * La regla llega por parámetro y podría venir en cero desde una configuración a
 * medio llenar; `Ratio.dividedBy` lanza ante el cero, así que la guarda va aquí
 * delante y el resultado es `null`: «no se puede saber», que es la verdad.
 */
function indiceDe(datos: Clasificacion): Ratio | null {
  const { contexto, producto } = datos;
  if (datos.unidadesTotales.isZero() || contexto.reglaPopularidad.isZero()) return null;

  const activos = Count.fromInteger(contexto.activos.length).asRatio();
  const numerador = producto.unidades.asRatio().times(activos);
  const divisor = datos.unidadesTotales.asRatio().times(contexto.reglaPopularidad);

  return divisor.isZero() ? null : numerador.dividedBy(divisor, DIVISION);
}

function cuadranteDe(datos: Clasificacion & { readonly indice: Ratio | null }): Cuadrante {
  const { producto, indice, mcPromedio } = datos;

  if (!producto.activo) return 'INACTIVO';
  if (indice === null || producto.unidades.isZero()) return 'SIN_DATOS';
  if (producto.margenContribucion === null || mcPromedio === null) return 'SIN_DATOS';

  // `>=` en las dos comparaciones, tal como la tabla del SPEC las escribe. El
  // empate exacto —indice = 1, mc = promedio— es ESTRELLA, y es determinista
  // porque los dos lados son decimales exactos y no flotantes.
  const popular = indice.greaterThanOrEqual(Ratio.UNO);
  const rentable = producto.margenContribucion.greaterThanOrEqual(mcPromedio);

  if (popular) return rentable ? 'ESTRELLA' : 'CABALLO';
  return rentable ? 'ROMPECABEZAS' : 'PERRO';
}
