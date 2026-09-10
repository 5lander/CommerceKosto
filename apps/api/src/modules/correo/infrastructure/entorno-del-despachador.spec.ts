/**
 * El esquema de entorno del despachador: que rol acepta, que no arranca, y que
 * la comprobacion del rol sale aunque otra variable falle (INC-008).
 */

import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError } from '../../../shared/infrastructure/config/environment';
import { cargarConfiguracionDelDespachador } from './entorno-del-despachador';

// La contrasena va aparte y se interpola, como en `environment.spec.ts`: asi
// `audit:secrets` no ve una cadena de conexion literal, y la prueba de que el
// mensaje no la repite tiene algo concreto que buscar.
const CLAVE = 'una-clave-que-no-debe-aparecer-en-ningun-mensaje';
const URL_DESPACHADOR = `postgresql://costeo_despachador:${CLAVE}@localhost:5432/costeo?schema=public`;
const URL_APP = `postgresql://costeo_app:${CLAVE}@localhost:5432/costeo?schema=public`;

function entorno(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { DESPACHADOR_DATABASE_URL: URL_DESPACHADOR, ...extra };
}

function problemasDe(source: NodeJS.ProcessEnv): readonly string[] {
  try {
    cargarConfiguracionDelDespachador(source);
  } catch (error: unknown) {
    if (error instanceof InvalidEnvironmentError) {
      return error.problems;
    }
    throw error;
  }
  return [];
}

describe('cargarConfiguracionDelDespachador', () => {
  it('acepta el minimo y aplica los valores por defecto: cada 5 s, lote de 20, fake, sin Resend', () => {
    const config = cargarConfiguracionDelDespachador(entorno());

    expect(config).toMatchObject({
      isProduction: false,
      databaseUrl: URL_DESPACHADOR,
      mailAdapter: 'fake',
      resend: { apiKey: undefined, remitente: undefined },
      intervaloMs: 5_000,
      lote: 20,
    });
    expect(config.latido).toContain('costeo-correo.latido');
  });

  it('NO acepta DATABASE_URL: este proceso no tiene la cadena de la aplicacion', () => {
    const problemas = problemasDe({ DATABASE_URL: URL_APP });

    expect(problemas.some((p) => p.startsWith('DESPACHADOR_DATABASE_URL'))).toBe(true);
  });

  it('rechaza la cadena si el usuario no es costeo_despachador, y el mensaje no repite la contrasena', () => {
    const problemas = problemasDe(entorno({ DESPACHADOR_DATABASE_URL: URL_APP }));

    expect(problemas.join('\n')).toContain('tiene que ser "costeo_despachador"');
    expect(problemas.join('\n')).not.toContain(CLAVE);
  });

  it('la comprobacion del rol sale AUNQUE otra variable falle (INC-008)', () => {
    const problemas = problemasDe(entorno({ DESPACHADOR_DATABASE_URL: URL_APP, CORREO_LOTE: 'muchos' }));

    expect(problemas.some((p) => p.includes('costeo_despachador'))).toBe(true);
    expect(problemas.some((p) => p.startsWith('CORREO_LOTE'))).toBe(true);
  });

  it('en produccion, fake no arranca', () => {
    const problemas = problemasDe(entorno({ NODE_ENV: 'production', MAIL_ADAPTER: 'fake' }));

    expect(problemas.join('\n')).toContain('MAIL_ADAPTER: en produccion no puede ser `fake`');
  });

  it('en produccion, consola y resend si (la clave de resend la exige la eleccion, no el esquema)', () => {
    for (const MAIL_ADAPTER of ['consola', 'resend']) {
      expect(problemasDe(entorno({ NODE_ENV: 'production', MAIL_ADAPTER }))).toEqual([]);
    }
  });

  it('lee RESEND_* y trata una cadena vacia como ausente', () => {
    const conClave = cargarConfiguracionDelDespachador(
      entorno({ RESEND_API_KEY: ' re_x ', RESEND_REMITENTE: 'costeo <no-reply@ejemplo.invalid>' }),
    );
    expect(conClave.resend).toEqual({ apiKey: 're_x', remitente: 'costeo <no-reply@ejemplo.invalid>' });

    const vacias = cargarConfiguracionDelDespachador(entorno({ RESEND_API_KEY: '', RESEND_REMITENTE: '  ' }));
    expect(vacias.resend).toEqual({ apiKey: undefined, remitente: undefined });
  });

  it('acota intervalo y lote', () => {
    expect(problemasDe(entorno({ CORREO_INTERVALO_MS: '100' })).join()).toContain('CORREO_INTERVALO_MS');
    expect(problemasDe(entorno({ CORREO_LOTE: '0' })).join()).toContain('CORREO_LOTE');
    expect(cargarConfiguracionDelDespachador(entorno({ CORREO_INTERVALO_MS: '1000', CORREO_LOTE: '5' }))).toMatchObject(
      { intervaloMs: 1_000, lote: 5 },
    );
  });
});
