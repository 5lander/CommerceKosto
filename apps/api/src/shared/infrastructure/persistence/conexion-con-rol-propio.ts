/**
 * Un `PrismaClient` propio para un proceso que NO es la aplicacion cliente.
 *
 * DOS PROCESOS LO EXTIENDEN, y solo dos: el back office (`costeo_backoffice`,
 * BYPASSRLS, ADR-017) y el despachador de correo (`costeo_despachador`, sin
 * bypass y con dos tablas, ADR-025). Los dos necesitan lo mismo: un pool
 * aparte del de la aplicacion, una cadena de conexion que no es
 * `DATABASE_URL`, y una transaccion por operacion. Antes vivia entero en
 * `backoffice-connection.ts`; la segunda copia habria sido un clon, y un clon
 * de la pieza que decide con que rol se habla con la base es la ultima
 * duplicacion que conviene tener.
 *
 * NO FIJA NINGUN TENANT, y no es un olvido: el rol del back office puentea
 * RLS, y el del despachador ve sus dos tablas por politica permisiva. Ninguno
 * de los dos tiene un `company_id` que fijar. Lo que si garantiza la
 * transaccion es que lo que cada proceso hace por operacion —leer y dejar
 * rastro; reservar y marcar— ocurra o no ocurra junto.
 *
 * VIVE EN `persistence/` porque es de los pocos archivos autorizados a
 * construir un `PrismaClient` (`prisma-client-solo-en-persistence`). Quien lo
 * extiende no lo construye: recibe la cadena ya verificada por su esquema de
 * entorno o por su propia comprobacion de rol, y la pasa.
 */

import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { type Prisma, PrismaClient } from '../../../../generated/prisma';

export abstract class ConexionConRolPropio implements OnModuleDestroy {
  private readonly cliente: PrismaClient;

  protected constructor(cadenaDeConexion: string) {
    this.cliente = new PrismaClient({
      adapter: new PrismaPg({ connectionString: cadenaDeConexion }),
    });
  }

  /** Ejecuta el trabajo en una transaccion, sin tenant (ver la cabecera). */
  public async run<T>(trabajo: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.cliente.$transaction(async (tx) => trabajo(tx));
  }

  public async onModuleDestroy(): Promise<void> {
    await this.cliente.$disconnect();
  }
}
