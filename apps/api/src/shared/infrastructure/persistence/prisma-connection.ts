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

import { PrismaClient } from '../../../../generated/prisma';
import { CONFIGURATION, type Configuration } from '../config/environment';

@Injectable()
export class PrismaConnection implements OnModuleDestroy {
  public readonly client: PrismaClient;

  public constructor(@Inject(CONFIGURATION) config: Configuration) {
    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.databaseUrl }),
    });
  }

  public async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
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
    await this.client.$queryRaw`SELECT 1`;
  }
}
