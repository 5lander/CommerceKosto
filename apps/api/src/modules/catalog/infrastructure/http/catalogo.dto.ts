/**
 * Esquemas del límite HTTP del catálogo. Todos `.strict()`.
 *
 * LOS DECIMALES ENTRAN COMO CADENA, NUNCA COMO NÚMERO, y es la regla que más
 * se nota aquí. `z.number()` haría que `0.85` pasara por un `double` de
 * JavaScript antes de que nadie lo mirara, y ADR-003 existe justamente para que
 * eso no ocurra: todo decimal entra por cadena y lo parsea el dominio. El
 * patrón acepta signo, dígitos y un punto — nada de notación científica, que
 * `1e-3` es una forma perfectamente válida de colar un valor que nadie lee bien
 * en una pantalla.
 *
 * NO SE ACEPTA `factorDeConversion`: lo calcula el dominio. Lo que sí se acepta
 * es `factorExplicito`, que es otra cosa —cuántas unidades de uso salen de UNA
 * de compra— y solo hace falta cuando las dimensiones no coinciden.
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_NOMBRE = 200;
const LARGO_MAXIMO_DE_DECIMAL = 40;

/** Decimal exacto en cadena: `"0.85"`, `"2"`, `"-1.5"`. Sin exponentes. */
const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^-?\d+(\.\d+)?$/u, 'debe ser un decimal en notación normal, por ejemplo "0.85"');

const nombre = z.string().trim().min(1).max(LARGO_MAXIMO_DE_NOMBRE);
const texto = z.string().trim().max(LARGO_MAXIMO_DE_NOMBRE);

export const CUERPO_DE_GRUPO = z.object({ nombre }).strict();

export const CUERPO_DE_ITEM = z
  .object({
    nombre,
    tipo: z.enum(['COMPRADO', 'PRODUCIDO']),
    unidadDeUso: z.string().min(1).max(LARGO_MAXIMO_DE_DECIMAL),
    rendimiento: decimal,
    grupoId: z.uuid().nullable(),
    confianzaDePrecio: z.enum(['FACTURA', 'ESTIMADO']),
    /** `null` para un ítem comprado; obligatorio decidirlo en una preparación. */
    llevaStock: z.boolean().nullable(),
  })
  .strict();

export const CUERPO_DE_CAMBIO_DE_ITEM = z
  .object({
    nombre,
    rendimiento: decimal,
    grupoId: z.uuid().nullable(),
    confianzaDePrecio: z.enum(['FACTURA', 'ESTIMADO']),
    estado: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .strict();

export const CUERPO_DE_ARTICULO = z
  .object({
    itemId: z.uuid(),
    nombre,
    marca: texto.nullable(),
    proveedor: texto.nullable(),
    presentacion: decimal,
    unidadDePresentacion: z.string().min(1).max(LARGO_MAXIMO_DE_DECIMAL),
    factorExplicito: decimal.nullable(),
  })
  .strict();

export type CuerpoDeGrupo = z.infer<typeof CUERPO_DE_GRUPO>;
export type CuerpoDeItem = z.infer<typeof CUERPO_DE_ITEM>;
export type CuerpoDeCambioDeItem = z.infer<typeof CUERPO_DE_CAMBIO_DE_ITEM>;
export type CuerpoDeArticulo = z.infer<typeof CUERPO_DE_ARTICULO>;
