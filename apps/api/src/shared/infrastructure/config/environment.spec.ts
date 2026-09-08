/**
 * El esquema de entorno no es validacion de formato: es un control de
 * seguridad. Estas pruebas cubren los tres fallos que impide.
 */

import { describe, expect, it } from 'vitest';

import { InvalidEnvironmentError, loadConfiguration } from './environment';

const CLAVE = 'una-clave-que-no-debe-aparecer-en-ningun-mensaje';
const URL_APP = `postgresql://costeo_app:${CLAVE}@localhost:5432/costeo?schema=public`;
const URL_MIGRATOR = `postgresql://costeo_migrator:${CLAVE}@localhost:5432/costeo?schema=public`;

function entorno(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { DATABASE_URL: URL_APP, ...extra };
}

describe('loadConfiguration', () => {
  it('acepta el entorno minimo y aplica los valores por defecto', () => {
    const config = loadConfiguration(entorno());

    expect(config.nodeEnv).toBe('development');
    expect(config.isProduction).toBe(false);
    expect(config.port).toBe(3000);
    expect(config.mailAdapter).toBe('fake');
    expect(config.storageAdapter).toBe('fake');
  });

  /**
   * `SEGURIDAD.md` §4.4: lista blanca exacta, jamas `*`, y `credentials` solo
   * con origen verificado. La sesion viaja en cookie, asi que un `*` aqui seria
   * mandarle la cookie a quien pregunte — el navegador ni siquiera lo permite.
   */
  describe('CORS_ORIGENES', () => {
    it('vacio significa NINGUN origen, que es lo que valia antes del frontend', () => {
      expect(loadConfiguration(entorno()).corsOrigenes).toEqual([]);
    });

    it('acepta varios origenes separados por comas, sin espacios de sobra', () => {
      const config = loadConfiguration(
        entorno({ CORS_ORIGENES: 'https://app.ejemplo.ec, http://localhost:3001' }),
      );

      expect(config.corsOrigenes).toEqual(['https://app.ejemplo.ec', 'http://localhost:3001']);
    });

    it('RECHAZA `*`: no es una URL, y es justo lo que la norma prohibe', () => {
      expect(() => loadConfiguration(entorno({ CORS_ORIGENES: '*' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('rechaza un origen sin esquema', () => {
      expect(() => loadConfiguration(entorno({ CORS_ORIGENES: 'app.ejemplo.ec' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    /**
     * El navegador manda `Origin: https://app.ejemplo.ec`, **sin barra final**.
     * Con la barra puesta en la lista, la comparacion falla y el sintoma es un
     * CORS que no funciona sin decir por que — media tarde.
     */
    it('rechaza un origen con barra final', () => {
      expect(() => loadConfiguration(entorno({ CORS_ORIGENES: 'https://app.ejemplo.ec/' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('un origen malo entre varios buenos tumba la configuracion entera', () => {
      expect(() =>
        loadConfiguration(entorno({ CORS_ORIGENES: 'https://bueno.ec,*,https://otro.ec' })),
      ).toThrow(InvalidEnvironmentError);
    });
  });

  describe('el usuario de DATABASE_URL', () => {
    it('RECHAZA el rol de migraciones', () => {
      // Es el fallo mas probable del proyecto: copiar la cadena del migrator
      // "para que funcione la migracion". costeo_migrator es dueno de las
      // tablas y eso deja la Barrera 1 en decorativa (CLAUDE.md §4.1).
      expect(() => loadConfiguration(entorno({ DATABASE_URL: URL_MIGRATOR }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('rechaza cualquier otro rol, no solo el del migrator', () => {
      expect(() =>
        loadConfiguration(entorno({ DATABASE_URL: `postgresql://postgres:${CLAVE}@localhost:5432/costeo` })),
      ).toThrow(/costeo_app/u);
    });

    it('rechaza una cadena que no es una URL', () => {
      expect(() => loadConfiguration(entorno({ DATABASE_URL: 'no-es-una-url' }))).toThrow(
        InvalidEnvironmentError,
      );
    });
  });

  describe('el mensaje de error', () => {
    it('NUNCA contiene la contrasena', () => {
      // Un fallo de arranque acaba en un log, en una captura de pantalla o en
      // un ticket. La cadena de conexion lleva la contrasena dentro.
      let mensaje = '';
      try {
        loadConfiguration(entorno({ DATABASE_URL: URL_MIGRATOR }));
      } catch (error) {
        mensaje = error instanceof Error ? error.message : String(error);
      }

      expect(mensaje).not.toBe('');
      expect(mensaje).not.toContain(CLAVE);
      expect(mensaje).toContain('DATABASE_URL');
    });

    it('lista TODOS los problemas, no solo el primero', () => {
      // Arreglar la configuracion de uno en uno, reiniciando cada vez, es como
      // se acaba desactivando la validacion entera por impaciencia.
      let problemas: readonly string[] = [];
      try {
        loadConfiguration({ DATABASE_URL: URL_MIGRATOR, PORT: '0', LOG_LEVEL: 'chillon' });
      } catch (error) {
        problemas = error instanceof InvalidEnvironmentError ? error.problems : [];
      }

      expect(problemas.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('credenciales de migracion en el proceso de la aplicacion', () => {
    it('en produccion, MIGRATION_DATABASE_URL hace que NO arranque', () => {
      expect(() =>
        loadConfiguration(entorno({ NODE_ENV: 'production', MIGRATION_DATABASE_URL: URL_MIGRATOR })),
      ).toThrow(InvalidEnvironmentError);
    });

    it('en produccion, SHADOW_DATABASE_URL tampoco', () => {
      expect(() =>
        loadConfiguration(entorno({ NODE_ENV: 'production', SHADOW_DATABASE_URL: URL_MIGRATOR })),
      ).toThrow(InvalidEnvironmentError);
    });

    it('en desarrollo SI se admiten: es la misma maquina que corre las migraciones', () => {
      expect(() =>
        loadConfiguration(entorno({ NODE_ENV: 'development', MIGRATION_DATABASE_URL: URL_MIGRATOR })),
      ).not.toThrow();
    });
  });

  describe('rangos', () => {
    it.each([
      ['PORT', '0'],
      ['PORT', '70000'],
      ['REQUEST_TIMEOUT_MS', '10'],
      ['LOG_LEVEL', 'verboso'],
      ['MAIL_ADAPTER', 'sendgrid'],
    ])('rechaza %s = %s', (variable, valor) => {
      expect(() => loadConfiguration(entorno({ [variable]: valor }))).toThrow(InvalidEnvironmentError);
    });
  });
});
