/**
 * `lib/api` — el transporte, con `fetch` simulado.
 *
 * **LOS DOS FALLOS QUE ESTAS PRUEBAS FIJAN LOS ENCONTRÓ EL NAVEGADOR, NO UNA
 * PRUEBA**, y ninguna de la API podía verlos: `supertest` no pasa por aquí.
 *
 *   INC-023  sin sesión, el cliente pedía el token anti-CSRF antes del login;
 *            `GET /auth/sesion` da 401 y el login no llegaba a salir
 *   INC-025  una respuesta 202 sin cuerpo reventaba al leerla como JSON
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { alCaducarSesion, codigoDe, llamar } from './api.ts';
import { csrfEnMemoria, guardarCsrf } from './csrf.ts';

interface Llamada {
  readonly ruta: string;
  readonly metodo: string;
  readonly cabeceras: Readonly<Record<string, string>>;
}

type Respondedor = (llamada: Llamada) => Response;

const fetchOriginal = globalThis.fetch;
let llamadas: Llamada[] = [];

function simular(respondedor: Respondedor): void {
  globalThis.fetch = (entrada: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const cabeceras = (init?.headers ?? {}) as Record<string, string>;
    const ruta = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const llamada = { ruta, metodo: init?.method ?? 'GET', cabeceras };
    llamadas.push(llamada);
    return Promise.resolve(respondedor(llamada));
  };
}

function json(estado: number, cuerpo: unknown): Response {
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: { 'content-type': 'application/json' } });
}

/** Una respuesta nueva cada vez: el cuerpo de una `Response` solo se lee una. */
function sesionInvalida(): Response {
  return json(401, { code: 'SESION_INVALIDA', message: 'Sesión no válida' });
}

beforeEach(() => {
  llamadas = [];
  guardarCsrf(null);
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe('el cuerpo de una respuesta que salió bien', () => {
  it('un 202 sin cuerpo es `undefined`, no un error de JSON (INC-025)', async () => {
    guardarCsrf('token');
    simular(() => new Response(null, { status: 202 }));
    assert.equal(await llamar({ ruta: '/auth/password/olvido', metodo: 'POST', cuerpo: { email: 'a@b.c' } }), undefined);
  });

  it('un 204 también', async () => {
    simular(() => new Response(null, { status: 204 }));
    assert.equal(await llamar({ ruta: '/algo' }), undefined);
  });

  it('un 200 con JSON se lee', async () => {
    simular(() => json(200, { version: 3 }));
    assert.deepEqual(await llamar({ ruta: '/analitica/ventas' }), { version: 3 });
  });
});

describe('los fallos', () => {
  it('traen el código y el mensaje del backend', async () => {
    simular(() => json(409, { code: 'CONFLICTO_DE_VERSION', message: 'Otra persona guardó antes.' }));
    await assert.rejects(llamar({ ruta: '/algo' }), (fallo: unknown) => {
      assert.equal(codigoDe(fallo), 'CONFLICTO_DE_VERSION');
      assert.equal((fallo as Error).message, 'Otra persona guardó antes.');
      return true;
    });
  });

  it('sin red, un error que se lee y no el TypeError de fetch', async () => {
    globalThis.fetch = (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch'));
    await assert.rejects(llamar({ ruta: '/algo' }), (fallo: unknown) => codigoDe(fallo) === 'SIN_RED');
  });
});

describe('el token anti-CSRF', () => {
  it('sin sesión, la mutación sale SIN cabecera y llega a la API (INC-023)', async () => {
    simular(({ ruta }) => (ruta === '/auth/sesion' ? sesionInvalida() : json(200, { expiraEn: 'x', csrf: 'nuevo' })));

    await llamar({ ruta: '/auth/login', metodo: 'POST', cuerpo: { email: 'a@b.c', contrasena: 'x' } });

    const login = llamadas.find((l) => l.ruta === '/auth/login');
    assert.ok(login !== undefined, 'el login no llegó a salir');
    assert.equal(login.cabeceras['X-CSRF-Token'], undefined);
  });

  it('con sesión, la mutación lleva el token que devuelve GET /auth/sesion', async () => {
    simular(({ ruta }) => (ruta === '/auth/sesion' ? json(200, { csrf: 't1' }) : json(200, {})));

    await llamar({ ruta: '/analitica/ventas', metodo: 'POST', cuerpo: {} });

    assert.equal(llamadas.find((l) => l.metodo === 'POST')?.cabeceras['X-CSRF-Token'], 't1');
    assert.equal(csrfEnMemoria(), 't1');
  });

  it('una lectura no pide token', async () => {
    simular(() => json(200, []));
    await llamar({ ruta: '/ubicaciones' });
    assert.deepEqual(llamadas.map((l) => l.ruta), ['/ubicaciones']);
  });

  it('un token que dejó de valer se renueva y se reintenta UNA vez', async () => {
    guardarCsrf('viejo');
    let posts = 0;
    simular(({ ruta, metodo }) => {
      if (ruta === '/auth/sesion') return json(200, { csrf: 'vigente' });
      if (metodo !== 'POST') return json(200, {});
      posts += 1;
      return posts === 1 ? json(403, { code: 'CSRF_INVALIDO', message: 'x' }) : json(200, { ok: true });
    });

    assert.deepEqual(await llamar({ ruta: '/conteos', metodo: 'POST', cuerpo: {} }), { ok: true });
    assert.equal(posts, 2);
  });

  it('y si el segundo intento también falla, el error sube: no hay bucle', async () => {
    guardarCsrf('viejo');
    simular(({ ruta }) => (ruta === '/auth/sesion' ? json(200, { csrf: 'otro' }) : json(403, { code: 'CSRF_INVALIDO', message: 'x' })));

    await assert.rejects(llamar({ ruta: '/conteos', metodo: 'POST', cuerpo: {} }));
    assert.equal(llamadas.filter((l) => l.metodo === 'POST').length, 2);
  });
});

describe('la sesión que se cae', () => {
  it('avisa a quien se registró, y quitar el registro de otro no borra el suyo', async () => {
    let avisos = 0;
    const quitarViejo = alCaducarSesion(() => {
      avisos += 100;
    });
    const quitarNuevo = alCaducarSesion(() => {
      avisos += 1;
    });
    quitarViejo();

    simular(() => sesionInvalida());
    await assert.rejects(llamar({ ruta: '/ubicaciones' }));

    assert.equal(avisos, 1);
    quitarNuevo();
  });
});
