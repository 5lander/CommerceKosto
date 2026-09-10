/**
 * `PROXY_DE_CONFIANZA` para el back office, leida a mano como `BACKOFFICE_PORT`
 * y `CORREO_MINUTOS_DE_ALERTA`: este proceso no tiene esquema de entorno.
 *
 * El back office escucha en loopback y se llega por tunel SSH, asi que el
 * socket casi siempre es `127.0.0.1` y la lista casi siempre esta vacia. Se
 * lee igual, con la MISMA validacion que la API (D-16.49): si algun dia hay
 * un proxy delante, la IP que queda en `backoffice_access_log` y en los
 * intentos de login del operador sera la del cliente, no la del proxy — y una
 * entrada mal escrita para el arranque en vez de confiar en nadie.
 */

import { partirLista } from '../../../shared/infrastructure/config/environment';
import { esProxyDeConfianzaValido } from '../../../shared/infrastructure/http/ip-del-cliente';

const VARIABLE = 'PROXY_DE_CONFIANZA';

/** Token de inyeccion de la lista ya validada. */
export const PROXIES_DE_CONFIANZA = 'PROXIES_DE_CONFIANZA';

/** @throws {Error} si alguna entrada no es una IPv4, una red IPv4 en CIDR o una IPv6 exacta. */
export function proxiesDeConfianzaDelEntorno(): readonly string[] {
  const entradas = partirLista(process.env[VARIABLE] ?? '');
  const invalida = entradas.findIndex((entrada) => !esProxyDeConfianzaValido(entrada));

  if (invalida !== -1) {
    throw new Error(
      `${VARIABLE}: la entrada ${String(invalida + 1)} no es una IPv4, una red IPv4 en CIDR (a.b.c.d/n) ni una IPv6 exacta.`,
    );
  }
  return entradas;
}
