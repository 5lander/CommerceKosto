/**
 * Usuarios y roles — SPEC §4.
 *
 * LA ACTIVACION ES `@Publico()`. Tiene que serlo: quien llega por el enlace de
 * invitacion todavia no tiene contrasena, asi que no puede haber iniciado
 * sesion. Lo que la protege no es una sesion sino el token: 256 bits, de un
 * solo uso —la activacion exige `status = INVITED`— y con caducidad. Las otras
 * rutas publicas del sistema son el login y el restablecimiento de contrasena;
 * la lista completa es `grep -rn "@Publico" apps/api/src`.
 *
 * LA INVITACION RESPONDE 202 Y NO 201. No es un detalle de estilo: 201 diria
 * "he creado un usuario", y este endpoint responde igual cuando el correo ya
 * estaba en uso. 202 dice lo unico que es cierto en los dos casos: la peticion
 * se acepto. Un codigo distinto por caso seria el oraculo de existencia que el
 * caso de uso se esfuerza en no ser.
 *
 * EL REENVIO EXIGE EL MISMO PERMISO QUE INVITAR (`user.invite`): es la misma
 * accion, repetida. Responde 202 por lo mismo que la invitacion —se encolo un
 * correo, no se entrego— y 404 si el usuario no esta invitado en la company
 * de quien pide: dentro de la propia company no hay oraculo que cerrar, y el
 * 404 es lo que necesita quien pulso «reenviar» sobre alguien que ya activo.
 *
 * INVITAR Y REENVIAR LLEVAN LA IP DEL CLIENTE al caso de uso, resuelta por
 * `ipDelCliente` con `PROXY_DE_CONFIANZA` (D-16.49): es la clave del limite
 * por IP (D-16.50). Por eso este controlador recibe la configuracion, y por
 * eso aceptar viaja dentro de `InvitacionesDeUsuario`: tres dependencias.
 */

import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import type { IncomingMessage } from 'node:http';

import { CONFIGURATION, type Configuration } from '../../../../shared/infrastructure/config/environment';
import { Publico, Requiere } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { ipDelCliente } from '../../../../shared/infrastructure/http/ip-del-cliente';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import { locationId, userId } from '../../../../shared/domain/identity/identificadores';
import { SesionActual } from './decoradores';
import { InvitacionesDeUsuario } from './invitaciones-de-usuario';
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
    private readonly invitaciones: InvitacionesDeUsuario,
    private readonly roles: RolesDeUsuario,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  @Post()
  @Requiere('user.invite')
  @HttpCode(HttpStatus.ACCEPTED)
  public async invitar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_INVITACION)) cuerpo: CuerpoDeInvitacion,
    @Req() peticion: IncomingMessage,
  ): Promise<void> {
    await this.invitaciones.invitar.ejecutar(sesion, { email: cuerpo.email, ip: this.ipDe(peticion) });
  }

  /** `ParseUUIDPipe` convierte un id mal formado en 400 antes de que `userId()` lo vea. */
  @Post(':id/reenvio-de-invitacion')
  @Requiere('user.invite')
  @HttpCode(HttpStatus.ACCEPTED)
  public async reenviar(
    @SesionActual() sesion: SesionActiva,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() peticion: IncomingMessage,
  ): Promise<void> {
    await this.invitaciones.reenviar.ejecutar(sesion, { objetivo: userId(id), ip: this.ipDe(peticion) });
  }

  @Publico()
  @Post('activacion')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async activar(
    @Body(new EsquemaPipe(CUERPO_DE_ACTIVACION)) cuerpo: CuerpoDeActivacion,
  ): Promise<void> {
    await this.invitaciones.aceptar.ejecutar(cuerpo);
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

  private ipDe(peticion: IncomingMessage): string | null {
    return ipDelCliente(peticion, this.config.proxiesDeConfianza);
  }
}

function aDatosDeRol(cuerpo: CuerpoDeRol) {
  return {
    userId: userId(cuerpo.userId),
    rol: cuerpo.rol,
    locationId: cuerpo.locationId === null ? null : locationId(cuerpo.locationId),
  };
}
