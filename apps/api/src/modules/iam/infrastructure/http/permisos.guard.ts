/**
 * Autorizacion por capacidades — SPEC §4, CLAUDE.md §4.4.
 *
 * CORRE DESPUES DEL DE SESION Y ES TAMBIEN GLOBAL. Una ruta sin `@Requiere(...)`
 * no exige ninguna capacidad concreta, pero ya paso por el guard de sesion: el
 * minimo de toda la API es "estar autenticado". Esto es deliberado y no es un
 * agujero: la mayoria de las lecturas de una company las puede hacer cualquiera
 * de sus miembros, y exigir un permiso inventado para cada una convertiria el
 * catalogo de permisos en ruido que nadie revisa.
 *
 * LO QUE ESTE GUARD NO HACE, Y CONVIENE TENER CLARO: comprueba que el usuario
 * PUEDE hacer la operacion, no que pueda hacerla SOBRE ESE RECURSO. La
 * pertenencia a la company la garantiza RLS; la pertenencia a la ubicacion la
 * comprueba cada caso de uso con `sesion.alcance`, porque solo el caso de uso
 * sabe cual es la ubicacion afectada. Un guard que intentara adivinarla desde
 * la URL acertaria hoy y fallaria en silencio en cuanto una ruta cambiara.
 */

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';

import { CLAVE_PERMISOS } from '../../../../shared/infrastructure/http/autorizacion';
import { PermisoDenegadoError, SesionInvalidaError } from '../../domain/errores';
import { sesionDe } from './registro-de-sesiones';

@Injectable()
export class PermisosGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(contexto: ExecutionContext): boolean {
    const exigidos = this.reflector.getAllAndOverride<readonly string[] | undefined>(CLAVE_PERMISOS, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (exigidos === undefined || exigidos.length === 0) {
      return true;
    }

    const sesion = sesionDe(contexto.switchToHttp().getRequest<IncomingMessage>());
    if (sesion === undefined) {
      // Un `@Requiere(...)` sobre una ruta `@Publico()`. Es una contradiccion
      // del programador, y se resuelve por el lado seguro.
      throw new SesionInvalidaError('ausente');
    }

    const faltante = exigidos.find((permiso) => !sesion.permisos.includes(permiso));
    if (faltante !== undefined) {
      throw new PermisoDenegadoError(faltante);
    }

    return true;
  }
}
