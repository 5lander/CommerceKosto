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
    expect(config.appUrl).toBe('http://localhost:3001');
    expect(config.horasDeRestablecimiento).toBe(1);
  });

  /**
   * De aqui salen los enlaces de los correos. Una barra final produciria
   * `https://app.ejemplo.ec//activacion`, que segun el servidor es otra ruta; y
   * en produccion, olvidarla manda al cliente a localhost.
   */
  describe('APP_URL', () => {
    it('acepta una URL completa sin barra final', () => {
      expect(loadConfiguration(entorno({ APP_URL: 'https://app.ejemplo.ec' })).appUrl).toBe(
        'https://app.ejemplo.ec',
      );
    });

    it('rechaza la barra final', () => {
      expect(() => loadConfiguration(entorno({ APP_URL: 'https://app.ejemplo.ec/' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('rechaza algo que no es una URL', () => {
      expect(() => loadConfiguration(entorno({ APP_URL: 'app.ejemplo.ec' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('en produccion es obligatoria', () => {
      expect(() => loadConfiguration(entorno({ NODE_ENV: 'production' }))).toThrow(/APP_URL/u);
    });

    it('en desarrollo se resuelve sola al frontend local', () => {
      expect(loadConfiguration(entorno()).appUrl).toBe('http://localhost:3001');
    });
  });

  describe('HORAS_DE_RESTABLECIMIENTO', () => {
    it('acepta un entero de horas', () => {
      expect(loadConfiguration(entorno({ HORAS_DE_RESTABLECIMIENTO: '2' })).horasDeRestablecimiento).toBe(2);
    });

    it.each(['0', '25', '1.5', 'una'])('rechaza %s', (valor) => {
      expect(() => loadConfiguration(entorno({ HORAS_DE_RESTABLECIMIENTO: valor }))).toThrow(
        InvalidEnvironmentError,
      );
    });
  });

  describe('MAIL_ADAPTER', () => {
    it.each(['fake', 'consola', 'resend'] as const)('admite %s', (valor) => {
      expect(loadConfiguration(entorno({ MAIL_ADAPTER: valor })).mailAdapter).toBe(valor);
    });

    it('ya no admite `real`: los adaptadores tienen nombre propio', () => {
      expect(() => loadConfiguration(entorno({ MAIL_ADAPTER: 'real' }))).toThrow(InvalidEnvironmentError);
    });
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

  /**
   * Desde donde se cree `X-Forwarded-For` (D-16.49). Es un control de
   * seguridad: una lista que acepte cualquier cosa es una lista que un dia
   * confia en el cliente, y entonces el cliente elige su IP.
   */
  describe('PROXY_DE_CONFIANZA', () => {
    it('vacia significa NINGUN proxy: la IP es la del socket', () => {
      expect(loadConfiguration(entorno()).proxiesDeConfianza).toEqual([]);
      expect(loadConfiguration(entorno({ PROXY_DE_CONFIANZA: '' })).proxiesDeConfianza).toEqual([]);
    });

    it('acepta IPv4, CIDR v4 e IPv6 exacta, separadas por comas y sin espacios de sobra', () => {
      const config = loadConfiguration(entorno({ PROXY_DE_CONFIANZA: '172.28.0.0/24, 127.0.0.1 ,::1' }));

      expect(config.proxiesDeConfianza).toEqual(['172.28.0.0/24', '127.0.0.1', '::1']);
    });

    it.each(['caddy', '172.28.0.0/33', 'fd00::/64', '*', '172.28.0'])('rechaza lo que no es una direccion: %s', (valor) => {
      expect(() => loadConfiguration(entorno({ PROXY_DE_CONFIANZA: valor }))).toThrow(InvalidEnvironmentError);
    });

    it('una entrada mala entre varias buenas tumba la configuracion entera', () => {
      expect(() => loadConfiguration(entorno({ PROXY_DE_CONFIANZA: '172.28.0.0/24,caddy' }))).toThrow(
        InvalidEnvironmentError,
      );
    });

    it('se comprueba EN EL CAMPO: aparece en el informe aunque otra variable tambien falle (INC-008)', () => {
      let problemas: readonly string[] = [];
      try {
        loadConfiguration(entorno({ PROXY_DE_CONFIANZA: 'caddy', PORT: '0' }));
      } catch (error) {
        problemas = error instanceof InvalidEnvironmentError ? error.problems : [];
      }

      expect(problemas.some((p) => p.startsWith('PROXY_DE_CONFIANZA'))).toBe(true);
      expect(problemas.some((p) => p.startsWith('PORT'))).toBe(true);
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
