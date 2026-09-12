/**
 * Unidad de uso: la unidad en la que se consume un item dentro de una receta.
 *
 * No es lo mismo que la unidad de COMPRA. El aceite se compra en botellas de
 * 900 ml y se usa en litros; el factor de conversion entre ambas vive en el
 * articulo de compra (P2). Esta es la unidad del lado del consumo, que es la
 * que aparece en las lineas de receta y en el inventario.
 *
 * POR QUE ESTA EN P0 Y NO EN P2. El criterio de aceptacion de P2 dice que "una
 * conversion invalida (kg -> unidades sin factor) se rechaza EN EL DOMINIO".
 * Eso solo se puede cumplir si la cantidad lleva su unidad pegada desde el
 * principio: si P2 modelara cantidades sin tipo, habria que retipar el catalogo
 * entero despues. La unidad tipada es la pieza que hace cumplir ese criterio.
 *
 * En P0 es un identificador marcado. En P2 pasa a ser la clave de la tabla de
 * catalogo de unidades (CLAUDE.md §5: "enums en tabla de catalogo, no en tipo
 * nativo"), sin que cambie nada de lo que se escriba encima.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../errors/error-de-dominio';
import { valorParaMensaje } from '../errors/valor-en-mensaje';

declare const MARCA_UNIDAD: unique symbol;

export type UnidadDeUso = string & { readonly [MARCA_UNIDAD]: 'unidad-de-uso' };

/** El codigo es corto, en minusculas y sin espacios: `kg`, `lt`, `unid`, `g`. */
const CODIGO_VALIDO = /^[a-z][a-z0-9_]{0,15}$/;

/**
 * ES UN ERROR DE DOMINIO, Y ESO LO CONVIERTE EN UN 400 (P16-A2, INC-012).
 *
 * Antes extendia `Error` a secas: `POST /catalogo/items` con
 * `unidadDeUso: "KG"`, `"Litro"` o `"unid de medida"` —las tres cosas que un
 * humano escribe la primera vez— respondia **500 `INTERNAL_ERROR`**, sin decir
 * cual era el problema ni cual era la forma correcta.
 *
 * El mensaje dice ahora las dos cosas que hacen falta para corregir: que el
 * codigo va en minusculas y sin espacios, y tres ejemplos. Lo que NO dice es la
 * lista completa de unidades del catalogo, porque este error es de FORMA y se
 * lanza sin consultar nada; de la existencia se encarga `exigirUnidad`, que si
 * ha leido el catalogo y por eso puede enumerarlo.
 *
 * Como los identificadores, no tiene camino interno: la unidad que nace dentro
 * sale de la columna `item.unit_of_use`, atada por clave foranea a `unit`.
 */
export class UnidadDeUsoInvalidaError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(codigo: string) {
    super(
      `Unidad de uso invalida "${valorParaMensaje(codigo)}": se espera un codigo corto ` +
        'en minusculas, sin espacios ni acentos (por ejemplo "kg", "lt", "unid").',
    );
  }
}

export class UnidadIncompatibleError extends Error {
  public override readonly name = 'UnidadIncompatibleError';

  public constructor(izquierda: UnidadDeUso, derecha: UnidadDeUso, operacion: string) {
    super(
      `No se puede ${operacion} una cantidad en "${izquierda}" con una en "${derecha}". ` +
        'Convertir entre unidades exige un factor explicito, que vive en el articulo de compra ' +
        '(P2). Sumar magnitudes de distinta unidad produce un numero plausible y equivocado.',
    );
  }
}

/**
 * Si `codigo` es una unidad de uso bien formada.
 *
 * Existe para que quien valide un LOTE pueda decir «la fila 12 trae una unidad
 * invalida» sin usar una excepcion como control de flujo ni copiarse la
 * expresion regular a otro archivo, que es lo que `audit:duplication` caza.
 */
export function esUnidadDeUso(codigo: string): boolean {
  return CODIGO_VALIDO.test(codigo);
}

export function unidadDeUso(codigo: string): UnidadDeUso {
  if (!esUnidadDeUso(codigo)) throw new UnidadDeUsoInvalidaError(codigo);
  return codigo as UnidadDeUso;
}

/**
 * Comprueba que dos cantidades hablan de la misma magnitud antes de operar.
 * Lanza en vez de devolver un booleano: el llamante no tiene nada sensato que
 * hacer con un `false` salvo lanzar el mismo error.
 */
export function exigirMismaUnidad(
  izquierda: UnidadDeUso,
  derecha: UnidadDeUso,
  operacion: string,
): UnidadDeUso {
  if (izquierda !== derecha) throw new UnidadIncompatibleError(izquierda, derecha, operacion);
  return izquierda;
}
