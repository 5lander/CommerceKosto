/**
 * El mismo token anti-CSRF, en el otro proceso — ADR-021.
 *
 * POR QUE EL BACK OFFICE TAMBIEN LO LLEVA, aunque su exposicion sea menor.
 * SEGURIDAD.md §4.2 pide «token CSRF en toda mutacion del panel», y este es el
 * panel con mas poder del sistema: cinco escrituras que cambian el plan o el
 * estado de cualquier company. Es cierto que hoy sus mutaciones son `fetch`
 * con `Content-Type: application/json` desde su propia pagina —que un sitio
 * cruzado no puede emitir sin un preflight que `cors: false` rechaza—, y que
 * escucha en loopback tras un tunel SSH. Pero las tres cosas que lo protegen
 * son PROPIEDADES ACCIDENTALES del despliegue de hoy: el dia que alguien sirva
 * un `<form method="post">` desde estas mismas rutas —un formulario HTML no
 * necesita preflight— la defensa desaparece sin que ningun check avise. El
 * token no depende de ninguna de esas tres.
 *
 * ES SU PROPIO GUARD Y NO EL DE `iam`: son dos procesos, dos contenedores de
 * inyeccion y dos sesiones que no deben tocarse (`OperadorGuard` explica por
 * que). Lo que SI se comparte es la comparacion en tiempo constante, que vive
 * una sola vez en `shared/infrastructure/http/csrf`.
 *
 * EL LOGIN QUEDA FUERA, como en la app cliente: `@PublicoEnBackoffice()` marca
 * las rutas sin sesion, y sin sesion no hay token que exigir. `POST /salir`
 * SI lo exige — cerrarle la sesion a alguien desde fuera es un ataque
 * pequeno, pero es un ataque, y exceptuarlo solo ahorraria una linea al
 * cliente.
 */

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CsrfInvalidoError } from '../../../../shared/domain/errors/csrf-invalido';
import {
  esElMismoToken,
  esMutacion,
  tokenDeLaCabecera,
} from '../../../../shared/infrastructure/http/csrf';
import { SesionDeOperadorInvalidaError } from '../../domain/errores';
import { CLAVE_SIN_SESION, type PeticionConOperador } from './operador.guard';

@Injectable()
export class CsrfDeOperadorGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<PeticionConOperador>();
    if (!esMutacion(peticion.method)) return true;

    const abierta = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_SIN_SESION, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (abierta === true) return true;

    const operador = peticion.operador;
    if (operador === undefined) throw new SesionDeOperadorInvalidaError('ausente');

    const recibido = tokenDeLaCabecera(peticion);
    if (recibido === null) throw new CsrfInvalidoError('ausente');
    if (!esElMismoToken(operador.csrfToken, recibido)) throw new CsrfInvalidoError('no_coincide');

    return true;
  }
}
