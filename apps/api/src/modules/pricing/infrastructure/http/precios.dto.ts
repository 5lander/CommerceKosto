/**
 * Esquemas del límite HTTP de precios. Todos `.strict()`.
 *
 * **EL PRECIO ENTRA COMO CADENA.** `"2.30"`, no `2.30`. Es la regla de ADR-003
 * en el sitio donde más importa: este número se divide por el factor de
 * conversión y por el rendimiento, y el resultado multiplica cada línea de cada
 * receta. Un `double` aquí no se nota nunca hasta que la conciliación de R7 no
 * da cero.
 *
 * **`ivaCompra` ES OPCIONAL Y ANULABLE, y significan cosas distintas**:
 * omitirlo toma la tasa por defecto de la company; mandar `"0"` declara que esa
 * compra fue exenta. En Ecuador el alimento sin procesar es 0 % y el detergente
 * 15 %, así que la diferencia no es teórica.
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_DECIMAL = 40;
const LARGO_MAXIMO_DE_NOTA = 500;

/** El mes mas largo. El limite fino —y su coherencia— lo pone el dominio. */
const DIAS_MAXIMOS_DEL_MES = 31;
/** Un ano de cobertura ya no es cobertura: es inventario muerto. */
const DIAS_MAXIMOS_DE_COBERTURA = 365;

/** Decimal exacto en cadena, sin exponentes. */
const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^-?\d+(\.\d+)?$/u, 'debe ser un decimal en notación normal, por ejemplo "2.30"');

export const CUERPO_DE_SUGERENCIA = z
  .object({
    itemId: z.uuid(),
    /** `null` solo para una preparación producida: su precio es costo estándar. */
    purchaseArticleId: z.uuid().nullable(),
    precio: decimal,
    /** `null` = usar la tasa por defecto de la company. `"0"` = compra exenta. */
    ivaCompra: decimal.nullable(),
    origen: z.enum(['MANUAL', 'ULTIMA_COMPRA', 'EXTERNO']),
    validFrom: z.iso.datetime(),
    nota: z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable(),
  })
  .strict();

export const CUERPO_DE_DECISION = z
  .object({ decision: z.enum(['CONFIRMED', 'REJECTED']) })
  .strict();

export const CUERPO_DE_AJUSTES = z
  .object({
    ivaVenta: decimal,
    ivaCompra: decimal,
    ivaCompraRecuperable: z.boolean(),
    provisionMerma: decimal,
    foodCostObjetivo: decimal,
    foodCostMaximo: decimal,
    foodCostUmbralVerde: decimal,
    primeCostMaximo: decimal,
    reglaPopularidad: decimal,
    diasOperativosMes: z.int().min(1).max(DIAS_MAXIMOS_DEL_MES),
    diasCobertura: z.int().min(1).max(DIAS_MAXIMOS_DE_COBERTURA),
  })
  .strict();

export type CuerpoDeSugerencia = z.infer<typeof CUERPO_DE_SUGERENCIA>;
export type CuerpoDeDecision = z.infer<typeof CUERPO_DE_DECISION>;
export type CuerpoDeAjustes = z.infer<typeof CUERPO_DE_AJUSTES>;
