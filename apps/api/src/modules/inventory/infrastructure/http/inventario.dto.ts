/**
 * Esquemas y respuestas del límite HTTP de inventario. Todos `.strict()`.
 *
 * **LAS CANTIDADES ENTRAN COMO CADENA**, igual que los precios de P3 y por la
 * misma razón de ADR-003. Aquí además importa por un motivo propio: el libro es
 * append-only, así que una cantidad mal redondeada al entrar no se corrige
 * editando la fila — hay que registrar otra que la anule.
 *
 * **LA CANTIDAD SE CAPTURA COMO MAGNITUD POSITIVA** en todo salvo `AJUSTE`. El
 * signo lo pone `conSignoDelTipo`, en el dominio: pedirle el signo a quien
 * registra una merma es pedirle que entienda la convención interna del libro, y
 * quien no la entienda escribirá la mitad de las mermas al revés.
 *
 * **NINGUNA RESPUESTA DE ESCRITURA LLEVA EL SALDO RESULTANTE.** `BODEGA` puede
 * escribir el libro y no puede leerlo (CLAUDE.md §4.3): un `nuevoSaldo` en la
 * respuesta de un `POST` filtraría la receta exactamente igual que un `GET`.
 *
 * **LOS DOS `.refine()` DE OBJETO SON COHERENCIA, NO SEGURIDAD**, y la
 * distinción es la de INC-008: un refinamiento de objeto **no se ejecuta** si
 * algún campo falló antes, así que poner ahí un control de autorización lo
 * desactivaría cada vez que otro campo viniera mal. Estos dos solo dicen que
 * una compra necesita importe y que el artículo es de la compra; si un campo
 * falla, la petición se rechaza igual y no queda nada sin comprobar. Ningún
 * control de acceso vive aquí: viven en `@Requiere` y en
 * `exigirUbicacionEnAlcance`.
 *
 * **`costoTotal` DE UNA COMPRA ES EL TOTAL DE LA FACTURA, CON IVA** (D-16.9).
 * El neto lo calcula el dominio con la tarifa del cuerpo, del artículo o del
 * grupo; `ivaTarifa` es opcional y solo manda sobre las otras dos. Y en la
 * salida, `desglose` dice si esa fila lleva los cuatro importes o es una
 * COMPRA anterior a P16-A1 («sin desglose», D-16.18).
 */

import { z } from 'zod';

const LARGO_MAXIMO_DE_DECIMAL = 40;
const LARGO_MAXIMO_DE_NOTA = 500;
const MAXIMO_POR_PAGINA = 200;
const POR_PAGINA_POR_DEFECTO = 50;
/** Una carga de ventas de un mes entero, con margen. */
const MAXIMO_DE_VENTAS = 500;
/** Los insumos de un lote: una receta larga, con margen. */
const MAXIMO_DE_INSUMOS = 100;

/** Decimal exacto en cadena, sin exponentes. */
const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^-?\d+(\.\d+)?$/u, 'debe ser un decimal en notación normal, por ejemplo "2.30"');

/** Magnitud: sin signo. El sentido lo pone el tipo de movimiento. */
const magnitud = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^\d+(\.\d+)?$/u, 'debe ser una cantidad positiva, por ejemplo "2.5"');

const nota = z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable();

/** Una tarifa de IVA: fracción entre 0 y 1, en cadena. `"0.15"`, nunca `"15"`. */
const fraccion = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u, 'debe ser una fracción entre 0 y 1, por ejemplo "0.15"');

/**
 * Un movimiento suelto.
 *
 * `cantidad` acepta signo porque `AJUSTE` lo necesita —existe para mover el
 * saldo en la dirección que haga falta—; para `COMPRA` y `MERMA` el dominio
 * rechaza el negativo con un mensaje que explica por qué.
 */
export const CUERPO_DE_MOVIMIENTO = z
  .object({
    locationId: z.uuid(),
    itemId: z.uuid(),
    tipo: z.enum(['COMPRA', 'MERMA', 'AJUSTE']),
    cantidad: decimal,
    /** Obligatorio en `COMPRA`: es lo que se pagó, y de ahí sale SPEC §16. */
    costoTotal: decimal.nullable(),
    /** Solo en `COMPRA`: en qué presentación se compró (SPEC §7). */
    purchaseArticleId: z.uuid().nullable(),
    /** Solo en `COMPRA`: la tarifa de la factura. Omitida, manda artículo > grupo. */
    ivaTarifa: fraccion.nullable().default(null),
    occurredAt: z.iso.datetime(),
    note: nota,
  })
  .strict()
  .refine(
    (cuerpo) => cuerpo.tipo !== 'COMPRA' || cuerpo.costoTotal !== null,
    { message: 'Una compra necesita su importe total.', path: ['costoTotal'] },
  )
  .refine((cuerpo) => cuerpo.purchaseArticleId === null || cuerpo.tipo === 'COMPRA', {
    message: 'El artículo de compra solo tiene sentido en un movimiento de tipo COMPRA.',
    path: ['purchaseArticleId'],
  })
  .refine((cuerpo) => cuerpo.ivaTarifa === null || cuerpo.tipo === 'COMPRA', {
    message: 'La tarifa de IVA solo tiene sentido en un movimiento de tipo COMPRA.',
    path: ['ivaTarifa'],
  });

export const CUERPO_DE_CORRECCION = z.object({ note: nota }).strict();

export const CUERPO_DE_TRANSFERENCIA = z
  .object({
    origen: z.uuid(),
    destino: z.uuid(),
    itemId: z.uuid(),
    cantidad: magnitud,
    occurredAt: z.iso.datetime(),
    note: nota,
  })
  .strict();

export const CUERPO_DE_PRODUCCION = z
  .object({
    locationId: z.uuid(),
    itemId: z.uuid(),
    cantidad: magnitud,
    insumos: z
      .array(z.object({ itemId: z.uuid(), cantidad: magnitud }).strict())
      .min(1)
      .max(MAXIMO_DE_INSUMOS),
    occurredAt: z.iso.datetime(),
    note: nota,
  })
  .strict();

export const CUERPO_DE_CONSUMO = z
  .object({
    locationId: z.uuid(),
    ventas: z
      .array(z.object({ productId: z.uuid(), unidades: magnitud }).strict())
      .min(1)
      .max(MAXIMO_DE_VENTAS),
    occurredAt: z.iso.datetime(),
    note: nota,
  })
  .strict();

export const CONSULTA_DE_SALDOS = z.object({ locationId: z.uuid() });

export const CONSULTA_DEL_LIBRO = z.object({
  locationId: z.uuid(),
  itemId: z.uuid().optional(),
  desde: z.iso.datetime().optional(),
  hasta: z.iso.datetime().optional(),
  limite: z.coerce.number().int().min(1).max(MAXIMO_POR_PAGINA).default(POR_PAGINA_POR_DEFECTO),
  /** Opaco: es el `id` del último movimiento de la página anterior. */
  cursor: z.uuid().optional(),
});

export type CuerpoDeMovimiento = z.infer<typeof CUERPO_DE_MOVIMIENTO>;
export type CuerpoDeCorreccion = z.infer<typeof CUERPO_DE_CORRECCION>;
export type CuerpoDeTransferencia = z.infer<typeof CUERPO_DE_TRANSFERENCIA>;
export type CuerpoDeProduccion = z.infer<typeof CUERPO_DE_PRODUCCION>;
export type CuerpoDeConsumo = z.infer<typeof CUERPO_DE_CONSUMO>;
export type ConsultaDeSaldos = z.infer<typeof CONSULTA_DE_SALDOS>;
export type ConsultaDelLibroDto = z.infer<typeof CONSULTA_DEL_LIBRO>;

/** El saldo de un ítem. Solo llega a quien tiene `inventory.read`. */
export interface SaldoDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly cantidad: string;
}

/**
 * Los cuatro importes de una COMPRA (D-16.10), solo cuando existen. Una fila
 * «sin desglose» no lleva los campos, no los lleva en `null`: así el consumidor
 * no puede confundir «no se sabe» con «cero».
 */
export type DesgloseDto =
  | { readonly desglose: 'SIN_DESGLOSE' }
  | {
      readonly desglose: 'CONOCIDO';
      readonly totalBruto: string;
      readonly ivaTarifaAplicada: string;
      readonly ivaRecuperableAplicado: boolean;
    };

export type MovimientoDto = DesgloseDto & {
  readonly id: string;
  readonly locationId: string;
  readonly itemId: string;
  readonly tipo: string;
  readonly cantidad: string;
  /** En una COMPRA con desglose, el NETO. Sin desglose, lo que se tecleó. */
  readonly costoTotal: string | null;
  readonly occurredAt: string;
  readonly recordedAt: string;
  readonly transferId: string | null;
  readonly productionId: string | null;
  readonly corrigeA: string | null;
  readonly corregidoPor: string | null;
  readonly note: string | null;
};

export interface PaginaDelLibroDto {
  readonly movimientos: readonly MovimientoDto[];
  /** `null` cuando no hay más. Se pasa tal cual como `cursor`. */
  readonly siguiente: string | null;
}

/** Lo único que devuelve una escritura: qué se escribió, nunca el saldo. */
export interface RegistroDto {
  readonly id: string;
}

export interface RegistroDeConsumoDto {
  readonly movimientos: readonly string[];
}
