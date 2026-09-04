/**
 * BARRERA 2 de CLAUDE.md §4.1 — la capa de transaccion-con-tenant.
 *
 * ES EL UNICO SITIO DEL PROYECTO QUE PUEDE TOCAR EL CLIENTE CRUDO. La regla
 * `cliente-crudo-solo-en-la-capa-de-tenant` de `audit:forbidden` lo hace
 * cumplir: fuera de aqui, la palabra `rawClient` rompe el build.
 *
 * POR QUE HACE FALTA ESTA CAPA. RLS necesita que el tenant este fijado en la
 * SESION que ejecuta la consulta, y el ORM usa un pool: la conexion que atiende
 * una consulta no es previsible. Un `SET` suelto se aplicaria a una conexion
 * cualquiera y la consulta podria correr en otra. Por eso el tenant se fija con
 * `set_config(..., TRUE)` —el `TRUE` significa "local a la transaccion"— DENTRO
 * de la misma transaccion interactiva que ejecuta el trabajo. Al terminar, el
 * valor desaparece con la transaccion y la conexion vuelve al pool limpia.
 *
 * QUE PASA SI ALGUIEN SE SALTA ESTA CAPA. No hay fuga: hay cero filas. Sin
 * tenant fijado, `current_company()` devuelve NULL, `company_id = NULL` es NULL,
 * y NULL no es TRUE, asi que ninguna fila pasa el filtro. Es deliberado que el
 * fallo sea ruidoso y vacio en vez de silencioso y ajeno. Hay una prueba de
 * integracion que lo fija.
 *
 * NOTA SOBRE `no-sql-interpolado`. `SET LOCAL` no admite parametros —es un
 * comando de sesion, no una consulta—, asi que la unica forma de fijar el
 * tenant de manera parametrizada es `set_config()` dentro de un `$executeRaw`
 * con plantilla ETIQUETADA, que Prisma convierte en `$1`, `$2` y manda los
 * valores aparte. En P0 el escaner no sabia distinguir esa plantilla de una
 * concatenacion peligrosa y este archivo llevaba una exencion; en P1 la regla
 * aprendio a distinguirla y la exencion se retiro. Lo que lo demuestra sigue
 * siendo una prueba de integracion: un identificador con comillas y `--`
 * dentro no escapa de su parametro.
 */

import { Injectable } from '@nestjs/common';

import type { CompanyId } from '../../domain/identity/identificadores';
import { PrismaConnection, type ClienteDeTransaccion } from './prisma-connection';

/** Nombre del ajuste de sesion sobre el que se apoyan todas las politicas RLS. */
const AJUSTE_DE_TENANT = 'app.company_id';

@Injectable()
export class TenantTransaction {
  public constructor(private readonly connection: PrismaConnection) {}

  /**
   * Ejecuta `trabajo` en una transaccion con el tenant fijado.
   *
   * Todo acceso a datos de negocio pasa por aqui. El cliente que recibe el
   * trabajo esta atado a esa transaccion: no hay forma de usarlo fuera.
   */
  public async run<T>(
    company: CompanyId,
    trabajo: (tx: ClienteDeTransaccion) => Promise<T>,
  ): Promise<T> {
    return this.connection.rawClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config(${AJUSTE_DE_TENANT}, ${company}, TRUE)`;
      return trabajo(tx);
    });
  }

  /**
   * Ejecuta `trabajo` SIN tenant, para las poquisimas operaciones que
   * legitimamente no lo tienen.
   *
   * `motivo` es obligatorio y no es decorativo: obliga a justificar cada uso en
   * el sitio, y hace que `grep runWithoutTenant` devuelva la lista completa de
   * excepciones con su razon al lado. Hoy son dos: el login, que ocurre antes
   * de saber el tenant, y los eventos de auditoria de sistema.
   *
   * Sigue siendo una transaccion: lo que no lleva es tenant. Las politicas RLS
   * siguen activas, asi que lo unico visible es lo que alguna politica permita
   * sin tenant — los catalogos y `login_attempt`.
   */
  public async runWithoutTenant<T>(
    motivo: string,
    trabajo: (tx: ClienteDeTransaccion) => Promise<T>,
  ): Promise<T> {
    void motivo;
    return this.connection.rawClient.$transaction(async (tx) => trabajo(tx));
  }
}
