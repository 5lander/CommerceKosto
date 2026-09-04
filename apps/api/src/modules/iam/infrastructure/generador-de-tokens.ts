/**
 * Tokens de sesion con el CSPRNG del sistema — SEGURIDAD.md §2.2.
 *
 * `randomBytes` Y JAMAS `Math.random`. `Math.random` no es criptografico: su
 * estado interno se reconstruye observando unas pocas salidas, y a partir de
 * ahi se predicen todas las siguientes. Un token de sesion predecible es una
 * cuenta abierta para cualquiera.
 *
 * 32 BYTES = 256 BITS. Es el tamano que SEGURIDAD.md §2.2 fija y el que hace
 * que la fuerza bruta no sea una opcion: no hay bloqueo por intentos que
 * proteja un token de sesion, porque quien lo prueba no tiene cuenta que
 * bloquear. La defensa es el tamano.
 *
 * `base64url` Y NO `hex`: mismo numero de bits en 43 caracteres en vez de 64, y
 * sin caracteres que haya que escapar en una cookie.
 */

import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { GeneradorDeTokens, TokenDeSesion } from '../application/ports/generador-de-tokens.port';

const BYTES_DE_ENTROPIA = 32;

@Injectable()
export class GeneradorDeTokensCriptografico implements GeneradorDeTokens {
  public generar(): TokenDeSesion {
    const token = randomBytes(BYTES_DE_ENTROPIA).toString('base64url');
    return { token, hash: this.hashDe(token) };
  }

  public hashDe(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }
}
