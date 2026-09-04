/**
 * Esquemas del limite HTTP de organizacion. Todos `.strict()`.
 *
 * NINGUNO ACEPTA `companyId`. En estos endpoints la tentacion es real —"crear
 * una ubicacion PARA la company X"— y es exactamente la Barrera 3: el tenant
 * sale de la sesion. Con `.strict()`, mandarlo devuelve 400.
 *
 * `locationId` ES `nullable` Y NO `optional`, y la diferencia importa: obliga a
 * DECIR que no hay ubicacion en vez de omitirla. Un campo omitido y un campo
 * nulo se confunden al leer el codigo; aqui asignar `ADMIN` exige escribir
 * `"locationId": null`, y eso hace visible en la propia peticion que el rol es
 * de nivel company.
 */

import { z } from 'zod';

import { LARGO_MAXIMO } from '../../domain/politica-de-contrasenas';

const LARGO_MAXIMO_DE_CORREO = 254;
const LARGO_MAXIMO_DE_NOMBRE = 200;

export const CUERPO_DE_UBICACION = z
  .object({
    nombre: z.string().trim().min(1).max(LARGO_MAXIMO_DE_NOMBRE),
    tipo: z.enum(['BODEGA', 'LOCAL', 'AMBOS']),
  })
  .strict();

export const CUERPO_DE_INVITACION = z
  .object({ email: z.email().max(LARGO_MAXIMO_DE_CORREO) })
  .strict();

export const CUERPO_DE_ACTIVACION = z
  .object({
    token: z.string().min(1).max(LARGO_MAXIMO_DE_CORREO),
    contrasena: z.string().min(1).max(LARGO_MAXIMO),
  })
  .strict();

export const CUERPO_DE_ROL = z
  .object({
    userId: z.uuid(),
    rol: z.string().min(1).max(LARGO_MAXIMO_DE_NOMBRE),
    locationId: z.uuid().nullable(),
  })
  .strict();

export type CuerpoDeUbicacion = z.infer<typeof CUERPO_DE_UBICACION>;
export type CuerpoDeInvitacion = z.infer<typeof CUERPO_DE_INVITACION>;
export type CuerpoDeActivacion = z.infer<typeof CUERPO_DE_ACTIVACION>;
export type CuerpoDeRol = z.infer<typeof CUERPO_DE_ROL>;
