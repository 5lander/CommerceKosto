/**
 * LA CONEXIÓN PRIVILEGIADA. El único sitio del sistema que puentea RLS.
 *
 * ============================================================================
 * ESTO ES LO MÁS PELIGROSO DEL REPOSITORIO. Léelo entero antes de tocarlo.
 * ============================================================================
 *
 * `costeo_backoffice` es `BYPASSRLS`: un `SELECT` suyo devuelve filas de TODOS
 * los tenants a la vez. No hay `current_company()`, no hay política que filtre,
 * no hay `TenantTransaction` que valga. La Barrera 1 —la única que no depende de
 * que nadie se equivoque— aquí no está.
 *
 * SPEC §1 lo eligió a sabiendas, por encima de la alternativa (una cuenta de
 * usuario dentro de cada tenant), y puso tres condiciones. Las tres están, y las
 * tres se verifican:
 *
 *   1. **Vive SOLO en el proceso del back office.** No es una convención: la
 *      regla `conexion-privilegiada-solo-en-backoffice` de `audit:forbidden`
 *      rompe el build si este archivo se importa desde fuera de su carpeta, y
 *      una prueba de integración comprueba sobre el contenedor de Nest ya
 *      construido que `AppModule` no lo tiene. Ver `backoffice.ts`.
 *   2. **Pool separado.** Otro proceso, otro `PrismaClient`, otra cadena de
 *      conexión (`BACKOFFICE_DATABASE_URL`) y como mucho cuatro conexiones,
 *      fijadas en el propio rol. No pasa por PgBouncer: mezclar la conexión
 *      privilegiada con el pooler de la aplicación es justo el cruce que la
 *      separación quiere impedir.
 *   3. **Registro append-only con motivo obligatorio.** Lo escribe el
 *      repositorio en la MISMA transacción que la lectura, y el rol no tiene
 *      `UPDATE` ni `DELETE` sobre esa tabla.
 *
 * Y UNA CUARTA QUE ESTE ARCHIVO AÑADE: **rechaza arrancar si la cadena no es la
 * del rol de back office.** Es el espejo de lo que `environment.ts` hace con
 * `costeo_app`. Sin esta comprobación, un `.env` mal copiado arrancaría el back
 * office con el rol de la aplicación —que no puede leer nada— o, mucho peor, con
 * el del migrador, que es dueño de las tablas.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../../generated/prisma';
import { ConexionConRolPropio } from '../../../shared/infrastructure/persistence/conexion-con-rol-propio';

/** El usuario que la cadena TIENE que traer. Cualquier otro aborta el arranque. */
const ROL_ESPERADO = 'costeo_backoffice';

const VARIABLE = 'BACKOFFICE_DATABASE_URL';

/** El cliente atado a una transacción, que es lo único que sale de aquí. */
export type ClienteDeBackoffice = Prisma.TransactionClient;

/** @throws {Error} si falta la variable o el usuario no es el del back office. */
function cadenaVerificada(): string {
  const cadena = process.env[VARIABLE];
  if (cadena === undefined || cadena.trim() === '') {
    throw new Error(`Falta ${VARIABLE}. El back office no arranca sin su propia conexión.`);
  }

  let usuario: string;
  try {
    usuario = decodeURIComponent(new URL(cadena).username);
  } catch {
    throw new Error(`${VARIABLE} no es una URL de conexión válida.`);
  }

  if (usuario !== ROL_ESPERADO) {
    throw new Error(
      `${VARIABLE} apunta al rol "${usuario}" y tiene que ser "${ROL_ESPERADO}". ` +
        'Arrancar el back office con otro rol es un error de configuración, no una variante.',
    );
  }

  return cadena;
}

/**
 * El pool y la transaccion por operacion los pone `ConexionConRolPropio`
 * (desde P16-A1, compartida con el despachador). Lo que sigue siendo de aqui
 * es la cuarta condicion: la cadena se verifica ANTES de construir el cliente.
 *
 * **`run` NO FIJA NINGÚN TENANT, y no es un olvido:** el rol puentea RLS, así
 * que `set_config('app.company_id', ...)` no cambiaría nada. Lo que sí
 * garantiza la transacción es lo que de verdad importa aquí: que la lectura
 * de datos de un cliente y el registro de por qué se leyó **ocurran o no
 * ocurran juntos**. Si el `INSERT` en `backoffice_access_log` falla, la
 * lectura se revierte y quien preguntó no ve nada.
 */
@Injectable()
export class BackofficeConnection extends ConexionConRolPropio {
  public constructor() {
    super(cadenaVerificada());
  }
}
