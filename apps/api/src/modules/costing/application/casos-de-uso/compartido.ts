/**
 * Lo que es DE COMPANY y no cambia entre ubicaciones, resuelto una sola vez.
 *
 * **LO ENCONTRO `npm run bench`, NO UNA REVISION DE CODIGO.** El consolidado de
 * diez ubicaciones tardaba 1.351 ms contra un presupuesto de 800 (CLAUDE.md §5),
 * y el motivo no era ninguna consulta lenta: era la MISMA lectura repetida. Con
 * volumen realista, un consolidado leia la tabla `item` cincuenta veces y
 * calculaba los costos de los 500 items de la company VEINTE veces, siempre con
 * la misma fecha de corte y siempre con el mismo resultado.
 *
 * Y NO ES SOLO EL CONSOLIDADO: incluso costeando UNA ubicacion, `CostosDeItems`
 * se ejecutaba dos veces —una desde el contexto de analitica y otra dentro de
 * `CostearCarta`— sobre el mismo corte. La duplicacion estaba desde P8; lo que
 * faltaba era un medidor que la enseñara.
 *
 * QUE ES Y QUE NO ES.
 *
 * **No es una cache.** No hay TTL, no hay invalidacion, no hay estado entre
 * peticiones y no vive en ningun sitio: se crea al empezar una operacion y
 * muere con ella. Una cache entre peticiones tendria que responder «¿y si
 * alguien confirma un precio mientras tanto?», y esa pregunta no se plantea si
 * lo memorizado dura menos que la lectura que lo usa.
 *
 * **Memoriza promesas, no resultados.** Dos llamadas simultaneas —y son
 * simultaneas: el consolidado lanza las diez ubicaciones con `Promise.all`—
 * comparten la MISMA promesa en vuelo. Guardar el resultado y no la promesa
 * dejaria pasar diez lecturas a la vez antes de que la primera terminara, que
 * es justo el caso que hay que evitar.
 *
 * **Los costos se memorizan POR FECHA DE CORTE.** Las diez ubicaciones de una
 * company suelen cerrar el mismo dia, pero cada periodo trae su `finEn` de su
 * propia fila. Dar por hecho que coinciden seria decidir un numero de dinero
 * sobre un supuesto; con la fecha como clave, si coinciden se comparte y si no,
 * no — y en los dos casos el resultado es correcto.
 */

import type { AjustesDeCompany } from '../../../pricing/application/ports/repositorio-de-precios.port';
import type { CostosDeLaCompany } from '../../../pricing/application/casos-de-uso/costos-de-items';
import type { ItemLeido } from '../../../catalog/application/ports/repositorio-de-catalogo.port';
import type { SesionActiva } from '../../../iam/application/casos-de-uso/validar-sesion';
import type { CostosDeItems } from '../../../pricing/application/casos-de-uso/costos-de-items';
import type { LeerAjustes } from '../../../pricing/application/casos-de-uso/ajustes';
import type { ListarItems } from '../../../catalog/application/casos-de-uso/items';
import type {
  CartaDeUbicacion,
  LeerCarta,
} from '../../../recipes/application/casos-de-uso/carta';
import type { LocationId } from '../../../../shared/domain/identity/identificadores';

/**
 * LAS TRES PIEZAS QUE HACEN FALTA, Y NINGUNA MAS.
 *
 * Pedir `DependenciasDeCosteo` entero obligaria a quien solo tiene estas tres
 * —el contexto de analitica, por ejemplo— a inventarse un `leerCarta` que no
 * usa. Un puerto se define por lo que se consume, no por lo que hay a mano.
 */
export interface LecturasDeCompany {
  readonly costosDeItems: CostosDeItems;
  readonly listarItems: ListarItems;
  readonly leerAjustes: LeerAjustes;
  readonly leerCarta: LeerCarta;
}

/**
 * Las tres lecturas de company, cada una detras de una funcion perezosa.
 *
 * Perezosa y no un objeto ya resuelto porque no todos los caminos necesitan las
 * tres: quien solo costea una carta no debe pagar una lectura que no usa.
 */
export interface CompartidoDeCompany {
  readonly ajustes: () => Promise<AjustesDeCompany>;
  readonly items: () => Promise<readonly ItemLeido[]>;
  readonly costosAlCorte: (fecha: Date) => Promise<CostosDeLaCompany>;
  /**
   * La carta de UNA ubicacion a UN corte.
   *
   * No es de company, y por eso se guarda con las dos claves. Esta aqui porque
   * `CostearCarta` y `CalcularConsumoTeorico` la piden por separado con
   * argumentos identicos: dos lecturas de `recipe_line` —la consulta mas cara
   * del sistema con volumen— para el mismo dato.
   */
  readonly cartaDe: (locationId: LocationId, fecha: Date) => Promise<CartaDeUbicacion>;
}

/** Memoriza la primera llamada y devuelve esa misma promesa a las siguientes. */
function unaVez<T>(calcular: () => Promise<T>): () => Promise<T> {
  let enVuelo: Promise<T> | null = null;
  return () => (enVuelo ??= calcular());
}

/** Igual, pero con clave: una promesa por combinacion distinta de argumentos. */
function unaVezPorClave<A extends readonly unknown[], T>(
  clave: (...args: A) => string,
  calcular: (...args: A) => Promise<T>,
): (...args: A) => Promise<T> {
  const enVuelo = new Map<string, Promise<T>>();

  return (...args) => {
    const nombre = clave(...args);
    const previa = enVuelo.get(nombre);
    if (previa !== undefined) return previa;

    const nueva = calcular(...args);
    enVuelo.set(nombre, nueva);
    return nueva;
  };
}

/**
 * Abre un ambito compartido para UNA operacion.
 *
 * Se llama al principio de la operacion y se pasa hacia abajo. Quien no reciba
 * uno se abre el suyo, de modo que el comportamiento sin cambiar la llamada
 * sigue siendo correcto — solo deja de repetirse dentro de si mismo.
 */
export function compartidoDeCompany(
  deps: LecturasDeCompany,
  sesion: SesionActiva,
): CompartidoDeCompany {
  return {
    ajustes: unaVez(async () => deps.leerAjustes.ejecutar(sesion)),
    items: unaVez(async () => deps.listarItems.ejecutar(sesion, false)),
    costosAlCorte: unaVezPorClave(
      (fecha: Date) => fecha.toISOString(),
      async (fecha: Date) => deps.costosDeItems.ejecutar(sesion, fecha),
    ),
    cartaDe: unaVezPorClave(
      (locationId: LocationId, fecha: Date) => `${locationId}@${fecha.toISOString()}`,
      async (locationId: LocationId, fecha: Date) =>
        deps.leerCarta.ejecutar(sesion, { locationId, fecha }),
    ),
  };
}
