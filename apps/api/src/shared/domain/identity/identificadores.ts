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

declare const MARCA_COMPANY: unique symbol;
declare const MARCA_LOCATION: unique symbol;
declare const MARCA_USER: unique symbol;
declare const MARCA_SESSION: unique symbol;
declare const MARCA_ITEM: unique symbol;
declare const MARCA_ARTICLE: unique symbol;
declare const MARCA_GROUP: unique symbol;

export type CompanyId = string & { readonly [MARCA_COMPANY]: 'company' };
export type LocationId = string & { readonly [MARCA_LOCATION]: 'location' };
export type UserId = string & { readonly [MARCA_USER]: 'user' };
export type SessionId = string & { readonly [MARCA_SESSION]: 'session' };
export type ItemId = string & { readonly [MARCA_ITEM]: 'item' };
export type PurchaseArticleId = string & { readonly [MARCA_ARTICLE]: 'purchase-article' };
export type ItemGroupId = string & { readonly [MARCA_GROUP]: 'item-group' };

export class IdentificadorInvalidoError extends Error {
  public override readonly name = 'IdentificadorInvalidoError';

  public constructor(tipo: string, valor: string) {
    // El valor SI aparece: es un identificador, no un secreto, y sin el el
    // mensaje no sirve para diagnosticar nada.
    super(`"${valor}" no es un ${tipo} valido: se esperaba un UUID.`);
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
