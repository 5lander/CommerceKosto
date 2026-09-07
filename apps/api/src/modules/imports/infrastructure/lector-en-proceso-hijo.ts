/**
 * El adaptador del lector: un proceso hijo aislado (ADR-013).
 *
 * Es una clase de tres líneas y existe por una razón concreta: `leerEnHijo` es
 * una función suelta de infraestructura, y un caso de uso no puede importarla
 * —`audit:arch` no deja que `application` mire hacia `infrastructure`—. Esto es
 * lo que la convierte en algo inyectable por su puerto.
 */

import { Injectable } from '@nestjs/common';

import type { LectorDeHoja } from '../application/ports/lector-de-hoja.port';
import { leerEnHijo } from './aislamiento/leer-en-hijo';

@Injectable()
export class LectorEnProcesoHijo implements LectorDeHoja {
  public async leer(bytes: Uint8Array): Promise<readonly (readonly string[])[]> {
    return leerEnHijo(bytes);
  }
}
