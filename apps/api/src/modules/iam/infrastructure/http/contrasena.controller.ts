/**
 * Cambio de contrasena.
 *
 * VA EN SU PROPIO CONTROLADOR y no junto al login por una razon concreta: el
 * login es publico y esto no. Mezclarlos pondria en la misma clase rutas con
 * exigencias de autorizacion opuestas, y un `@Publico()` mal colocado a nivel
 * de clase abriria el cambio de contrasena a cualquiera. Separados, ese error
 * no se puede cometer.
 *
 * CAMBIAR LA CONTRASENA CIERRA TODAS LAS SESIONES, la del que la cambia
 * incluida (SEGURIDAD.md §2.2). Por eso se borra tambien la cookie: dejarla
 * puesta produciria un 401 en la siguiente peticion y la sensacion de que algo
 * se rompio.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Res } from '@nestjs/common';
import type { ServerResponse } from 'node:http';

import { CONFIGURATION, type Configuration } from '../../../../shared/infrastructure/config/environment';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { CambiarContrasena } from '../../application/casos-de-uso/cambiar-contrasena';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import { CUERPO_DE_CAMBIO_DE_CONTRASENA, type CuerpoDeCambioDeContrasena } from './auth.dto';
import { cookieBorrada } from './cookies';
import { SesionActual } from './decoradores';

export interface RespuestaDeCambio {
  readonly sesionesRevocadas: number;
}

@Controller('auth/password')
export class ContrasenaController {
  public constructor(
    private readonly cambiarContrasena: CambiarContrasena,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  public async cambiar(
    @SesionActual() sesion: SesionActiva,
    @Body(new EsquemaPipe(CUERPO_DE_CAMBIO_DE_CONTRASENA)) cuerpo: CuerpoDeCambioDeContrasena,
    @Res({ passthrough: true }) respuesta: ServerResponse,
  ): Promise<RespuestaDeCambio> {
    const revocadas = await this.cambiarContrasena.ejecutar(sesion, {
      correo: cuerpo.email,
      actual: cuerpo.actual,
      nueva: cuerpo.nueva,
    });

    respuesta.setHeader('Set-Cookie', cookieBorrada(this.config.isProduction));

    return { sesionesRevocadas: revocadas };
  }
}
