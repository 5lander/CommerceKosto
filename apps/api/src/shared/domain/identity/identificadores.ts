/**
 * Identificadores de dominio — CLAUDE.md §3: "tipos de dominio, no primitivos
 * sueltos".
 *
 * SON CADENAS MARCADAS, NO CLASES, y la diferencia importa. `Money` es una
 * clase porque hay que impedir que alguien le sume un `number`; un identificador
 * no tiene aritmetica que proteger. Lo que hay que impedir es OTRA cosa: pasar
 * un `LocationId` donde se espera un `CompanyId`, que es como se escriben las
 * fugas entre tenants sin que el compilador diga nada.
 *
 * Al ser cadenas por debajo, viajan tal cual al driver de la base y a la
 * serializacion, sin conversion ni envoltorio.
 *
 * TODO IDENTIFICADOR SE CONSTRUYE VALIDANDO. `companyId(x)` rechaza lo que no
 * sea un UUID, asi que un valor llegado del exterior no puede convertirse en un
 * identificador sin pasar por la comprobacion.
 */

import { ErrorDeDominio, type CodigoDeDominio } from '../errors/error-de-dominio';
import { valorParaMensaje } from '../errors/valor-en-mensaje';

declare const MARCA_COMPANY: unique symbol;
declare const MARCA_LOCATION: unique symbol;
declare const MARCA_USER: unique symbol;
declare const MARCA_SESSION: unique symbol;
declare const MARCA_ITEM: unique symbol;
declare const MARCA_ARTICLE: unique symbol;
declare const MARCA_GROUP: unique symbol;
declare const MARCA_PRICE: unique symbol;
declare const MARCA_PRODUCT: unique symbol;
declare const MARCA_RECIPE: unique symbol;
declare const MARCA_PROPAGATION: unique symbol;
declare const MARCA_MOVEMENT: unique symbol;
declare const MARCA_TRANSFER: unique symbol;
declare const MARCA_PRODUCTION: unique symbol;
declare const MARCA_PERIOD: unique symbol;
declare const MARCA_COUNT: unique symbol;
declare const MARCA_IMPORT: unique symbol;

export type CompanyId = string & { readonly [MARCA_COMPANY]: 'company' };
export type LocationId = string & { readonly [MARCA_LOCATION]: 'location' };
export type UserId = string & { readonly [MARCA_USER]: 'user' };
export type SessionId = string & { readonly [MARCA_SESSION]: 'session' };
export type ItemId = string & { readonly [MARCA_ITEM]: 'item' };
export type PurchaseArticleId = string & { readonly [MARCA_ARTICLE]: 'purchase-article' };
export type ItemGroupId = string & { readonly [MARCA_GROUP]: 'item-group' };
export type ReferencePriceId = string & { readonly [MARCA_PRICE]: 'reference-price' };
export type ProductId = string & { readonly [MARCA_PRODUCT]: 'product' };
export type RecipeId = string & { readonly [MARCA_RECIPE]: 'recipe' };
export type RecipePropagationId = string & { readonly [MARCA_PROPAGATION]: 'recipe-propagation' };
export type MovementId = string & { readonly [MARCA_MOVEMENT]: 'inventory-movement' };
export type TransferId = string & { readonly [MARCA_TRANSFER]: 'inventory-transfer' };
export type ProductionId = string & { readonly [MARCA_PRODUCTION]: 'inventory-production' };
export type PeriodId = string & { readonly [MARCA_PERIOD]: 'period' };
export type PhysicalCountId = string & { readonly [MARCA_COUNT]: 'physical-count' };
/**
 * Hasta D-16.200 el id de una importación era una cadena suelta, y podía serlo:
 * no salía de `imports`. Ahora viaja al libro —cada movimiento importado lo
 * lleva— y llega por una ruta, que son las dos formas en que un identificador
 * se confunde con otro.
 */
export type ImportJobId = string & { readonly [MARCA_IMPORT]: 'import-job' };

/**
 * ES UN ERROR DE DOMINIO, Y ESO LO CONVIERTE EN UN 400 (P16-A2, INC-012).
 *
 * Hasta P16-A2 extendia `Error` a secas, asi que el filtro no lo reconocia y
 * salia como **500 `INTERNAL_ERROR`** con el mensaje generico. Un identificador
 * mal formado no es un fallo del servidor: es la peticion la que esta mal, y el
 * unico que puede arreglarla es quien la manda. El 500 ademas mentia dos veces
 * —disparaba alertas de operacion y contaba como caida— y no decia que corregir.
 *
 * Alcanzable desde 16 `@Param` y 5 `@Query` que hoy no pasan por `ParseUUIDPipe`
 * ni por un esquema: `GET /costeo/:productId`, `GET /precios?itemId=`,
 * `PUT /catalogo/items/:id` y companía.
 *
 * **NINGUN CAMINO INTERNO LO PRODUCE.** Los identificadores que nacen dentro
 * vienen de columnas `uuid`, que no pueden traer otra cosa; los unicos que
 * pueden estar mal son los que entran de fuera. Por eso la clasificacion como
 * entrada invalida es incondicional y no una suposicion sobre el llamante.
 */
export class IdentificadorInvalidoError extends ErrorDeDominio {
  public override readonly codigo: CodigoDeDominio = 'ENTRADA_INVALIDA';

  public constructor(tipo: string, valor: string) {
    // El valor SI aparece: es un identificador, no un secreto, y sin el el
    // mensaje no sirve para diagnosticar nada. Sale recortado y sin caracteres
    // de control porque ahora VIAJA AL CLIENTE — ver `valorParaMensaje`.
    super(
      `"${valorParaMensaje(valor)}" no es un ${tipo} valido. Se espera un UUID, ` +
        'por ejemplo "0192f3a1-5c7e-7b2a-9d44-1e8f6b0c3a55".',
      { tipo },
    );
  }
}

/**
 * Acepta cualquier version de UUID, incluida la 7 que genera la base.
 *
 * No se comprueba la version a proposito: `uuidv7()` es lo que usan las tablas
 * hoy, pero un identificador que venga de una migracion de datos antigua o de
 * un sistema externo puede ser v4 y sigue siendo un identificador legitimo.
 * Lo que se valida es la FORMA, que es lo que evita que una cadena arbitraria
 * acabe interpolada en una consulta.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function exigirUuid(tipo: string, valor: string): string {
  if (!UUID.test(valor)) {
    throw new IdentificadorInvalidoError(tipo, valor);
  }
  return valor.toLowerCase();
}

/**
 * La misma comprobación, para quien todavía no sabe de qué tipo es el
 * identificador: el pipe de los parámetros de ruta (P16-C). `nombre` es el del
 * parámetro y solo va al mensaje.
 *
 * @throws {IdentificadorInvalidoError}
 */
export function identificadorDeEntrada(nombre: string, valor: string): string {
  return exigirUuid(nombre, valor);
}

/** @throws {IdentificadorInvalidoError} */
export function companyId(valor: string): CompanyId {
  return exigirUuid('CompanyId', valor) as CompanyId;
}

/** @throws {IdentificadorInvalidoError} */
export function locationId(valor: string): LocationId {
  return exigirUuid('LocationId', valor) as LocationId;
}

/** @throws {IdentificadorInvalidoError} */
export function userId(valor: string): UserId {
  return exigirUuid('UserId', valor) as UserId;
}

/** @throws {IdentificadorInvalidoError} */
export function sessionId(valor: string): SessionId {
  return exigirUuid('SessionId', valor) as SessionId;
}

/** @throws {IdentificadorInvalidoError} */
export function itemId(valor: string): ItemId {
  return exigirUuid('ItemId', valor) as ItemId;
}

/** @throws {IdentificadorInvalidoError} */
export function purchaseArticleId(valor: string): PurchaseArticleId {
  return exigirUuid('PurchaseArticleId', valor) as PurchaseArticleId;
}

/** @throws {IdentificadorInvalidoError} */
export function itemGroupId(valor: string): ItemGroupId {
  return exigirUuid('ItemGroupId', valor) as ItemGroupId;
}

/** @throws {IdentificadorInvalidoError} */
export function referencePriceId(valor: string): ReferencePriceId {
  return exigirUuid('ReferencePriceId', valor) as ReferencePriceId;
}

/** @throws {IdentificadorInvalidoError} */
export function productId(valor: string): ProductId {
  return exigirUuid('ProductId', valor) as ProductId;
}

/** @throws {IdentificadorInvalidoError} */
export function recipeId(valor: string): RecipeId {
  return exigirUuid('RecipeId', valor) as RecipeId;
}

/** @throws {IdentificadorInvalidoError} */
export function recipePropagationId(valor: string): RecipePropagationId {
  return exigirUuid('RecipePropagationId', valor) as RecipePropagationId;
}

/** @throws {IdentificadorInvalidoError} */
export function movementId(valor: string): MovementId {
  return exigirUuid('MovementId', valor) as MovementId;
}

/** @throws {IdentificadorInvalidoError} */
export function transferId(valor: string): TransferId {
  return exigirUuid('TransferId', valor) as TransferId;
}

/** @throws {IdentificadorInvalidoError} */
export function productionId(valor: string): ProductionId {
  return exigirUuid('ProductionId', valor) as ProductionId;
}

/** @throws {IdentificadorInvalidoError} */
export function periodId(valor: string): PeriodId {
  return exigirUuid('PeriodId', valor) as PeriodId;
}

/** @throws {IdentificadorInvalidoError} */
export function physicalCountId(valor: string): PhysicalCountId {
  return exigirUuid('PhysicalCountId', valor) as PhysicalCountId;
}

/** @throws {IdentificadorInvalidoError} */
export function importJobId(valor: string): ImportJobId {
  return exigirUuid('ImportJobId', valor) as ImportJobId;
}
