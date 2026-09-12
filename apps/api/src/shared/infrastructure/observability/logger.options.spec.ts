/**
 * La lista de cabeceras que el log NUNCA registra, clavada en una prueba.
 *
 * POR QUE EXISTE ESTE ARCHIVO. El control C14 de P0 —«ningun secreto en los
 * logs»— era una linea de configuracion que nadie volvia a mirar. En P16-A2 se
 * introdujo `X-CSRF-Token` y esa linea se quedo como estaba: el token vivo
 * salio en claro en el log de cada mutacion durante toda la etapa. Un control
 * que solo existe en el sitio donde se configura se rompe la siguiente vez que
 * aparece un secreto, y no avisa. Esta prueba es el aviso (CLAUDE.md §8: lo
 * que se puede convertir en verificacion, se convierte).
 *
 * SE COMPRUEBA LA LISTA ENTERA Y NO «QUE CONTENGA X»: un `toContain` pasa
 * igual si alguien borra la cookie de la lista.
 */

import { describe, expect, it } from 'vitest';

import type { Configuration } from '../config/environment';
import { CABECERA_DE_CSRF } from '../http/csrf';
import { CABECERAS_SIN_LOG, loggerOptions } from './logger.options';

const config = { logLevel: 'info' } as Configuration;

/** Lo que `nestjs-pino` acabara pasandole a `pino-http`, si es que hay algo. */
function redaccionConfigurada(): unknown {
  const opciones = loggerOptions(config).pinoHttp;
  return opciones !== undefined && 'redact' in opciones ? opciones.redact : undefined;
}

describe('las cabeceras que el log no registra', () => {
  it('son exactamente estas cuatro, y se BORRAN en vez de marcarse', () => {
    // `remove: true` quita la clave entera. Dejar `[Redacted]` conservaria en el
    // log la constancia de que la peticion traia token, que no le sirve a nadie
    // y que un dia alguien decide «mejorar» ensenando el principio del valor.
    expect(redaccionConfigurada()).toEqual({
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-csrf-token"]',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    });
  });

  it('la del token anti-CSRF se DERIVA del nombre de la cabecera', () => {
    // Si alguien renombra `CABECERA_DE_CSRF`, la redaccion tiene que seguirle
    // sola: una copia literal seria un secreto que se escapa el dia del
    // renombrado, que es justo como se escapo la primera vez.
    expect(CABECERAS_SIN_LOG).toContain(`req.headers["${CABECERA_DE_CSRF}"]`);
  });
});
