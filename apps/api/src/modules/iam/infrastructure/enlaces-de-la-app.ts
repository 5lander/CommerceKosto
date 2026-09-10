/**
 * Los enlaces de los correos, construidos sobre `APP_URL`.
 *
 * EL TOKEN VA EN LA QUERY, NO EN LA RUTA, y por una razon de frontend: la
 * pagina `/activacion` es una sola pagina estatica que lee `?token=` en el
 * cliente, y asi no hace falta una ruta dinamica por token ni que el servidor
 * del frontend vea el token en su log de rutas.
 *
 * `encodeURIComponent` es cinturon y tirantes: el token es `base64url`, que no
 * tiene nada que escapar, pero el dia que el generador cambie este archivo no
 * tiene por que enterarse.
 */

import { Inject, Injectable } from '@nestjs/common';

import { CONFIGURATION, type Configuration } from '../../../shared/infrastructure/config/environment';
import type { Enlaces } from '../application/ports/enlaces.port';

const RUTA_DE_ACTIVACION = '/activacion';
const RUTA_DE_RESTABLECIMIENTO = '/restablecer';

@Injectable()
export class EnlacesDeLaApp implements Enlaces {
  public constructor(@Inject(CONFIGURATION) private readonly config: Configuration) {}

  public deActivacion(token: string): string {
    return this.enlace(RUTA_DE_ACTIVACION, token);
  }

  public deRestablecimiento(token: string): string {
    return this.enlace(RUTA_DE_RESTABLECIMIENTO, token);
  }

  private enlace(ruta: string, token: string): string {
    return `${this.config.appUrl}${ruta}?token=${encodeURIComponent(token)}`;
  }
}
