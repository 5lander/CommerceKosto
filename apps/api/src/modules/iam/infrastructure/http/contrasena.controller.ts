/**
 * Contrasena: el cambio con sesion, y el restablecimiento sin ella.
 *
 * VA EN SU PROPIO CONTROLADOR y no junto al login por una razon concreta: el
 * login es publico y el cambio no. Mezclarlos pondria en la misma clase rutas
 * con exigencias de autorizacion opuestas, y un `@Publico()` mal colocado a
 * nivel de clase abriria el cambio de contrasena a cualquiera. Separados, ese
 * error no se puede cometer.
 *
 * DESDE P16-A1 CONVIVEN AQUI DOS RUTAS PUBLICAS —`olvido` y `restablecimiento`—
 * y la regla de arriba se sostiene igual: el marcador va METODO A METODO, nunca
 * en la clase, y las dos rutas publicas se protegen con lo que llevan dentro:
 * un correo que no se confirma, y un token de 256 bits, de un uso y con
 * caducidad. La lista completa de rutas publicas sigue siendo
 * `grep -rn "@Publico" apps/api/src`.
 *
 * CAMBIAR O RESTABLECER LA CONTRASENA CIERRA TODAS LAS SESIONES, la del que la
 * cambia incluida (SEGURIDAD.md §2.2). Por eso en el cambio se borra tambien
 * la cookie: dejarla puesta produciria un 401 en la siguiente peticion y la
 * sensacion de que algo se rompio. En el restablecimiento no hay cookie que
 * borrar: quien lo pide no habia entrado.
 *
 * `olvido` RESPONDE 202 SIEMPRE, con el mismo cuerpo vacio y el mismo trabajo
 * exista o no el correo. Un 404 seria el oraculo de existencia que
 * SEGURIDAD.md §2.1 prohibe en el login, trasladado a la puerta de al lado.
 *
 * LAS DOS RUTAS PUBLICAS LLEVAN LA IP DEL CLIENTE al caso de uso, resuelta
 * por `ipDelCliente` con `PROXY_DE_CONFIANZA` (D-16.49): es la clave del
 * limite por IP (D-16.50) y la que queda en `audit_log`. Detras de Caddy la
 * del socket es siempre la del proxy.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { CONFIGURATION, type Configuration } from '../../../../shared/infrastructure/config/environment';
import { Publico } from '../../../../shared/infrastructure/http/autorizacion';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { ipDelCliente } from '../../../../shared/infrastructure/http/ip-del-cliente';
import { CambiarContrasena } from '../../application/casos-de-uso/cambiar-contrasena';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import {
  CUERPO_DE_CAMBIO_DE_CONTRASENA,
  CUERPO_DE_OLVIDO,
  CUERPO_DE_RESTABLECIMIENTO,
  type CuerpoDeCambioDeContrasena,
  type CuerpoDeOlvido,
  type CuerpoDeRestablecimiento,
} from './auth.dto';
import { cookieBorrada } from './cookies';
import { SesionActual } from './decoradores';
import { Restablecimiento } from './restablecimiento';

export interface RespuestaDeCambio {
  readonly sesionesRevocadas: number;
}

@Controller('auth/password')
export class ContrasenaController {
  public constructor(
    private readonly cambiarContrasena: CambiarContrasena,
    private readonly restablecimiento: Restablecimiento,
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

  @Publico()
  @Post('olvido')
  @HttpCode(HttpStatus.ACCEPTED)
  public async olvido(
    @Body(new EsquemaPipe(CUERPO_DE_OLVIDO)) cuerpo: CuerpoDeOlvido,
    @Req() peticion: IncomingMessage,
  ): Promise<void> {
    await this.restablecimiento.solicitar.ejecutar({ email: cuerpo.email, ip: this.ipDe(peticion) });
  }

  /**
   * 204 y no un recuento: quien restablece no tenia sesion, y decirle cuantas
   * habia abiertas es informacion sobre una cuenta que acaba de demostrar que
   * es suya solo por un enlace. Se cierran todas; con eso basta.
   */
  @Publico()
  @Post('restablecimiento')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async restablecer(
    @Body(new EsquemaPipe(CUERPO_DE_RESTABLECIMIENTO)) cuerpo: CuerpoDeRestablecimiento,
    @Req() peticion: IncomingMessage,
  ): Promise<void> {
    await this.restablecimiento.restablecer.ejecutar({ ...cuerpo, ip: this.ipDe(peticion) });
  }

  private ipDe(peticion: IncomingMessage): string | null {
    return ipDelCliente(peticion, this.config.proxiesDeConfianza);
  }
}
