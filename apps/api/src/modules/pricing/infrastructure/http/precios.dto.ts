/**
 * Esquemas del límite HTTP de precios. Todos `.strict()`.
 *
 * **EL PRECIO ENTRA COMO CADENA.** `"2.30"`, no `2.30`. Es la regla de ADR-003
 * en el sitio donde más importa: este número se divide por el factor de
 * conversión y por el rendimiento, y el resultado multiplica cada línea de cada
 * receta. Un `double` aquí no se nota nunca hasta que la conciliación de R7 no
 * da cero.
 *
 * **`ivaCompra` ES ANULABLE, y `null` y `"0"` significan cosas distintas**:
 * `null` toma la tarifa del artículo o, sin artículo, la del grupo del ítem
 * (D-16.9: nunca la de la company, nunca un valor por defecto); mandar `"0"`
 * declara que esa compra fue exenta. En Ecuador el alimento sin procesar es
 * 0 % y el detergente 15 %, así que la diferencia no es teórica.
 */

import { z } from 'zod';

import { decimalConSigno, decimalPositivo, fraccion } from '../../../../shared/infrastructure/http/decimales-del-borde';

const LARGO_MAXIMO_DE_NOTA = 500;

/** El mes mas largo. El limite fino —y su coherencia— lo pone el dominio. */
const DIAS_MAXIMOS_DEL_MES = 31;
/** Un ano de cobertura ya no es cobertura: es inventario muerto. */
const DIAS_MAXIMOS_DE_COBERTURA = 365;


export const CUERPO_DE_SUGERENCIA = z
  .object({
    itemId: z.uuid(),
    /** `null` solo para una preparación producida: su precio es costo estándar. */
    purchaseArticleId: z.uuid().nullable(),
    precio: decimalPositivo,
    /** `null` = la del artículo o la del grupo; sin ninguna, 400. `"0"` = compra exenta. */
    ivaCompra: fraccion.nullable(),
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
    ivaVenta: decimalConSigno,
    ivaCompraRecuperable: z.boolean(),
    provisionMerma: decimalConSigno,
    foodCostObjetivo: decimalConSigno,
    foodCostMaximo: decimalConSigno,
    foodCostUmbralVerde: decimalConSigno,
    primeCostMaximo: decimalConSigno,
    reglaPopularidad: decimalConSigno,
    diasOperativosMes: z.int().min(1).max(DIAS_MAXIMOS_DEL_MES),
    diasCobertura: z.int().min(1).max(DIAS_MAXIMOS_DE_COBERTURA),
  })
  .strict();

/** Lo más grande que devuelve una página de la bandeja. */
const PENDIENTES_MAXIMOS = 200;
const PENDIENTES_POR_DEFECTO = 50;

/** `GET /precios?itemId=` — hasta P16-B, un `@Query` suelto sin esquema (D-16.111). */
export const CONSULTA_DE_HISTORIAL = z.object({ itemId: z.uuid() }).strict();

/**
 * `?fecha=` de los costos. Hasta P16-B, `new Date("basura")` daba una fecha
 * inválida que llegaba al dominio y salía como un 404 «sin precio a esa fecha»
 * que mentía (D-16.111).
 */
export const CONSULTA_DE_FECHA = z.object({ fecha: z.iso.datetime().optional() }).strict();

/** `GET /precios/pendientes`: la bandeja por cursor, nunca OFFSET. */
export const CONSULTA_DE_PENDIENTES = z
  .object({
    despuesDe: z.uuid().optional(),
    limite: z.coerce.number().int().min(1).max(PENDIENTES_MAXIMOS).default(PENDIENTES_POR_DEFECTO),
  })
  .strict();

export type ConsultaDeHistorial = z.infer<typeof CONSULTA_DE_HISTORIAL>;
export type ConsultaDeFecha = z.infer<typeof CONSULTA_DE_FECHA>;
export type ConsultaDePendientes = z.infer<typeof CONSULTA_DE_PENDIENTES>;
export type CuerpoDeSugerencia = z.infer<typeof CUERPO_DE_SUGERENCIA>;
export type CuerpoDeDecision = z.infer<typeof CUERPO_DE_DECISION>;
export type CuerpoDeAjustes = z.infer<typeof CUERPO_DE_AJUSTES>;
