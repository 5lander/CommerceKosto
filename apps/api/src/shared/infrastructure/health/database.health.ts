/**
 * Sonda de base de datos para `/ready`.
 *
 * SE ESCRIBE EN VEZ DE USAR EL `PrismaHealthIndicator` DE TERMINUS por dos
 * razones concretas: el de terminus llama a `$queryRawUnsafe`, que
 * `audit:forbidden` prohibe en este repositorio (SEGURIDAD.md §1.1), y espera
 * recibir el cliente crudo, que solo `PrismaConnection` tiene derecho a tocar.
 * Son quince lineas frente a dos excepciones a reglas que existen por algo.
 */

import { Injectable } from '@nestjs/common';
import { HealthIndicatorService, type HealthIndicatorResult } from '@nestjs/terminus';

import { PrismaConnection } from '../persistence/prisma-connection';

const CLAVE = 'database';

@Injectable()
export class DatabaseHealthIndicator {
  public constructor(
    private readonly indicator: HealthIndicatorService,
    private readonly connection: PrismaConnection,
  ) {}

  public async check(): Promise<HealthIndicatorResult<typeof CLAVE>> {
    const sesion = this.indicator.check(CLAVE);
    try {
      await this.connection.ping();
      return sesion.up();
    } catch {
      // El motivo NO sale en la respuesta: `/ready` es una ruta sin autenticar
      // y el error de conexion lleva host, puerto, base y a veces usuario. Que
      // este caida ya es toda la informacion que el orquestador necesita.
      return sesion.down();
    }
  }
}
