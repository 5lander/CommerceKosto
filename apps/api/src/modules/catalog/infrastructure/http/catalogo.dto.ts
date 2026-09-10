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
 *
 * **`ivaTarifa` SE VALIDA EN EL CAMPO, NO EN UN REFINAMIENTO DE OBJETO**
 * (INC-008): `fraccion` solo admite `0`, `0.xx` o `1`. Un `15` donde va
 * `0.15` dividiría cada compra entre dieciséis, y el número sería plausible
 * en pantalla. El dominio lo vuelve a comprobar con `exigirTarifaValida`.
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_NOMBRE = 200;
const LARGO_MAXIMO_DE_DECIMAL = 40;

/** Decimal exacto en cadena: `"0.85"`, `"2"`, `"-1.5"`. Sin exponentes. */
const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^-?\d+(\.\d+)?$/u, 'debe ser un decimal en notación normal, por ejemplo "0.85"');

/** Una tarifa de IVA: fracción entre 0 y 1, en cadena. `"0.15"`, nunca `"15"`. */
const fraccion = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u, 'debe ser una fracción entre 0 y 1, por ejemplo "0.15"');

const nombre = z.string().trim().min(1).max(LARGO_MAXIMO_DE_NOMBRE);
const texto = z.string().trim().max(LARGO_MAXIMO_DE_NOMBRE);

/**
 * `ivaTarifa` es la tarifa que heredan las compras SIN ARTÍCULO de los ítems
 * del grupo (D-16.9). Omitida o `null`: el grupo no define ninguna.
 */
export const CUERPO_DE_GRUPO = z
  .object({ nombre, ivaTarifa: fraccion.nullable().default(null) })
  .strict();

/** `PUT`: estado completo, así que aquí `ivaTarifa` no tiene valor por defecto. */
export const CUERPO_DE_CAMBIO_DE_GRUPO = z
  .object({ nombre, ivaTarifa: fraccion.nullable() })
  .strict();

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
    /**
     * EL INTERRUPTOR DE STOCK, que P6 hace conmutable (SPEC §5).
     *
     * `true`: la preparación se produce en lote y está en el inventario.
     * `false`: al vender se explota su receta y se consumen los insumos.
     * `null`: el ítem es COMPRADO, donde el interruptor no significa nada.
     *
     * Se puede cambiar, y cambiarlo NO reescribe el pasado: los movimientos ya
     * registrados siguen siendo hechos. Lo que cambia es hasta dónde baja el
     * consumo de las ventas que se registren a partir de entonces.
     */
    llevaStock: z.boolean().nullable(),
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
    /** Obligatoria: la tarifa de IVA de ESTE artículo (D-16.9). */
    ivaTarifa: fraccion,
  })
  .strict();

/**
 * Lo editable de un artículo. Ni la presentación ni su unidad ni el factor: son
 * lo que convierte cada compra histórica a unidades de uso, y cambiarlos
 * reescribiría meses cerrados. Para eso se crea otro artículo.
 */
export const CUERPO_DE_CAMBIO_DE_ARTICULO = z
  .object({
    nombre,
    marca: texto.nullable(),
    proveedor: texto.nullable(),
    ivaTarifa: fraccion,
    estado: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .strict();

export type CuerpoDeGrupo = z.infer<typeof CUERPO_DE_GRUPO>;
export type CuerpoDeCambioDeGrupo = z.infer<typeof CUERPO_DE_CAMBIO_DE_GRUPO>;
export type CuerpoDeCambioDeArticulo = z.infer<typeof CUERPO_DE_CAMBIO_DE_ARTICULO>;
export type CuerpoDeItem = z.infer<typeof CUERPO_DE_ITEM>;
export type CuerpoDeCambioDeItem = z.infer<typeof CUERPO_DE_CAMBIO_DE_ITEM>;
export type CuerpoDeArticulo = z.infer<typeof CUERPO_DE_ARTICULO>;
