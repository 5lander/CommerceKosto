/**
 * El adaptador de Resend contra un `fetch` falso: 2xx, 5xx y timeout. Ninguna
 * prueba manda un correo de verdad ni necesita una clave (CLAUDE.md §12).
 */

import { describe, expect, it } from 'vitest';

import { ResendError, ResendMailer, ResendSinRespuestaError, URL_DE_RESEND } from './resend-mailer';

const CORREO = { to: 'ana@snacklab.ec', subject: 'Hola', body: 'cuerpo' };
const TIMEOUT_DE_PRUEBA_MS = 20;
const HTTP_OK = 200;
const HTTP_CAIDO = 503;
const HTTP_SIN_CLAVE = 401;

interface Capturada {
  readonly url: string;
  readonly init: RequestInit;
}

/** La URL pedida, venga como cadena, `URL` o `Request`. */
function urlDe(entrada: string | URL | Request): string {
  if (typeof entrada === 'string') return entrada;
  return entrada instanceof URL ? entrada.href : entrada.url;
}

/** Un `fetch` que responde con el estado dado y guarda lo que recibio. */
function fetchQueResponde(estado: number, cuerpo = '{"id":"x"}'): { fetch: typeof fetch; llamadas: Capturada[] } {
  const llamadas: Capturada[] = [];
  const falso: typeof fetch = (entrada, init) => {
    llamadas.push({ url: urlDe(entrada), init: init ?? {} });
    return Promise.resolve(new Response(cuerpo, { status: estado }));
  };
  return { fetch: falso, llamadas };
}

/** El cuerpo mandado, que en estas pruebas siempre es texto JSON. */
function cuerpoDe(init: RequestInit | undefined): unknown {
  const cuerpo = init?.body;
  if (typeof cuerpo !== 'string') {
    throw new Error('el cuerpo no es texto');
  }
  return JSON.parse(cuerpo);
}

/** Un `fetch` que nunca responde y solo termina cuando la senal lo aborta. */
const fetchQueCuelga: typeof fetch = (_entrada, init) =>
  new Promise<Response>((_resolver, rechazar) => {
    init?.signal?.addEventListener('abort', () => {
      rechazar(init.signal?.reason as Error);
    });
  });

describe('ResendMailer', () => {
  it('con 2xx envia POST a Resend con la clave, el remitente y los cuatro campos', async () => {
    const { fetch, llamadas } = fetchQueResponde(HTTP_OK);
    const mailer = new ResendMailer({ apiKey: 're_clave', remitente: 'costeo <no-reply@ejemplo.invalid>', fetch });

    await expect(mailer.send(CORREO)).resolves.toBeUndefined();

    const llamada = llamadas[0];
    expect(llamada?.url).toBe(URL_DE_RESEND);
    expect(llamada?.init.method).toBe('POST');
    expect(new Headers(llamada?.init.headers).get('authorization')).toBe('Bearer re_clave');
    expect(cuerpoDe(llamada?.init)).toEqual({
      from: 'costeo <no-reply@ejemplo.invalid>',
      to: ['ana@snacklab.ec'],
      subject: 'Hola',
      text: 'cuerpo',
    });
  });

  it('con 5xx falla con el estado y SIN el cuerpo de la respuesta', async () => {
    const { fetch } = fetchQueResponde(HTTP_CAIDO, '<html>caido, la clave era re_clave</html>');
    const mailer = new ResendMailer({ apiKey: 're_clave', remitente: 'no-reply@ejemplo.invalid', fetch });

    const fallo = await mailer.send(CORREO).catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ResendError);
    expect((fallo as ResendError).estado).toBe(HTTP_CAIDO);
    expect((fallo as Error).message).toBe('Resend respondio 503 al enviar el correo.');
    expect((fallo as Error).message).not.toContain('re_clave');
    expect((fallo as Error).message).not.toContain('html');
  });

  it('un 401 tambien es un fallo: una clave mal puesta no se traga en silencio', async () => {
    const { fetch } = fetchQueResponde(HTTP_SIN_CLAVE);
    const mailer = new ResendMailer({ apiKey: 'mala', remitente: 'no-reply@ejemplo.invalid', fetch });

    await expect(mailer.send(CORREO)).rejects.toMatchObject({ estado: HTTP_SIN_CLAVE });
  });

  it('si Resend no responde, corta por timeout con un error que lo dice', async () => {
    const mailer = new ResendMailer({
      apiKey: 're_clave',
      remitente: 'no-reply@ejemplo.invalid',
      fetch: fetchQueCuelga,
      timeoutMs: TIMEOUT_DE_PRUEBA_MS,
    });

    const fallo = await mailer.send(CORREO).catch((error: unknown) => error);

    expect(fallo).toBeInstanceOf(ResendSinRespuestaError);
    expect((fallo as Error).message).toBe('Resend no respondio en 20 ms.');
  });

  it('un fallo de red que no es timeout sube tal cual', async () => {
    const fetchRoto: typeof fetch = () => Promise.reject(new TypeError('fetch failed'));
    const mailer = new ResendMailer({ apiKey: 're_clave', remitente: 'no-reply@ejemplo.invalid', fetch: fetchRoto });

    await expect(mailer.send(CORREO)).rejects.toThrow('fetch failed');
  });
});
