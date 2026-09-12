/**
 * La frontera HTTP: lo que la API contesta cuando la petición viene mal.
 *
 * Reúne los arreglos de P16-A2 que no son de un módulo sino del **borde**, y
 * los prueba donde de verdad se ven: por HTTP, sobre la respuesta cruda.
 *
 *   INC-012   **tres errores que salían como `500 INTERNAL_ERROR`** —un
 *             identificador mal formado, una unidad de uso mal escrita y un
 *             decimal imposible— salen ahora como `400 ENTRADA_INVALIDA` con un
 *             mensaje que dice qué corregir. Un 500 dispara alertas de
 *             operación, cuenta como caída y no ayuda a nadie
 *   D-16.2    **`PERIODO_SIN_DATOS`**: «mes sin abrir» tiene código propio. El
 *             estado sigue siendo 404; lo que la pantalla mira es el `code`
 *   §3        **`.strict()` en los ocho esquemas de consulta.** Un parámetro de
 *             más se RECHAZA; hasta aquí se descartaba en silencio con un 200,
 *             que es la asignación masiva de SEGURIDAD.md §3 vista desde la
 *             consulta
 *
 * **POR QUÉ UN ARCHIVO NUEVO Y NO REPARTIRLO.** Estas reglas no son de
 * `catalog`, ni de `pricing`, ni de `analytics`: son de `shared`, y se rompen
 * todas a la vez el día que alguien cambie el filtro de errores o el pipe. En
 * un solo archivo se leen como lo que son —el contrato del borde— y una sola
 * app de Nest las sirve todas.
 */

import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../../src/bootstrap';
import { Argon2Hasher } from '../../src/modules/iam/infrastructure/argon2-hasher';
import { loadConfiguration } from '../../src/shared/infrastructure/config/environment';
import { cookieConCsrf, csrfDe } from '../soporte/csrf';

const OK = 200;
const PETICION_INVALIDA = 400;
const NO_ENCONTRADO = 404;

const CONTRASENA = 'siete limones verdes';

/** Un mes que nadie ha tocado nunca: no hay período, y esa es la prueba. */
const ANIO_SIN_NADA = 2001;
const ENERO = 1;

/** Escala máxima del sistema (`decimal/escalas.ts`). Un decimal por encima se rechaza. */
const DECIMALES_DE_MAS = 31;

const URL_MIGRATOR = process.env['MIGRATION_DATABASE_URL'];
if (URL_MIGRATOR === undefined) {
  throw new Error('Falta MIGRATION_DATABASE_URL. Ver .env.example.');
}

interface Error4xx {
  readonly code: string;
  readonly message: string;
}

type Consulta = Readonly<Record<string, string | number>>;

describe('la frontera HTTP', () => {
  let app: INestApplication;
  let duena: Client;
  let cookie: string;
  let local: string;

  function servidor(): Server {
    return app.getHttpServer() as Server;
  }

  function leer(ruta: string, consulta: Consulta) {
    return request(servidor())
      .get(ruta)
      .query(consulta)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfDe(cookie));
  }

  function escribir(ruta: string, cuerpo: Readonly<Record<string, unknown>>) {
    return request(servidor())
      .post(ruta)
      .set('Cookie', cookie)
      .set('X-CSRF-Token', csrfDe(cookie))
      .send(cuerpo);
  }

  beforeAll(async () => {
    const sufijo = randomUUID().slice(0, 8);

    duena = new Client({ connectionString: URL_MIGRATOR });
    await duena.connect();
    await duena.query('DELETE FROM login_attempt');

    const configuracion = loadConfiguration(process.env);
    app = await createApplication({
      ...configuracion,
      rateLimit: { windowMs: configuracion.rateLimit.windowMs, max: 100_000 },
    });
    await app.init();

    const hash = await new Argon2Hasher().hash(CONTRASENA);
    const { rows: companies } = await duena.query<{ id: string }>(
      `INSERT INTO company (name, status) VALUES ($1, 'ACTIVE') RETURNING id`,
      [`frontera ${sufijo}`],
    );
    const company = companies[0]?.id ?? '';

    const { rows: locales } = await duena.query<{ id: string }>(
      `INSERT INTO location (company_id, name, type, status)
       VALUES ($1, $2, 'LOCAL', 'ACTIVE') RETURNING id`,
      [company, `frontera centro ${sufijo}`],
    );
    local = locales[0]?.id ?? '';

    const correo = `frontera.${sufijo}@snacklab.ec`;
    await duena.query(
      `INSERT INTO app_user (company_id, email, password_hash, status)
       VALUES ($1, $2, $3, 'ACTIVE')`,
      [company, correo, hash],
    );
    await duena.query(
      `INSERT INTO user_role (company_id, user_id, role_code, has_location)
       SELECT $1, id, 'ADMIN', false FROM app_user WHERE email = $2`,
      [company, correo],
    );

    const entrada = await request(servidor())
      .post('/auth/login')
      .send({ email: correo, contrasena: CONTRASENA });
    expect(entrada.status).toBe(OK);
    cookie = cookieConCsrf(entrada);
  });

  afterAll(async () => {
    await app.close();
    await duena.end();
  });

  /**
   * INC-012 aplicado a los tipos: «la base garantiza, el dominio explica»,
   * pero aquí ni siquiera llegaba a la base — reventaba en el constructor del
   * tipo de dominio, que extendía `Error` a secas y el filtro no reconocía.
   */
  describe('los tres errores que salían como 500 (INC-012)', () => {
    it('un identificador de RUTA mal formado es 400, no 500', async () => {
      const respuesta = await leer('/costeo/no-soy-un-uuid', { locationId: local });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      const error = respuesta.body as Error4xx;
      expect(error.code).toBe('ENTRADA_INVALIDA');
      expect(error.message).toContain('UUID');
    });

    it('un identificador de CONSULTA mal formado tambien', async () => {
      const respuesta = await leer('/catalogo/articulos', { itemId: 'tampoco-soy-un-uuid' });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as Error4xx).code).toBe('ENTRADA_INVALIDA');
    });

    it('el mensaje del identificador no es un eco: recorta lo largo', async () => {
      const respuesta = await leer(`/costeo/${'z'.repeat(400)}`, { locationId: local });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as Error4xx).message.length).toBeLessThan(300);
    });

    /**
     * Las tres formas que un humano escribe la primera vez: `KG`, `Litro`,
     * `unid de medida`. Ninguna existe; las tres respondían 500.
     */
    it.each(['KG', 'Litro', 'unid de medida'])(
      'la unidad de uso "%s" es 400 y el mensaje da ejemplos validos',
      async (unidadDeUso) => {
        const respuesta = await escribir('/catalogo/items', {
          nombre: `Harina ${randomUUID().slice(0, 8)}`,
          tipo: 'COMPRADO',
          unidadDeUso,
          rendimiento: '1',
          grupoId: null,
          confianzaDePrecio: 'FACTURA',
          llevaStock: null,
        });

        expect(respuesta.status).toBe(PETICION_INVALIDA);
        const error = respuesta.body as Error4xx;
        expect(error.code).toBe('ENTRADA_INVALIDA');
        expect(error.message).toContain('"kg"');
      },
    );

    /**
     * El regex del esquema acepta hasta 40 caracteres, así que un decimal
     * larguísimo pasaba la validación y moría después, dentro del tipo `Money`.
     */
    it('un importe con mas decimales de los que el sistema conserva es 400, no 500', async () => {
      const respuesta = await escribir('/analitica/costos-fijos', {
        locationId: local,
        anio: ANIO_SIN_NADA,
        mes: ENERO,
        costos: [
          {
            concepto: 'Arriendo',
            clasificacion: 'OTRO_FIJO',
            importe: `1.${'1'.repeat(DECIMALES_DE_MAS)}`,
          },
        ],
      });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      const error = respuesta.body as Error4xx;
      expect(error.code).toBe('ENTRADA_INVALIDA');
      expect(error.message).toContain('decimales');
    });
  });

  /**
   * D-16.2. El estado no cambia —sigue siendo 404, porque no hay nada que
   * devolver—; lo que cambia es que la pantalla puede distinguir «este mes no
   * se ha abierto» de «este enlace está roto», que son cosas opuestas.
   */
  describe('un mes sin abrir (D-16.2)', () => {
    it.each([
      'resumen',
      'menu-engineering',
      'food-cost-real',
      'punto-de-equilibrio',
      'inventario',
      'reposicion',
    ])('la vista %s responde 404 con code PERIODO_SIN_DATOS', async (vista) => {
      const respuesta = await leer(`/analitica/${vista}`, {
        locationId: local,
        anio: ANIO_SIN_NADA,
        mes: ENERO,
      });

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect((respuesta.body as Error4xx).code).toBe('PERIODO_SIN_DATOS');
    });

    it('un recurso que de verdad no existe sigue siendo RECURSO_NO_ENCONTRADO', async () => {
      const respuesta = await leer(`/costeo/${randomUUID()}`, { locationId: local });

      expect(respuesta.status).toBe(NO_ENCONTRADO);
      expect((respuesta.body as Error4xx).code).toBe('RECURSO_NO_ENCONTRADO');
    });

    it('la carga de ventas de ese mismo mes NO es 404: es la lista vacia', async () => {
      const respuesta = await leer('/analitica/ventas', {
        locationId: local,
        anio: ANIO_SIN_NADA,
        mes: ENERO,
      });

      expect(respuesta.status).toBe(OK);
      expect(respuesta.body).toEqual([]);
    });
  });

  /**
   * Los OCHO esquemas de consulta del proyecto, recorridos en una prueba
   * parametrizada en vez de ocho pruebas calcadas.
   *
   * **Se eligió parametrizar, y la razón es que el defecto es del pipe, no de
   * la ruta.** Ocho `it` idénticos con otra URL no comprueban ocho cosas:
   * comprueban una cosa ocho veces, y el día que se añada un noveno esquema
   * nadie recordaría escribir el noveno bloque. Aquí se añade una fila.
   *
   * Cada ruta se prueba DOS veces —con el parámetro de más y sin él— porque un
   * 400 solo significa algo si la misma petición sin la clave sobrante no lo
   * da: si no, estaría midiendo un permiso que falta o un id mal escrito.
   */
  describe('los esquemas de consulta son .strict() (SEGURIDAD.md §3)', () => {
    function rutas(): readonly (readonly [string, Consulta])[] {
      const mes = { anio: ANIO_SIN_NADA, mes: ENERO };
      return [
        ['/analitica/resumen', { locationId: local, ...mes }],
        ['/consolidado', mes],
        ['/costeo', { locationId: local }],
        // Con `productId`: sin destino, el controlador rechaza por otro motivo
        // y la prueba de abajo —«sin el parametro de mas NO da 400»— medirıa eso.
        ['/recetas', { locationId: local, productId: randomUUID() }],
        ['/inventario/saldos', { locationId: local }],
        ['/inventario/movimientos', { locationId: local }],
        ['/conteos', { locationId: local }],
        ['/periodos', { locationId: local }],
      ];
    }

    it('un parametro de mas se RECHAZA, no se descarta en silencio', async () => {
      for (const [ruta, consulta] of rutas()) {
        const respuesta = await leer(ruta, { ...consulta, utm_source: 'boletin' });

        expect(respuesta.status, ruta).toBe(PETICION_INVALIDA);
        expect((respuesta.body as Error4xx).code, ruta).toBe('ENTRADA_INVALIDA');
      }
    });

    it('y sin el parametro de mas la misma peticion NO da 400', async () => {
      for (const [ruta, consulta] of rutas()) {
        const respuesta = await leer(ruta, consulta);

        expect(respuesta.status, ruta).not.toBe(PETICION_INVALIDA);
      }
    });

    /**
     * El caso que motivó todo: el consolidado no acepta `locationId` **a
     * propósito** (barrera 3). Antes se descartaba y la respuesta era 200, así
     * que el intento se perdía en vez de quedar registrado.
     */
    it('el consolidado rechaza un locationId en vez de tirarlo', async () => {
      const respuesta = await leer('/consolidado', {
        anio: ANIO_SIN_NADA,
        mes: ENERO,
        locationId: local,
      });

      expect(respuesta.status).toBe(PETICION_INVALIDA);
      expect((respuesta.body as Error4xx).code).toBe('ENTRADA_INVALIDA');
    });
  });
});
