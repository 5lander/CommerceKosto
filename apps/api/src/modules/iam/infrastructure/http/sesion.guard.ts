/**
 * BARRERA 3, cableada — CLAUDE.md §4.1.
 *
 * DENY BY DEFAULT. Esta registrado como `APP_GUARD`, asi que corre en TODA
 * ruta de la aplicacion: las que existen hoy, las que se anadan en P2, y la que
 * alguien anada un viernes por la tarde sin acordarse de protegerla. Solo se
 * salta donde hay un `@Publico()` explicito, y esa lista se lee de un vistazo:
 *
 *   grep -rn "@Publico" apps/api/src
 *
 * NO ACEPTA `Authorization: Bearer`, SOLO LA COOKIE. Admitir las dos vias
 * duplicaria la superficie y, sobre todo, reabriria el CSRF que
 * `SameSite=Strict` cierra: una cabecera la pone quien hace la peticion, y eso
 * permite montar el ataque desde otro sitio. Cuando exista un cliente que no
 * sea navegador se decidira entonces, con su caso delante.
 *
 * EL TENANT NO SE LEE DE NINGUN SITIO MAS. Ningun endpoint acepta `company_id`;
 * el que sale de aqui es el unico que existe en la peticion.
 */

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';

import { ValidarSesion } from '../../application/casos-de-uso/validar-sesion';
import { CLAVE_PUBLICO } from '../../../../shared/infrastructure/http/autorizacion';
import { COOKIE_DE_SESION, leerCookie } from './cookies';
import { guardarSesion } from './registro-de-sesiones';

@Injectable()
export class SesionGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly validarSesion: ValidarSesion,
  ) {}

  public async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const publico = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico === true) {
      return true;
    }

    const peticion = contexto.switchToHttp().getRequest<IncomingMessage>();
    const token = leerCookie(peticion.headers.cookie, COOKIE_DE_SESION);

    // `ejecutar` lanza `SesionInvalidaError` —que sale como 401— en vez de
    // devolver `false`. La diferencia importa: `false` produce el 403 generico
    // de Nest, que dice "no puedes" cuando lo cierto es "no se quien eres".
    guardarSesion(peticion, await this.validarSesion.ejecutar(token));

    return true;
  }
}
