/**
 * La superficie HTTP de sesion: abrir y cerrar.
 *
 * EL TOKEN NO SALE EN EL CUERPO, SOLO EN LA COOKIE `HttpOnly`. Devolverlo
 * ademas en el JSON anularia el `HttpOnly`: cualquier script de la pagina
 * podria leerlo de la respuesta y guardarlo donde un XSS lo encuentra. El
 * cuerpo lleva solo cuando caduca, que es lo unico que un cliente necesita
 * saber para renovar a tiempo.
 *
 * LA IP LA RESUELVE `ipDelCliente` CON `PROXY_DE_CONFIANZA` (D-16.49). Hasta
 * P16-A1 salia del socket sin mas, «hasta que el despliegue tuviera proxy de
 * confianza»; ese despliegue existe desde P14b y nadie volvio aqui: detras de
 * Caddy toda peticion llegaba con la IP de Caddy, y el bloqueo por IP del
 * login habria sido un bloqueo GLOBAL al vigesimoquinto fallo de cualquiera
 * (INC-022). `X-Forwarded-For` se cree SOLO cuando el socket es de un proxy de
 * la lista, porque esa cabecera la escribe quien hace la peticion: creida sin
 * mas, un atacante podria (a) esquivar el bloqueo cambiandola en cada intento
 * y (b) peor, ENVENENAR la cuenta de otra IP para bloquear a un tercero. En
 * desarrollo la lista esta vacia y la IP sigue siendo la del socket.
 *
 * `Secure` SALE DE LA CONFIGURACION Y NO DEL SOCKET. Con TLS terminado en un
 * proxy —que es como se despliega esto— `socket.encrypted` es `false` en
 * produccion, asi que decidirlo por el socket quitaria el `Secure` justo donde
 * hace falta.
 */

import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { CONFIGURATION, type Configuration } from '../../../../shared/infrastructure/config/environment';
import { EsquemaPipe } from '../../../../shared/infrastructure/http/esquema.pipe';
import { ipDelCliente } from '../../../../shared/infrastructure/http/ip-del-cliente';
import { CerrarSesion } from '../../application/casos-de-uso/cerrar-sesion';
import { IniciarSesion } from '../../application/casos-de-uso/iniciar-sesion';
import type { SesionActiva } from '../../application/casos-de-uso/validar-sesion';
import { CUERPO_DE_LOGIN, type CuerpoDeLogin } from './auth.dto';
import { Publico } from '../../../../shared/infrastructure/http/autorizacion';
import { cookieBorrada, cookieDeSesion } from './cookies';
import { SesionActual } from './decoradores';

/** El maximo que acepta la restriccion `session_user_agent_acotado`. */
const LARGO_MAXIMO_DE_USER_AGENT = 512;

export interface RespuestaDeLogin {
  readonly expiraEn: string;
}

@Controller('auth')
export class AuthController {
  public constructor(
    private readonly iniciarSesion: IniciarSesion,
    private readonly cerrarSesion: CerrarSesion,
    @Inject(CONFIGURATION) private readonly config: Configuration,
  ) {}

  @Publico()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  public async login(
    @Body(new EsquemaPipe(CUERPO_DE_LOGIN)) cuerpo: CuerpoDeLogin,
    @Req() peticion: IncomingMessage,
    @Res({ passthrough: true }) respuesta: ServerResponse,
  ): Promise<RespuestaDeLogin> {
    const abierta = await this.iniciarSesion.ejecutar({
      email: cuerpo.email,
      contrasena: cuerpo.contrasena,
      ip: ipDelCliente(peticion, this.config.proxiesDeConfianza),
      userAgent: userAgentDe(peticion),
    });

    respuesta.setHeader(
      'Set-Cookie',
      cookieDeSesion({
        token: abierta.token,
        expiraEn: abierta.expiraEn,
        ahora: new Date(),
        seguro: this.config.isProduction,
      }),
    );

    return { expiraEn: abierta.expiraEn.toISOString() };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @SesionActual() sesion: SesionActiva,
    @Res({ passthrough: true }) respuesta: ServerResponse,
  ): Promise<void> {
    await this.cerrarSesion.ejecutar(sesion);
    respuesta.setHeader('Set-Cookie', cookieBorrada(this.config.isProduction));
  }
}

function userAgentDe(peticion: IncomingMessage): string | null {
  const bruto = peticion.headers['user-agent'];
  return typeof bruto === 'string' ? bruto.slice(0, LARGO_MAXIMO_DE_USER_AGENT) : null;
}
