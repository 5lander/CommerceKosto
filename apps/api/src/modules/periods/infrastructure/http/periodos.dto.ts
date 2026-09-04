/**
 * El límite HTTP de períodos. Todos los esquemas `.strict()`.
 *
 * **NINGÚN CUERPO ACEPTA FECHAS DE FRONTERA.** Se pide el mes —año y número— y
 * las convierte en instantes el servidor, con la zona de `config/periods.ts`.
 * Dejar que el cliente mandara `starts_at` sería dejarle definir qué
 * movimientos quedan dentro del mes que se sella.
 *
 * **`motivo` ES OBLIGATORIO AL REABRIR.** Reabrir un mes permite mover cifras
 * ya informadas, y el evento `period.reopened` de `audit_log` sin un porqué es
 * un rastro que no sirve para auditar nada.
 */

import { z } from 'zod';

const LARGO_MINIMO_DE_MOTIVO = 3;
const LARGO_MAXIMO_DE_MOTIVO = 500;

export const CONSULTA_DE_PERIODOS = z.object({ locationId: z.uuid() });

export const CUERPO_DE_REAPERTURA = z
  .object({
    motivo: z.string().trim().min(LARGO_MINIMO_DE_MOTIVO).max(LARGO_MAXIMO_DE_MOTIVO),
  })
  .strict();

export type ConsultaDePeriodos = z.infer<typeof CONSULTA_DE_PERIODOS>;
export type CuerpoDeReapertura = z.infer<typeof CUERPO_DE_REAPERTURA>;

export interface PeriodoDto {
  readonly id: string;
  readonly locationId: string;
  readonly anio: number;
  readonly mes: number;
  /** `2026-03`. Es lo que se enseña y lo que aparece en los errores. */
  readonly etiqueta: string;
  readonly inicioEn: string;
  readonly finEn: string;
  readonly estado: string;
  readonly cerradoEn: string | null;
  readonly cerradoPor: string | null;
  readonly reabiertoEn: string | null;
  readonly reabiertoPor: string | null;
}
