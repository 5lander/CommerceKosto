/**
 * `/health` y `/ready` son DOS COSAS DISTINTAS, y confundirlas tiene un coste
 * concreto en produccion.
 *
 *   /health  (liveness)   ¿el proceso esta vivo? NO toca la base. Si mirara la
 *                         base, un corte de PostgreSQL haria que el orquestador
 *                         matara y reiniciara todas las replicas — que es
 *                         exactamente lo peor que puede pasar durante un corte
 *                         de base de datos.
 *
 *   /ready   (readiness)  ¿puede atender trafico? Si toca la base. Al fallar,
 *                         la replica sale del balanceador y vuelve sola cuando
 *                         la base responde. Nadie reinicia nada.
 *
 * Ninguna de las dos pasa por el limitador: las sondea el orquestador cada
 * pocos segundos y agotarian la cuota, dejando fuera de servicio justo la
 * senal que dice si hay servicio.
 *
 * TAMPOCO PASAN POR EL GUARD DE SESION, y por eso llevan `@Publico()`. Un
 * orquestador no tiene credenciales: una sonda de salud que exigiera sesion
 * devolveria 401, el orquestador leeria "no esta sana" y reiniciaria replicas
 * perfectamente sanas en bucle. Lo que devuelven —vivo o no, base accesible o
 * no— no es informacion que valga la pena proteger.
 */

import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthCheck, HealthCheckService, type HealthCheckResult } from '@nestjs/terminus';

import { Publico } from '../http/autorizacion';
import { DatabaseHealthIndicator } from './database.health';

@Publico()
@SkipThrottle()
@Controller()
export class HealthController {
  public constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
  ) {}

  @Get('health')
  @HealthCheck()
  public liveness(): Promise<HealthCheckResult> {
    return this.health.check([]);
  }

  @Get('ready')
  @HealthCheck()
  public readiness(): Promise<HealthCheckResult> {
    return this.health.check([() => this.database.check()]);
  }
}
