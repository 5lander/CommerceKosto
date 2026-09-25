/**
 * Las lecturas de la pantalla de usuarios — P16-C, D-16.126 y D-16.128.
 *
 * EL ALCANCE SE APLICA AQUÍ, como en `ListarUbicaciones`: RLS deja ver a toda la
 * company, y un `GERENTE_LOCAL` —que tiene `user.read` desde P1— no debe listar a
 * los usuarios de los demás locales ni sus roles. Con alcance de ubicaciones ve a
 * quien tiene un rol en las suyas, y solo esas asignaciones.
 */

import type { SesionActiva } from './validar-sesion';
import type {
  RepositorioDeOrganizacion,
  RolDelCatalogo,
  UsuarioListado,
} from '../ports/repositorio-de-organizacion.port';

export interface DependenciasDeLecturas {
  readonly organizacion: RepositorioDeOrganizacion;
}

export class ListarUsuarios {
  public constructor(private readonly deps: DependenciasDeLecturas) {}

  public async ejecutar(sesion: SesionActiva): Promise<readonly UsuarioListado[]> {
    return this.deps.organizacion.listarUsuarios({
      companyId: sesion.companyId,
      ubicaciones: sesion.alcance.clase === 'company' ? 'todas' : sesion.alcance.ids,
    });
  }
}

export class ListarRoles {
  public constructor(private readonly deps: DependenciasDeLecturas) {}

  public async ejecutar(sesion: SesionActiva): Promise<readonly RolDelCatalogo[]> {
    return this.deps.organizacion.listarRoles(sesion.companyId);
  }
}
