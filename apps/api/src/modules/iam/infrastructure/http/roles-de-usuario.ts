/**
 * Asignar y revocar, empaquetados como una sola dependencia.
 *
 * DOS RAZONES, Y LAS DOS SON DEL PROYECTO, NO DE NESTJS. La primera es
 * CLAUDE.md §3: el controlador de usuarios necesita cuatro colaboradores y el
 * limite son tres parametros; agrupar los dos que SON la misma operacion en dos
 * sentidos es mejor que partir el recurso en dos rutas artificiales.
 *
 * La segunda es por que vive en su propio archivo y no junto al controlador:
 * `emitDecoratorMetadata` evalua los tipos del constructor EN EL MOMENTO de
 * definir la clase decorada. Con las dos clases en el mismo archivo y esta
 * declarada despues, eso explota con "Cannot access before initialization" —y
 * no en compilacion, sino al arrancar. Separadas, el orden lo resuelve el
 * import.
 */

import { AsignarRol, RevocarRol } from '../../application/casos-de-uso/usuarios';

export class RolesDeUsuario {
  public constructor(
    public readonly asignar: AsignarRol,
    public readonly revocar: RevocarRol,
  ) {}
}
