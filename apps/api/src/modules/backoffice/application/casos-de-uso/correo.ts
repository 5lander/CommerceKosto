/**
 * La salud de la cola de correo, vista desde el back office — D-16.27c.
 *
 * TRES NUMEROS Y NADA MAS: cuantos correos llevan `PENDIENTE` mas de N
 * minutos, cuantos estan `FALLIDO`, y cuando salio el ultimo. Con eso se
 * sabe lo que importa —si el despachador corre y si el proveedor entrega— sin
 * abrir la cola. La respuesta NUNCA lleva destinatarios ni `datos` (D-16.34):
 * el rol del back office ni siquiera tiene `SELECT` sobre esa columna, asi
 * que no depende de que este codigo lo omita.
 *
 * NO PIDE MOTIVO NI DEJA FILA EN `backoffice_access_log`, y es la segunda
 * excepcion del modulo (la primera es leer el propio log de accesos). El
 * motivo existe para dejar rastro de quien miro datos de UN cliente; aqui no
 * se mira ninguno: son contadores agregados sobre todos los tenants a la vez,
 * sin un solo id, correo o company en la respuesta. Un motivo obligatorio
 * para mirar tres numeros de operacion se rellenaria con «salud», y un
 * registro que solo dice «salud» cada cinco minutos enterraria los accesos
 * que si importan.
 *
 * EL UMBRAL ES CONFIGURACION (`CORREO_MINUTOS_DE_ALERTA`, 15 por defecto):
 * el despachador pasa cada cinco segundos, asi que un correo `PENDIENTE` con
 * quince minutos ya lleva cuatro reintentos o un proceso caido.
 */

import type { Reloj } from '../../../../shared/application/ports/reloj.port';
import type { RepositorioDeBackoffice, SaludDelCorreo } from '../ports/repositorio-de-backoffice.port';

const MILISEGUNDOS_POR_MINUTO = 60_000;

export interface DependenciasDeSaludDelCorreo {
  readonly repositorio: RepositorioDeBackoffice;
  readonly reloj: Reloj;
  readonly minutosDeAlerta: number;
}

export class LeerSaludDelCorreo {
  public constructor(private readonly deps: DependenciasDeSaludDelCorreo) {}

  public async ejecutar(): Promise<SaludDelCorreo> {
    const umbral = new Date(this.deps.reloj.ahora().getTime() - this.deps.minutosDeAlerta * MILISEGUNDOS_POR_MINUTO);
    return this.deps.repositorio.saludDelCorreo(umbral);
  }
}
