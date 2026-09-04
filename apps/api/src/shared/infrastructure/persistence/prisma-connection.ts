/**
 * EL UNICO ARCHIVO DEL PROYECTO AUTORIZADO A CONSTRUIR UN `PrismaClient`.
 *
 * En P1, cuando exista la capa de transaccion-con-tenant (Barrera 2,
 * CLAUDE.md §4.1), `audit:forbidden` gana la regla que prohibe importar el
 * cliente crudo fuera de ella y este archivo pasa a ser su interior. Hoy la
 * restriccion ya se sostiene por construccion: nadie mas lo instancia.
 *
 * LA CADENA LLEGA POR PARAMETRO, NO POR `process.env`. El cliente generado no
 * lleva ningun nombre de variable de entorno embebido, y el CLI de Prisma usa
 * el suyo propio (`prisma.config.ts`, `MIGRATION_DATABASE_URL`). Son dos
 * caminos que no se cruzan: no hay forma de que el proceso de la aplicacion
 * acabe conectandose como `costeo_migrator` por un descuido de configuracion.
 * El esquema de entorno ademas RECHAZA el arranque si el usuario de
 * `DATABASE_URL` no es `costeo_app`.
 */

import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { type Prisma, PrismaClient } from '../../../../generated/prisma';
import { CONFIGURATION, type Configuration } from '../config/environment';

/**
 * El cliente atado a una transaccion, que es lo unico que `TenantTransaction`
 * entrega al resto del sistema. No expone `$transaction` ni `$connect`: solo
 * los modelos.
 */
export type ClienteDeTransaccion = Prisma.TransactionClient;

@Injectable()
export class PrismaConnection implements OnModuleDestroy {
  /**
   * Se llama `rawClient` y no `client` A PROPOSITO: la regla
   * `cliente-crudo-solo-en-la-capa-de-tenant` de `audit:forbidden` busca
   * exactamente esa palabra y falla si aparece fuera de esta carpeta. Un nombre
   * generico como `client` produciria falsos positivos por todo el repositorio
   * y la regla acabaria relajada.
   *
   * Usarlo directamente SALTA LA BARRERA 2: la consulta correria sin tenant
   * fijado y devolveria cero filas. Todo acceso a datos va por
   * `TenantTransaction`.
   */
  public readonly rawClient: PrismaClient;

  public constructor(@Inject(CONFIGURATION) config: Configuration) {
    this.rawClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.rawClient.$disconnect();
  }

  /**
   * Sonda de disponibilidad para `/ready`.
   *
   * Se elige la consulta mas barata que aun demuestra lo que importa: que hay
   * conexion viva y que el rol puede ejecutar. Un `SELECT count(*)` sobre una
   * tabla real cargaria la base en cada sondeo del orquestador, que en
   * Kubernetes es cada pocos segundos y para siempre.
   */
  public async ping(): Promise<void> {
    await this.rawClient.$queryRaw`SELECT 1`;
  }
}
