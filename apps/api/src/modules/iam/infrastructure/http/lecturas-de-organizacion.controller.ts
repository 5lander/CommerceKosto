/**
 * Las lecturas de la pantalla de usuarios: la lista y el catálogo de roles —
 * P16-C, D-16.126 y D-16.128, pantalla 32.
 *
 * **APARTE DE `UsuariosController`** por el límite de tres dependencias de
 * constructor, y porque las dos rutas son de LECTURA con el mismo permiso,
 * `user.read`, que tienen `OWNER`, `ADMIN`, `GERENTE_LOCAL` y `LECTURA` (P1).
 * `BODEGA` no lo tiene: 403.
 *
 * **EL CORREO DE INVITACIÓN SALE SIN `datos`, Y NO POR FILTRARLO AQUÍ.** El
 * repositorio no lo selecciona y `costeo_app` no puede leer esa columna (GRANT
 * por columnas de P16-A1): el token en vuelo no llega a este proceso por ningún
 * camino. `error` sale solo si lo hay, para que «ausente» no se confunda con un
 * error vacío.
 */

import { Controller, Get } from '@nestjs/common';

import { Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { ListarRoles, ListarUsuarios } from '../../application/casos-de-uso/lecturas-de-organizacion';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import type {
  CorreoDeInvitacion,
  UsuarioListado,
} from '../../application/ports/repositorio-de-organizacion.port';
import { SesionActual } from './decoradores';
import type { CorreoDeInvitacionDto, RolDto, UsuarioDto } from './organizacion.dto';

@Controller()
export class LecturasDeOrganizacionController {
  public constructor(
    private readonly usuarios: ListarUsuarios,
    private readonly roles: ListarRoles,
  ) {}

  @Get('usuarios')
  @Requiere('user.read')
  public async listarUsuarios(@SesionActual() sesion: SesionActiva): Promise<readonly UsuarioDto[]> {
    return (await this.usuarios.ejecutar(sesion)).map(comoUsuarioDto);
  }

  @Get('roles')
  @Requiere('user.read')
  public async listarRoles(@SesionActual() sesion: SesionActiva): Promise<readonly RolDto[]> {
    return (await this.roles.ejecutar(sesion)).map((rol) => ({
      codigo: rol.codigo,
      requiereUbicacion: rol.requiereUbicacion,
      permisos: [...rol.permisos],
    }));
  }
}

function comoUsuarioDto(usuario: UsuarioListado): UsuarioDto {
  return {
    id: usuario.id,
    email: usuario.email,
    estado: usuario.estado,
    roles: usuario.roles.map((asignacion) => ({ rol: asignacion.rol, locationId: asignacion.locationId })),
    invitacionCaducaEn: usuario.invitacionCaducaEn === null ? null : usuario.invitacionCaducaEn.toISOString(),
    correoInvitacion: usuario.correoInvitacion === null ? null : comoCorreoDto(usuario.correoInvitacion),
  };
}

function comoCorreoDto(correo: CorreoDeInvitacion): CorreoDeInvitacionDto {
  return correo.error === null ? { estado: correo.estado } : { estado: correo.estado, error: correo.error };
}
