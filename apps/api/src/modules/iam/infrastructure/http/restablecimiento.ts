/**
 * Los dos pasos del restablecimiento, como una sola dependencia.
 *
 * `ContrasenaController` tiene el cambio de contrasena y la configuracion, y
 * con solicitar y restablecer sueltos serian cuatro parametros (CLAUDE.md §3).
 * Los dos pasos son una sola operacion vista en dos momentos, asi que van
 * juntos. Archivo propio por `emitDecoratorMetadata`, como `RolesDeUsuario`.
 */

import {
  RestablecerContrasena,
  SolicitarRestablecimiento,
} from '../../application/casos-de-uso/restablecer-contrasena';

export class Restablecimiento {
  public constructor(
    public readonly solicitar: SolicitarRestablecimiento,
    public readonly restablecer: RestablecerContrasena,
  ) {}
}
