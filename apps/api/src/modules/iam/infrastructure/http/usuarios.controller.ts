/**
 * Usuarios y roles — SPEC §4.
 *
 * LA ACTIVACION ES `@Publico()`, Y ES LA UNICA RUTA PUBLICA ADEMAS DEL LOGIN.
 * Tiene que serlo: quien llega por el enlace de invitacion todavia no tiene
 * contrasena, asi que no puede haber iniciado sesion. Lo que la protege no es
 * una sesion sino el token: 256 bits, de un solo uso —la activacion exige
 * `status = INVITED`— y con caducidad.
 *
 * LA INVITACION RESPONDE 202 Y NO 201. No es un detalle de estilo: 201 diria
 * "he creado un usuario", y este endpoint responde igual cuando el correo ya
 * estaba en uso. 202 dice lo unico que es cierto en los dos casos: la peticion
 * se acepto. Un codigo distinto por caso seria el oraculo de existencia que el
 * caso de uso se esfuerza en no ser.
 */

import { Body, Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Publico, Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { AceptarInvitacion, InvitarUsuario } from '../../application/casos-de-uso/usuarios';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import { locationId, userId } from '../../../../shared/domain/identity/identificadores';
import { SesionActual } from './decoradores';
import { RolesDeUsuario } from './roles-de-usuario';
import {
  CUERPO_DE_ACTIVACION,
  CUERPO_DE_INVITACION,
  CUERPO_DE_ROL,
  type CuerpoDeActivacion,
  type CuerpoDeInvitacion,
  type CuerpoDeRol,
} from './organizacion.dto';

@Controller('usuarios')
export class UsuariosController {
  public constructor(
    private readonly invitarUsuario: InvitarUsuario,
    private readonly aceptarInvitacion: AceptarInvitacion,
    private readonly roles: RolesDeUsuario,
  ) {}

  @Post()
  @Requiere('user.invite')
  @HttpCode(HttpStatus.ACCEPTED)
  public async invitar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_INVITACION)) cuerpo: CuerpoDeInvitacion,
  ): Promise<void> {
    await this.invitarUsuario.ejecutar(sesion, cuerpo.email);
  }

  @Publico()
  @Post('activacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async activar(
    @Body(new EsquemaPipe(CUERPO_DE_ACTIVACION)) cuerpo: CuerpoDeActivacion,
  ): Promise<void> {
    await this.aceptarInvitacion.ejecutar(cuerpo);
  }

  @Post('roles')
  @Requiere('user.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async asignar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_ROL)) cuerpo: CuerpoDeRol,
  ): Promise<void> {
    await this.roles.asignar.ejecutar(sesion, aDatosDeRol(cuerpo));
  }

  @Delete('roles')
  @Requiere('user.update')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async revocar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_ROL)) cuerpo: CuerpoDeRol,
  ): Promise<void> {
    await this.roles.revocar.ejecutar(sesion, aDatosDeRol(cuerpo));
  }
}

function aDatosDeRol(cuerpo: CuerpoDeRol) {
  return {
    userId: userId(cuerpo.userId),
    rol: cuerpo.rol,
    locationId: cuerpo.locationId === null ? null : locationId(cuerpo.locationId),
  };
}
