/**
 * Donde vive la sesion resuelta mientras dura la peticion.
 *
 * UN `WeakMap` Y NO UNA PROPIEDAD PEGADA AL `request`. Lo habitual en NestJS es
 * `request.user = ...`, y funciona, pero obliga a declarar un tipo global que
 * amplia el `Request` de express — que es justo lo que este proyecto evita, por
 * la misma razon que el filtro de errores trabaja sobre `ServerResponse`: los
 * tipos de express traen `any` dentro. Con un `WeakMap` la asociacion es
 * tipada, no ensucia el objeto de la peticion y la entrada desaparece sola
 * cuando el recolector se lleva la peticion.
 */

import type { IncomingMessage } from 'node:http';

import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';

const sesiones = new WeakMap<IncomingMessage, SesionActiva>();

export function guardarSesion(peticion: IncomingMessage, sesion: SesionActiva): void {
  sesiones.set(peticion, sesion);
}

/** @returns `undefined` en una ruta publica, donde no hay sesion que resolver. */
export function sesionDe(peticion: IncomingMessage): SesionActiva | undefined {
  return sesiones.get(peticion);
}
