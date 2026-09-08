/**
 * Los limites del plan, leidos CON CANDADO dentro de la transaccion que escribe.
 *
 * POR QUE NO ES UN `count` Y UN `if`. Porque eso es un TOCTOU de manual: dos
 * peticiones simultaneas cuentan 499, las dos deciden que caben, y la company
 * acaba con 501 items sobre un limite de 500. El candado sobre la fila de
 * `company` serializa a las dos, y la segunda cuenta 500 y se para. Es el mismo
 * razonamiento —y el mismo patron— con el que P1 protegio el limite de
 * ubicaciones; P11 lo extiende a los otros dos limites que D5 declara.
 *
 * EL CANDADO VA SOBRE `company`, NO SOBRE `plan`. `plan` es un catalogo que
 * comparten todas las companies: bloquear su fila serializaria la creacion de
 * items de TODOS los clientes del mismo plan entre si. `FOR UPDATE OF c` se lo
 * dice a PostgreSQL explicitamente.
 *
 * VIVE EN `shared/infrastructure/persistence` PORQUE LO USAN DOS MODULOS
 * —`catalog` para los items y `recipes` para los productos— y necesita el
 * cliente de transaccion, que es de aqui. Si viviera en uno de los dos, el otro
 * tendria que importarlo y `audit:arch` lo pararia, con razon.
 *
 * NADA SE INTERPOLA. Se leen los dos limites y elige quien llama, en vez de
 * meter el nombre de la columna en el SQL: un identificador no se parametriza, y
 * la respuesta de este proyecto a eso es no tenerlo dinamico.
 */

import { z } from 'zod';

import type { CompanyId } from '../../domain/identity/identificadores';
import type { ClienteDeTransaccion } from './prisma-connection';

const FILA_DE_LIMITES = z.array(
  z.object({ max_items: z.number().int(), max_products: z.number().int() }),
);

export interface LimitesDelPlan {
  readonly items: number;
  readonly productos: number;
}

/**
 * @throws {Error} si la company no es visible, que con una sesion valida no
 * deberia poder ocurrir: RLS filtra por tenant, asi que no verla significa que
 * no es la suya.
 */
export async function limitesBloqueados(
  tx: ClienteDeTransaccion,
  company: CompanyId,
): Promise<LimitesDelPlan> {
  const filas = await tx.$queryRaw`SELECT p."max_items", p."max_products"
                                     FROM "company" c
                                     JOIN "plan" p ON p."code" = c."plan_code"
                                    WHERE c."id" = ${company}::uuid
                                      FOR UPDATE OF c`;

  const [fila] = FILA_DE_LIMITES.parse(filas);
  if (fila === undefined) {
    throw new Error('La company de la sesion no existe o no es visible.');
  }

  return { items: fila.max_items, productos: fila.max_products };
}

/** `null` si caben; el maximo si no. Se devuelve el maximo para poder decirlo. */
export function excedeElLimite(entrada: {
  readonly actuales: number;
  readonly nuevos: number;
  readonly maximo: number;
}): number | null {
  return entrada.actuales + entrada.nuevos > entrada.maximo ? entrada.maximo : null;
}
