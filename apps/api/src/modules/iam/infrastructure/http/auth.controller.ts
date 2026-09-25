/**
 * La superficie HTTP de sesion: abrir, leer y cerrar.
 *
 * EL TOKEN DE SESION NO SALE EN EL CUERPO, SOLO EN LA COOKIE `HttpOnly`.
 * Devolverlo ademas en el JSON anularia el `HttpOnly`: cualquier script de la
 * pagina podria leerlo de la respuesta y guardarlo donde un XSS lo encuentra.
 *
 * EL TOKEN ANTI-CSRF SI SALE EN EL CUERPO, Y NO CONTRADICE LO ANTERIOR (ADR-021).
 * Son dos cosas distintas: la cookie es la CREDENCIAL —quien la tiene, es el
 * usuario— y el CSRF no lo es —quien lo tiene y no tiene la cookie no puede
 * hacer nada—. El CSRF TIENE que ser legible por el JavaScript de la pagina,
 * porque su trabajo es que la pagina lo ponga en una cabecera que un sitio
 * cruzado no puede poner. Meterlo en una cookie seria lo contrario de
 * protegerlo: el navegador la mandaria sola, justo en la peticion de la que
 * defiende.
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

import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Req, Res } from '@nestjs/common';
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
  /** El token anti-CSRF de la sesion recien abierta. Ver la cabecera. */
  readonly csrf: string;
}

/**
 * El alcance, con la MISMA forma que tiene dentro: una union discriminada.
 *
 * NO SE APLANA A UNA LISTA. Un `ubicaciones: []` que significara «todas» es la
 * convencion que alguien lee al reves una vez y convierte en fuga; el puerto
 * lo dice con esas palabras y el contrato publico no lo va a desmentir.
 */
export type AlcanceDto =
  | { readonly clase: 'company' }
  | { readonly clase: 'ubicaciones'; readonly ids: readonly string[] };

/**
 * Lo que el cliente necesita para pintarse: quien es, que puede, sobre que, y
 * con que token firma sus mutaciones.
 *
 * NO LLEVA `companyId` A PROPOSITO. El tenant no es un dato que el cliente use
 * —no puede mandarlo en ninguna peticion, Barrera 3— y publicarlo solo
 * invitaria a intentarlo.
 */
export interface RespuestaDeSesion {
  readonly userId: string;
  readonly permisos: readonly string[];
  readonly alcance: AlcanceDto;
  readonly csrf: string;
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

    return { expiraEn: abierta.expiraEn.toISOString(), csrf: abierta.csrf };
  }

  /**
   * Quien soy — la primera llamada de cada carga de pagina.
   *
   * ES LA QUE DEVUELVE EL TOKEN ANTI-CSRF TRAS RECARGAR. El token del login
   * vive en la memoria del JavaScript, asi que una recarga se lo lleva; la
   * cookie sobrevive. Sin esta ruta habria que rotar el token —y romper las
   * demas pestanas— o guardarlo en `localStorage`, donde un XSS lo encuentra.
   *
   * SIN `@Requiere(...)`: el minimo de la API es estar autenticado, y esto no
   * devuelve nada que el usuario no sea ya. Que un usuario lea sus propios
   * permisos no es una filtracion; es lo que evita que el cliente los adivine.
   */
  @Get('sesion')
  public sesion(@SesionActual() sesion: SesionActiva): RespuestaDeSesion {
    return {
      userId: sesion.userId,
      permisos: [...sesion.permisos],
      alcance:
        sesion.alcance.clase === 'company'
          ? { clase: 'company' }
          : { clase: 'ubicaciones', ids: [...sesion.alcance.ids] },
      csrf: sesion.csrfToken,
    };
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
