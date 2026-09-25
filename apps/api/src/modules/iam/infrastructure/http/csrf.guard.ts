/**
 * El token anti-CSRF, exigido en TODA mutacion de la app cliente — U4, ADR-021.
 *
 * ES GLOBAL, COMO LOS OTROS DOS, Y CORRE ENTRE ELLOS: `SesionGuard` resuelve
 * quien pregunta, este comprueba que la peticion la origino de verdad la
 * pagina de la aplicacion, y `PermisosGuard` decide si puede. Ese orden no es
 * estetico: sin sesion no hay token con el que comparar, y comprobar permisos
 * de una peticion que ni siquiera es del usuario seria autorizar un ataque
 * antes de rechazarlo.
 *
 * LO QUE QUEDA FUERA, Y POR QUE NO ES UN AGUJERO:
 *
 *   metodos seguros    `GET`, `HEAD` y `OPTIONS`. Un CSRF sirve para provocar
 *                      un EFECTO; el sitio cruzado no puede leer la respuesta,
 *                      asi que un `GET` no le da nada. Exigir token ahi
 *                      romperia toda la navegacion sin cerrar nada.
 *
 *   rutas `@Publico()` login, activacion, olvido y restablecimiento. En TRES
 *                      de ellas no hay sesion que proteger: no hay cookie,
 *                      luego el navegador no adjunta ninguna credencial, luego
 *                      el sitio cruzado no consigue actuar EN NOMBRE DE NADIE
 *                      —lo unico que lograria es una peticion que cualquiera
 *                      hace con `curl`—. Lo que las protege del abuso es el
 *                      limite de tasa (ADR-026), que es su problema real. Y
 *                      exigirles token seria imposible: nace CON la sesion.
 *
 *                      EL LOGIN NO ES UNA DE LAS TRES, y decir que si lo era
 *                      fue el error de la primera version de este comentario:
 *                      una peticion cruzada al login no USA una credencial, la
 *                      CREA. `SameSite` gobierna el ENVIO de la cookie, no su
 *                      ALMACENAMIENTO, asi que el `Set-Cookie` de esa respuesta
 *                      se guarda igual y la victima se queda con la sesion del
 *                      ATACANTE abierta: todo lo que escriba despues —conteos,
 *                      ventas, recetas— acaba dentro de la company de el, que
 *                      luego lo lee. Es login CSRF / fijacion de sesion, y es
 *                      un ataque real, no una figura teorica.
 *
 *                      LO QUE LO CIERRA NO ES ESTE GUARD sino `bootstrap.ts`:
 *                      la API analiza SOLO `application/json`, que un `<form>`
 *                      cruzado no sabe emitir y que un `fetch` cruzado solo
 *                      consigue con un preflight que decide la lista blanca de
 *                      CORS. Antes de eso el hueco estaba abierto: el
 *                      `urlencoded` que Nest monta por defecto aceptaba el
 *                      formulario. La prueba que lo clava es «un formulario
 *                      cruzado no puede iniciar sesion» (ADR-021).
 *
 * LA COMPARACION VA EN TIEMPO CONSTANTE, en `shared/infrastructure/http/csrf`.
 * Un `===` sobre cadenas sale en cuanto encuentra el primer byte distinto, y
 * eso es un canal por el que se adivina un token byte a byte con suficientes
 * intentos. Aqui es el UNICO sitio del sistema donde se compara un secreto en
 * JavaScript —el token de sesion se compara por indice dentro de SQL— y por
 * eso la funcion vive aparte y se llama a lo que es.
 *
 * NO SE COMPRUEBA `Origin` NI `Referer`, y es una decision, no un olvido: ver
 * ADR-021, alternativa descartada 2.
 */

import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { IncomingMessage } from 'node:http';

import { CsrfInvalidoError } from '../../../../shared/domain/errors/csrf-invalido';
import { CLAVE_PUBLICO } from '../../../../shared/infrastructure/http/autorizacion';
import { esElMismoToken, esMutacion, tokenDeLaCabecera } from '../../../../shared/infrastructure/http/csrf';
import { SesionInvalidaError } from '../../domain/errores';
import { sesionDe } from './registro-de-sesiones';

@Injectable()
export class CsrfGuard implements CanActivate {
  public constructor(private readonly reflector: Reflector) {}

  public canActivate(contexto: ExecutionContext): boolean {
    const peticion = contexto.switchToHttp().getRequest<IncomingMessage>();
    if (!esMutacion(peticion.method)) {
      return true;
    }

    const publico = this.reflector.getAllAndOverride<boolean | undefined>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (publico === true) {
      return true;
    }

    const sesion = sesionDe(peticion);
    if (sesion === undefined) {
      // `SesionGuard` ya corrio y no dejo sesion en una ruta que no es publica:
      // es una contradiccion del cableado, y se resuelve por el lado seguro.
      throw new SesionInvalidaError('ausente');
    }

    const recibido = tokenDeLaCabecera(peticion);
    if (recibido === null) {
      throw new CsrfInvalidoError('ausente');
    }
    if (!esElMismoToken(sesion.csrfToken, recibido)) {
      throw new CsrfInvalidoError('no_coincide');
    }

    return true;
  }
}
