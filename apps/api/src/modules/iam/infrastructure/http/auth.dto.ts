/**
 * Los esquemas del limite HTTP de autenticacion.
 *
 * TODOS SON `.strict()`. Un cuerpo con una clave de mas se RECHAZA, no se
 * limpia en silencio: `{"email":"...","contrasena":"...","companyId":"otra"}`
 * devuelve 400 y queda registrado. Es la diferencia entre enterarse de que
 * alguien esta probando asignacion masiva y no enterarse nunca.
 *
 * NINGUNO ACEPTA `companyId`, Y NO ES UN OLVIDO: es la Barrera 3 escrita en el
 * esquema. El tenant sale de la sesion. Con `.strict()`, mandarlo no es
 * ignorado — es un error.
 */

import { z } from 'zod';

import { LARGO_MAXIMO } from '../../domain/politica-de-contrasenas';

/** Limite de RFC 5321 para una direccion completa. */
const LARGO_MAXIMO_DE_CORREO = 254;

/**
 * En el LOGIN la contrasena solo se acota por arriba.
 *
 * Exigir aqui el largo minimo de la politica seria decirle a quien prueba que
 * las contrasenas de este sistema tienen al menos doce caracteres, y le
 * ahorraria descartar el resto del diccionario. El unico limite que importa en
 * este punto es el de arriba: sin el, una peticion de un megabyte obligaria a
 * hashearla y eso es una denegacion de servicio contra la CPU.
 */
export const CUERPO_DE_LOGIN = z
  .object({
    email: z.email().max(LARGO_MAXIMO_DE_CORREO),
    contrasena: z.string().min(1).max(LARGO_MAXIMO),
  })
  .strict();

export const CUERPO_DE_CAMBIO_DE_CONTRASENA = z
  .object({
    email: z.email().max(LARGO_MAXIMO_DE_CORREO),
    actual: z.string().min(1).max(LARGO_MAXIMO),
    nueva: z.string().min(1).max(LARGO_MAXIMO),
  })
  .strict();

export type CuerpoDeLogin = z.infer<typeof CUERPO_DE_LOGIN>;
export type CuerpoDeCambioDeContrasena = z.infer<typeof CUERPO_DE_CAMBIO_DE_CONTRASENA>;
