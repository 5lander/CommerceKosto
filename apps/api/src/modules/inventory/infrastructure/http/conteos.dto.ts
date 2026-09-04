/**
 * El límite HTTP del conteo físico. Todos los esquemas `.strict()`.
 *
 * **HAY DOS REPRESENTACIONES DEL MISMO CONTEO, Y ES LA REGLA DE §4.3 HECHA
 * TIPO.** `ConteoBasicoDto` es lo que ve quien cuenta: estado, período y
 * fechas. `ConciliacionDto` añade el stock teórico, la diferencia y su
 * valorización, y solo se construye en el endpoint que exige `count.read`.
 *
 * Que sean dos **interfaces** y no una con campos opcionales es deliberado: con
 * una sola, añadir un campo la semana que viene lo publicaría en los dos sitios
 * sin que nada avisara. Aquí el compilador obliga a decidir en cuál va.
 *
 * **LA CANTIDAD CONTADA ADMITE SIGNO EN EL ESQUEMA**, y no por descuido. Si el
 * esquema lo rechazara, el mensaje sería «debe ser una cantidad positiva»;
 * dejándolo pasar, lo rechaza el dominio con el que de verdad ayuda: «si no
 * había nada, la cantidad es cero». La restricción de la base está igual, y la
 * guarda de dominio es la que evita que salga como 500 (INC-012).
 */

import { z } from 'zod';

const PRIMER_MES = 1;
const ULTIMO_MES = 12;
const PRIMER_ANIO = 2000;
const ULTIMO_ANIO = 2100;
const LARGO_MAXIMO_DE_DECIMAL = 40;
const LARGO_MAXIMO_DE_NOTA = 500;
/** Un catálogo grande de una ubicación, con margen. */
const MAXIMO_DE_LINEAS = 2000;

const decimal = z
  .string()
  .max(LARGO_MAXIMO_DE_DECIMAL)
  .regex(/^-?\d+(\.\d+)?$/u, 'debe ser un decimal en notación normal, por ejemplo "2.30"');

export const CUERPO_DE_CONTEO = z
  .object({
    locationId: z.uuid(),
    anio: z.number().int().min(PRIMER_ANIO).max(ULTIMO_ANIO),
    mes: z.number().int().min(PRIMER_MES).max(ULTIMO_MES),
    note: z.string().trim().max(LARGO_MAXIMO_DE_NOTA).nullable(),
  })
  .strict();

export const CUERPO_DE_LINEAS = z
  .object({
    lineas: z
      .array(z.object({ itemId: z.uuid(), cantidad: decimal }).strict())
      .max(MAXIMO_DE_LINEAS),
  })
  .strict();

export const CONSULTA_DE_CONTEOS = z.object({ locationId: z.uuid() });

export type CuerpoDeConteo = z.infer<typeof CUERPO_DE_CONTEO>;
export type CuerpoDeLineas = z.infer<typeof CUERPO_DE_LINEAS>;
export type ConsultaDeConteos = z.infer<typeof CONSULTA_DE_CONTEOS>;

/**
 * El conteo tal como lo ve quien cuenta.
 *
 * **NO LLEVA NINGUNO DE LOS TRES VALORES.** `valorTeorico` es stock teórico
 * valorizado y `valorFisico` sale de restarle la diferencia: los dos están en
 * la lista de campos prohibidos de CLAUDE.md §4.3.
 */
export interface ConteoBasicoDto {
  readonly id: string;
  readonly locationId: string;
  readonly anio: number;
  readonly mes: number;
  readonly etiqueta: string;
  readonly estado: string;
  readonly corteEn: string;
  readonly creadoEn: string;
  readonly confirmadoEn: string | null;
  readonly note: string | null;
}

/** Una fila de la hoja: qué contar y qué se lleva anotado. Nada más. */
export interface FilaDeHojaDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly cantidad: string | null;
}

export interface HojaDeConteoDto {
  readonly conteo: ConteoBasicoDto;
  readonly filas: readonly FilaDeHojaDto[];
}

export interface FilaConciliadaDto {
  readonly itemId: string;
  readonly nombre: string;
  readonly unidadDeUso: string;
  readonly contado: string | null;
  readonly teorico: string;
  readonly diferencia: string | null;
  readonly valorDeDiferencia: string | null;
  /** Un cero aquí significa «este ítem no tiene precio confirmado». */
  readonly costoUnitario: string;
}

export interface ConciliacionDto {
  readonly conteo: ConteoBasicoDto;
  readonly filas: readonly FilaConciliadaDto[];
  readonly valorTeorico: string;
  readonly valorCubierto: string;
  readonly valorFisico: string;
  /** `null` cuando no había nada que verificar. No es «0 %». */
  readonly cobertura: string | null;
  readonly comprasDelPeriodo: string;
  readonly valorInicial: string | null;
  readonly consumoReal: string | null;
}

/** Lo único que devuelve una creación. */
export interface RegistroDeConteoDto {
  readonly id: string;
}
