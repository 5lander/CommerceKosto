/**
 * Esquemas del limite HTTP de recetas. Todos `.strict()`.
 *
 * LA CANTIDAD ENTRA COMO CADENA (ADR-003). Es la que multiplica el costo de
 * cada linea; un `double` aqui no se nota hasta que la conciliacion de R7 deja
 * de dar cero.
 *
 * EL DESTINO ES UNA UNION DISCRIMINADA, no dos campos opcionales. Con dos
 * campos cabria una receta sin destino y una con dos, y las dos son estados que
 * nadie sabe interpretar.
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_NOMBRE = 200;
const LARGO_MAXIMO_DE_DECIMAL = 40;
const LARGO_MAXIMO_DE_NOTA = 500;
const LARGO_MAXIMO_DE_CATEGORIA = 100;
/** Una receta de mas de 500 lineas no es una receta: es una carga mal hecha. */
const LINEAS_MAXIMAS = 500;
/** Mas ubicaciones que el limite de plan mas generoso que P11 vaya a vender. */
const DESTINOS_MAXIMOS = 200;

const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^\d+(\.\d+)?$/u, 'debe ser un decimal no negativo en notacion normal');

export const DESTINO = z.discriminatedUnion('clase', [
  z.object({ clase: z.literal('producto'), productId: z.uuid() }).strict(),
  z.object({ clase: z.literal('item'), itemId: z.uuid() }).strict(),
]);

export const CUERPO_DE_PRODUCTO = z
  .object({
    nombre: z.string().trim().min(1).max(LARGO_MAXIMO_DE_NOMBRE),
    tipo: z.enum(['SIMPLE', 'COMBO']),
    categoria: z.string().trim().max(LARGO_MAXIMO_DE_CATEGORIA).nullable(),
  })
  .strict();

export const CUERPO_DE_UBICACION = z
  .object({
    locationId: z.uuid(),
    activo: z.boolean(),
    /** El PVP incluye IVA (R14). Obligatorio si el producto se activa. */
    pvp: decimal.nullable(),
    rendimientoPorciones: decimal.nullable(),
  })
  .strict();

export const CUERPO_DE_RECETA = z
  .object({
    destino: DESTINO,
    locationId: z.uuid(),
    validFrom: z.iso.datetime(),
    nota: z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable(),
    lineas: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            cantidad: decimal,
            /** AP tal como se compra · EP ya limpio. R4, SPEC 13. */
            base: z.enum(['AP', 'EP']),
            estado: z.enum(['ACTIVA', 'INACTIVA']),
          })
          .strict(),
      )
      .max(LINEAS_MAXIMAS),
  })
  .strict();

export const CUERPO_DE_PROPAGACION = z
  .object({
    productId: z.uuid(),
    origen: z.uuid(),
    destinos: z.array(z.uuid()).min(1).max(DESTINOS_MAXIMOS),
  })
  .strict();

/**
 * Los parametros de consulta de la receta vigente.
 *
 * NO ES `.strict()`, y es la unica excepcion del proyecto: un navegador puede
 * anadir parametros de rastreo a una URL —`utm_source` y companía— y rechazar
 * la peticion por eso seria hostil sin ganar nada. Lo que importa es que los
 * campos que SI se leen esten validados, y lo estan.
 */
export const CONSULTA_DE_RECETA = z.object({
  locationId: z.uuid(),
  productId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  fecha: z.iso.datetime().optional(),
});

export type ConsultaDeReceta = z.infer<typeof CONSULTA_DE_RECETA>;

export type CuerpoDeProducto = z.infer<typeof CUERPO_DE_PRODUCTO>;
export type CuerpoDeUbicacion = z.infer<typeof CUERPO_DE_UBICACION>;
export type CuerpoDeReceta = z.infer<typeof CUERPO_DE_RECETA>;
export type CuerpoDePropagacion = z.infer<typeof CUERPO_DE_PROPAGACION>;
