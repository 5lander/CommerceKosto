/**
 * El decorador que entrega la sesion ya resuelta al manejador.
 *
 * Vive en `iam` y no en `shared` porque su tipo de retorno —`SesionActiva`— es
 * de este modulo. Los marcadores `@Publico()` y `@Requiere()`, que no dependen
 * de ningun tipo de negocio, viven en `shared/infrastructure/http/autorizacion`.
 */

import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import { SesionInvalidaError } from '../../domain/errores';
import { sesionDe } from './registro-de-sesiones';

/**
 * La sesion del que pregunta, puesta por `SesionGuard`.
 *
 * Que lance si no hay sesion no es defensivo por gusto: significa que un
 * manejador marcado `@Publico()` esta pidiendo una sesion que por definicion no
 * existe. Es un error de programacion y sale ruidoso en la primera prueba.
 */
export const SesionActual = createParamDecorator(
  (_datos: unknown, contexto: ExecutionContext): SesionActiva => {
    const sesion = sesionDe(contexto.switchToHttp().getRequest<IncomingMessage>());
    if (sesion === undefined) {
      throw new SesionInvalidaError('ausente');
    }
    return sesion;
  },
);
