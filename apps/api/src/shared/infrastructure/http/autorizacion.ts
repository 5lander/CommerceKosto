/**
 * Los dos marcadores de autorizacion, y las claves con que se leen.
 *
 * VIVEN EN `shared` Y NO EN `iam` A PROPOSITO. Los guards que los interpretan
 * son de `iam`, pero quien los PONE es cualquier controlador del sistema —el de
 * salud hoy, los de catalogo en P2—, y no tiene sentido que `shared` dependa de
 * un modulo de negocio para poder marcar una ruta como publica.
 *
 * `@Publico()` ES LA EXCEPCION, NO LA REGLA. El guard de sesion es global:
 * exige sesion en TODA ruta y hay que pedirle explicitamente que no lo haga. El
 * sentido contrario —un `@Autenticado()` que hubiera que acordarse de poner—
 * falla abierto: la ruta que alguien olvide marcar queda publica y nadie se
 * entera hasta que se entera alguien de fuera. Aqui el olvido produce un 401 en
 * la primera prueba.
 *
 * La lista completa de excepciones se lee de un vistazo:
 *
 *   grep -rn "@Publico" apps/api/src
 */

import { SetMetadata, type CustomDecorator } from '@nestjs/common';

export const CLAVE_PUBLICO = 'iam:publico';
export const CLAVE_PERMISOS = 'iam:permisos';

/** Marca una ruta como accesible sin sesion. Uso contado y justificado. */
export function Publico(): CustomDecorator {
  return SetMetadata(CLAVE_PUBLICO, true);
}

/**
 * Capacidades exigidas — SPEC §4: capacidades, no roles rigidos. El endpoint
 * declara QUE hace falta poder hacer, no QUIEN puede hacerlo; cambiar que rol
 * tiene una capacidad es entonces una fila en `role_permission` y no un
 * despliegue.
 *
 * Se piden TODAS, no una cualquiera: cuando un endpoint necesita dos permisos
 * es porque hace dos cosas, y bastar con uno dejaria media operacion sin
 * autorizar.
 */
export function Requiere(...permisos: readonly string[]): CustomDecorator {
  return SetMetadata(CLAVE_PERMISOS, permisos);
}
