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

import { decimalNoNegativo, decimalPositivo } from '../../../../shared/infrastructure/http/decimales-del-borde';
import { COMPONENTES_MAXIMOS } from '../../domain/componentes-de-combo';

const LARGO_MAXIMO_DE_NOMBRE = 200;
const LARGO_MAXIMO_DE_NOTA = 500;
const LARGO_MAXIMO_DE_CATEGORIA = 100;
/** Una receta de mas de 500 lineas no es una receta: es una carga mal hecha. */
const LINEAS_MAXIMAS = 500;
/** Mas ubicaciones que el limite de plan mas generoso que P11 vaya a vender. */
const DESTINOS_MAXIMOS = 200;


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
    /** La versión del producto que se leyó (D-16.100). Si otra escritura llegó antes, 409. */
    version: z.int().min(1),
    locationId: z.uuid(),
    activo: z.boolean(),
    /** El PVP incluye IVA (R14). Obligatorio si el producto se activa. */
    pvp: decimalPositivo.nullable(),
    rendimientoPorciones: decimalPositivo.nullable(),
  })
  .strict();

export const CUERPO_DE_RECETA = z
  .object({
    /**
     * La última versión que el editor tenía delante —`ultimaVersionId` de
     * `GET /recetas`—, o `null` si no había ninguna (D-16.101).
     */
    basadaEn: z.uuid().nullable(),
    destino: DESTINO,
    locationId: z.uuid(),
    validFrom: z.iso.datetime(),
    nota: z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable(),
    lineas: z
      .array(
        z
          .object({
            itemId: z.uuid(),
            cantidad: decimalNoNegativo,
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
 * **ES `.strict()`, Y ESTE COMENTARIO EXPLICA POR QUE DEJO DE NO SERLO**
 * (P16-A2). Hasta aqui decia que era «la unica excepcion del proyecto» porque
 * un navegador puede anadir parametros de rastreo a una URL —`utm_source` y
 * companía— y rechazar la peticion por eso seria hostil sin ganar nada.
 *
 * El argumento era razonable y resulto ser dos cosas a la vez, las dos falsas:
 *
 *  1. **No era la unica excepcion: eran OCHO**, todas las `CONSULTA_*` del
 *     proyecto. Un comentario que dice «unica» y no lo es deja de avisar de
 *     nada, y mientras tanto `esquema.pipe.ts` afirmaba en su cabecera que
 *     «TODO esquema de este proyecto es `.strict()`». Dos archivos mintiendo en
 *     sentidos opuestos.
 *
 *  2. **`utm_source` no llega aqui.** Los parametros de rastreo los pega un
 *     enlace a una URL de PAGINA, que sirve `apps/web`; esto es una llamada
 *     `fetch` a la API, y la URL la construye el propio cliente carácter a
 *     carácter. Nadie le anade nada por el camino.
 *
 * Y lo que se ganaba tolerandolos era, en realidad, lo que se perdia: con el
 * modo laxo de Zod una clave de mas **se descarta en silencio y la respuesta es
 * 200**. `GET /analitica/resumen?...&companyId=<otra>` respondia con los datos
 * de la sesion y tiraba el `companyId` sin dejar rastro: el intento no fallaba,
 * se perdia. Es la asignacion masiva de SEGURIDAD.md §3 vista desde la
 * consulta, y la razon por la que TODO cuerpo ya era estricto.
 */
export const CONSULTA_DE_RECETA = z
  .object({
    locationId: z.uuid(),
    productId: z.uuid().optional(),
    itemId: z.uuid().optional(),
    fecha: z.iso.datetime().optional(),
  })
  .strict();

export type ConsultaDeReceta = z.infer<typeof CONSULTA_DE_RECETA>;

/**
 * El empaque de un producto (SPEC §14, ADR-008).
 *
 * `null` quita el empaque: el producto pasa a no llevar envase y su
 * `empaque_neto` es cero. Es un valor legitimo, no un campo ausente, y por eso
 * es `.nullable()` y no `.optional()`.
 */
export const CUERPO_DE_EMPAQUE = z
  .object({
    /** La versión del producto que se leyó (D-16.100). Si otra escritura llegó antes, 409. */
    version: z.int().min(1),
    empaqueItemId: z.uuid().nullable(),
  })
  .strict();

/**
 * La lista ENTERA de componentes de un combo (D-16.114). La cantidad es
 * estrictamente positiva: `combo_component_cantidad_positiva`.
 */
export const CUERPO_DE_COMPONENTES = z
  .object({
    /** La versión del producto que se leyó (D-16.100). Si otra escritura llegó antes, 409. */
    version: z.int().min(1),
    componentes: z
      .array(z.object({ productId: z.uuid(), cantidad: decimalPositivo }).strict())
      .max(COMPONENTES_MAXIMOS),
  })
  .strict();

export type CuerpoDeComponentes = z.infer<typeof CUERPO_DE_COMPONENTES>;

/** `GET /recetas/versiones`: lo mismo que la receta vigente, sin fecha. */
export const CONSULTA_DE_VERSIONES = CONSULTA_DE_RECETA.omit({ fecha: true }).strict();
export type ConsultaDeVersiones = z.infer<typeof CONSULTA_DE_VERSIONES>;

/** `GET /recetas/propagacion/previsualizacion`. Hasta P16-B, dos `@Query` sueltos sin esquema (D-16.111). */
export const CONSULTA_DE_PREVISUALIZACION = z.object({ productId: z.uuid(), origen: z.uuid() }).strict();
export type ConsultaDePrevisualizacion = z.infer<typeof CONSULTA_DE_PREVISUALIZACION>;

/** `GET /recetas/propagacion`. */
export const CONSULTA_DE_PROPAGACIONES = z.object({ productId: z.uuid() }).strict();
export type ConsultaDePropagaciones = z.infer<typeof CONSULTA_DE_PROPAGACIONES>;

/** `GET /productos/ubicaciones`: la carta de una ubicación. */
export const CONSULTA_DE_CARTA = z.object({ locationId: z.uuid() }).strict();
export type ConsultaDeCarta = z.infer<typeof CONSULTA_DE_CARTA>;

export type CuerpoDeEmpaque = z.infer<typeof CUERPO_DE_EMPAQUE>;

export type CuerpoDeProducto = z.infer<typeof CUERPO_DE_PRODUCTO>;
export type CuerpoDeUbicacion = z.infer<typeof CUERPO_DE_UBICACION>;
export type CuerpoDeReceta = z.infer<typeof CUERPO_DE_RECETA>;
export type CuerpoDePropagacion = z.infer<typeof CUERPO_DE_PROPAGACION>;
