/**
 * Adaptador de Argon2id — CLAUDE.md §4.5.
 *
 * PARAMETROS EXPLICITOS Y NO LOS POR DEFECTO DE LA LIBRERIA. No es
 * desconfianza: es que los valores por defecto cambian entre versiones, y un
 * cambio silencioso en el coste de hashear es a la vez un problema de seguridad
 * (si baja) y una caida de servicio (si sube). Escritos aqui, cambiarlos es un
 * commit que alguien revisa.
 *
 * Los valores siguen la recomendacion de OWASP para Argon2id, con memoria por
 * encima del minimo:
 *
 *   memoryCost   65536 KiB (64 MiB)   el parametro que de verdad encarece el
 *                                     ataque con GPU
 *   timeCost     3 pasadas
 *   parallelism  1                    un hilo por hash: con `p > 1` cada login
 *                                     compite por el pool de libuv y la latencia
 *                                     empeora bajo carga
 *
 * `parallelism: 1` merece su linea: la biblioteca trae 4 por defecto, y cuatro
 * hilos por cada login concurrente saturan el pool de libuv —que tiene cuatro
 * en total— y bloquean el resto de la aplicacion, base de datos incluida.
 */

import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

import type { HasherDeContrasenas } from '../application/ports/hasher-de-contrasenas.port';

const MEMORIA_KIB = 65_536;
const PASADAS = 3;
const HILOS = 1;

const OPCIONES = {
  type: argon2.argon2id,
  memoryCost: MEMORIA_KIB,
  timeCost: PASADAS,
  parallelism: HILOS,
} as const;

/**
 * Contrasena del hash ficticio. No protege nada —el hash resultante es publico
 * en la practica— y por eso puede ser una constante: lo unico que importa es
 * que verificar contra el cueste lo mismo que verificar contra uno real.
 */
const CONTRASENA_FICTICIA = 'contrasena que no es de nadie';

@Injectable()
export class Argon2Hasher implements HasherDeContrasenas {
  /**
   * Se calcula UNA vez, de forma perezosa, y se reutiliza.
   *
   * Calcularlo en cada login fallido costaria lo mismo que un hash real — que
   * es justo lo que se busca— pero tambien 64 MiB por intento, y eso convierte
   * el propio mecanismo anti enumeracion en un vector de agotamiento de
   * memoria. Verificar contra un hash ya calculado cuesta lo mismo que
   * verificar contra el de un usuario real, que es la propiedad que hace falta.
   */
  #ficticio: Promise<string> | null = null;

  public async hash(plana: string): Promise<string> {
    return argon2.hash(plana, OPCIONES);
  }

  public async verificar(hash: string | null, plana: string): Promise<boolean> {
    if (hash === null) {
      // Se hace el trabajo igual y se descarta el resultado: el tiempo de
      // respuesta no debe distinguir "no existe" de "contrasena incorrecta".
      await argon2.verify(await this.hashFicticio(), plana);
      return false;
    }

    return argon2.verify(hash, plana);
  }

  public necesitaRehash(hash: string): boolean {
    return argon2.needsRehash(hash, OPCIONES);
  }

  private async hashFicticio(): Promise<string> {
    this.#ficticio ??= argon2.hash(CONTRASENA_FICTICIA, OPCIONES);
    return this.#ficticio;
  }
}
