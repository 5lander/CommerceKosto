/**
 * LA CONEXION DEL DESPACHADOR. El espejo de `backoffice-connection.ts`, con
 * un rol que ve dos tablas (D-16.23, ADR-025).
 *
 * `costeo_despachador` NO es BYPASSRLS: lo que ve —`email_outbox` entera y la
 * columna `at` de `rate_limit_hit`— lo ve por politica permisiva y GRANT
 * explicito, y sobre `app_user`, `company`, `password_reset_token` y el resto
 * no tiene ni `SELECT`. Aun asi vive en su PROPIO proceso, con su propio pool
 * de dos conexiones y su propia cadena, por la misma razon que el back office:
 * la aplicacion cliente no debe poder marcar un correo como enviado ni borrar
 * un golpe del limite de tasa, y la forma de que no pueda es que no tenga el
 * rol que si puede. Tres cosas lo hacen cumplir:
 *
 *   1. `audit:forbidden` (`correo.rules.mjs`): esta clase, la variable
 *      `DESPACHADOR_DATABASE_URL` y `CorreoModule` no se nombran fuera de
 *      `modules/correo/`, `despachador.ts` y las suites `correo*.spec.ts`.
 *   2. `audit:arch`: ninguna arista entra en `modules/correo/` desde la
 *      aplicacion ni desde otro modulo.
 *   3. Una prueba de integracion construye `AppModule` de verdad y comprueba
 *      que esta clase no esta en su contenedor.
 *
 * LA CADENA LLEGA YA VERIFICADA por el esquema del proceso
 * (`entorno-del-despachador.ts`), que rechaza en el campo cualquier usuario que
 * no sea `costeo_despachador`: es lo que `PrismaConnection` hace con
 * `DATABASE_URL`, y no lo que hace el back office, que la lee y verifica aqui
 * porque no tiene esquema. Un solo sitio que decide, no dos que se repiten.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma';
import { ConexionConRolPropio } from '../../../shared/infrastructure/persistence/conexion-con-rol-propio';
import { CONFIGURACION_DEL_DESPACHADOR, type ConfiguracionDelDespachador } from './entorno-del-despachador';

/** El cliente atado a una transaccion, que es lo unico que sale de aqui. */
export type ClienteDelDespachador = Prisma.TransactionClient;

@Injectable()
export class DespachadorConnection extends ConexionConRolPropio {
  public constructor(@Inject(CONFIGURACION_DEL_DESPACHADOR) config: ConfiguracionDelDespachador) {
    super(config.databaseUrl);
  }
}
