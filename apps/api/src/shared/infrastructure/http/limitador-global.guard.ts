/**
 * El limitador global de peticiones, con la IP del cliente y no la del proxy
 * — D-16.49, INC-022.
 *
 * `ThrottlerGuard` CUENTA POR IP CON SU PROPIO RASTREADOR, que en Express es
 * `req.ip`: la direccion del socket. Detras de Caddy esa direccion es siempre
 * la de Caddy, asi que los 300 por minuto de `RATE_LIMIT_MAX` serian 300 por
 * minuto PARA TODOS LOS USUARIOS JUNTOS — un limite que no limita a nadie en
 * concreto y que un solo cliente ruidoso agota para el resto. Era el tercer
 * camino de IP del sistema (login, back office y este), y el mas facil de
 * olvidar porque no tiene una linea de codigo que lo lea.
 *
 * `getTracker` ES EL PUNTO DE EXTENSION QUE LA LIBRERIA DOCUMENTA para esto, y
 * la configuracion entra por inyeccion de propiedad: sin constructor propio,
 * Nest resuelve los tres parametros del guard base por sus metadatos, y aqui
 * solo se anade lo que falta. Todo lo demas —`@SkipThrottle` en las sondas de
 * salud, el 429 `TOO_MANY_REQUESTS`, el almacen en memoria— sigue siendo del
 * guard base.
 *
 * SIN DIRECCION DE SOCKET, TODOS COMPARTEN UNA CLAVE. Es el caso de un socket
 * de Unix o de una peticion ya cerrada: no hay a quien distinguir, y contar
 * en una sola cubeta es mas restrictivo que no contar.
 */

import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { IncomingMessage } from 'node:http';

import { CONFIGURATION, type Configuration } from '../config/environment';
import { ipDelCliente } from './ip-del-cliente';

const SIN_DIRECCION = 'sin-direccion';

@Injectable()
export class LimitadorGlobalGuard extends ThrottlerGuard {
  @Inject(CONFIGURATION)
  private readonly config!: Configuration;

  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    if (!(req instanceof IncomingMessage)) {
      // Este guard solo se monta sobre HTTP. Otra cosa es un cableado nuevo
      // que nadie probo, y se dice en alto en vez de contar en una cubeta.
      throw new Error('LimitadorGlobalGuard: la peticion no es una IncomingMessage de Node.');
    }
    return Promise.resolve(ipDelCliente(req, this.config.proxiesDeConfianza) ?? SIN_DIRECCION);
  }
}
