/**
 * Los esquemas del back office. **Todos `.strict()`**, como el resto del sistema.
 *
 * **EL MOTIVO ES UNA CABECERA, NO UN CAMPO DEL CUERPO.** Tres razones, y la
 * tercera es la que decide:
 *
 *   1. Acompaña a `GET` tanto como a `POST`, y un `GET` no lleva cuerpo.
 *   2. Es transversal: no pertenece a los datos de ninguna operación concreta,
 *      igual que la autenticación no pertenece al cuerpo del login.
 *   3. **Sale en el log de acceso del proxy sin tocar nada más.** Cuando algo va
 *      mal, el registro de la aplicación y el del servidor cuentan lo mismo, y
 *      no hay que cruzar dos fuentes que podrían discrepar.
 *
 * **EL MOTIVO NO PASA POR UN ESQUEMA, y es deliberado.** Lo juzga
 * `exigirMotivoSuficiente`, que sabe decir cuántos caracteres faltan; un `min(1)`
 * de Zod contestaría «(cuerpo): Too small», mencionando un cuerpo que no existe
 * y sin decir qué poner. Un control que se explica mal se rodea. El máximo lo
 * pone el mismo dominio, y por debajo el `CHECK` de la base (INC-012).
 */

import { z } from 'zod';

/** El maximo de un correo segun RFC 5321, y el que el CHECK de la base exige. */
const LARGO_DE_CORREO = 254;

/**
 * Tope alto y a proposito: la contrasena se hashea, no se guarda. Existe solo
 * para que nadie mande un megabyte a Argon2 y lo use de ariete.
 */
const LARGO_DE_CONTRASENA = 1024;

const NOMBRE_MINIMO = 2;
const NOMBRE_MAXIMO = 200;

/** La cabecera que lleva el motivo de todo acceso cross-tenant. */
export const CABECERA_DE_MOTIVO = 'x-motivo';

const CORREO = z.email().trim().toLowerCase().max(LARGO_DE_CORREO);

export const CUERPO_DE_LOGIN_DE_OPERADOR = z
  .object({
    email: CORREO,
    contrasena: z.string().min(1).max(LARGO_DE_CONTRASENA),
  })
  .strict();

export type CuerpoDeLoginDeOperador = z.infer<typeof CUERPO_DE_LOGIN_DE_OPERADOR>;

export const CUERPO_DE_NUEVA_COMPANY = z
  .object({
    nombre: z.string().trim().min(NOMBRE_MINIMO).max(NOMBRE_MAXIMO),
    plan: z.enum(['BASICO', 'PROFESIONAL', 'CADENA']),
    emailDelDueno: CORREO,
  })
  .strict();

export type CuerpoDeNuevaCompany = z.infer<typeof CUERPO_DE_NUEVA_COMPANY>;

export const CUERPO_DE_CAMBIO_DE_PLAN = z
  .object({ plan: z.enum(['BASICO', 'PROFESIONAL', 'CADENA']) })
  .strict();

export type CuerpoDeCambioDePlan = z.infer<typeof CUERPO_DE_CAMBIO_DE_PLAN>;

/**
 * `CLOSED` no está, y no es un olvido: cerrar una company tiene consecuencias de
 * retención de datos que este paquete no resuelve. Mejor no ofrecerlo que
 * ofrecerlo a medias.
 */
export const CUERPO_DE_CAMBIO_DE_ESTADO = z
  .object({ estado: z.enum(['ACTIVE', 'SUSPENDED']) })
  .strict();

export type CuerpoDeCambioDeEstado = z.infer<typeof CUERPO_DE_CAMBIO_DE_ESTADO>;
