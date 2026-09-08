/**
 * El guard del back office: sin sesión de operador no pasa nada.
 *
 * **DENY BY DEFAULT.** Se registra como guard global del proceso, así que una
 * ruta nueva nace protegida y hay que marcarla `@Publico()` para abrirla. Al
 * revés —proteger ruta por ruta— la que se olvida queda abierta, y aquí lo que
 * queda abierto son todos los tenants a la vez.
 *
 * **NO HAY PERMISOS NI ROLES.** Un operador de back office puede lo que puede el
 * back office; no hay grados. Inventar niveles sin nadie a quien aplicárselos
 * sería la abstracción especulativa que OPTIMIZACION.md §1 prohíbe. El día que
 * haya dos clases de operador, se añade — con su tabla y su prueba.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  type CustomDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';

import { leerCookie } from '../../../iam/infrastructure/http/cookies';
import { ValidarSesionDeOperador, type OperadorActivo } from '../../application/casos-de-uso/sesion';

/** El nombre de la cookie. Distinto del de la app cliente, y a propósito. */
export const COOKIE_DE_OPERADOR = 'costeo_backoffice';

const SIN_SESION = 'backoffice.publico';

/** Marca una ruta como abierta. Hoy solo el login. */
export function PublicoEnBackoffice(): CustomDecorator {
  return SetMetadata(SIN_SESION, true);
}

/** Donde el controlador encuentra al operador ya validado. */
export interface PeticionConOperador extends IncomingMessage {
  operador?: OperadorActivo;
}

@Injectable()
export class OperadorGuard implements CanActivate {
  public constructor(
    private readonly validar: ValidarSesionDeOperador,
    private readonly reflector: Reflector,
  ) {}

  public async canActivate(contexto: ExecutionContext): Promise<boolean> {
    // `boolean | undefined` y no `boolean`: sin la marca no hay valor, y dejar
    // que el tipo lo diga evita el `any` que devuelve la firma por defecto.
    const abierta = this.reflector.getAllAndOverride<boolean | undefined>(SIN_SESION, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (abierta === true) return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionConOperador>();
    const token = leerCookie(peticion.headers.cookie, COOKIE_DE_OPERADOR);

    // `ValidarSesionDeOperador` lanza `SesionDeOperadorInvalidaError`, que el
    // filtro traduce a 401. Devolver `false` daría un 403 genérico y sin motivo.
    peticion.operador = await this.validar.ejecutar(token);
    return true;
  }
}
